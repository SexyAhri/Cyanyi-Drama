import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ manuscript: vi.fn(), request: vi.fn(), save: vi.fn(), artifacts: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({ prisma: { manuscript: { findFirst: mocks.manuscript }, workflowArtifact: { findMany: mocks.artifacts } } }));
vi.mock("@/lib/llm/openai-structured", () => ({ requestOpenAiStructured: mocks.request }));
vi.mock("@/lib/production/deliverables", () => ({ createProductionDeliverable: mocks.save }));
vi.mock("./provider", () => ({ resolveEpisodeTextProvider: vi.fn(async () => ({ model: "test" })) }));
vi.mock("@/lib/workflow/store", () => ({ createOrReuseWorkflowRun: vi.fn() }));
vi.mock("@/lib/queue/workflow-queue", () => ({ enqueueWorkflowJob: vi.fn() }));
vi.mock("@/lib/settings/runtime-store", () => ({ loadUserRuntimeSettings: vi.fn() }));

import { analyzeManuscript, manuscriptAnalysisConcurrency, type ManuscriptNotes } from "./manuscript-analysis";
import { chunkSource, sourceFingerprint } from "./long-source";

const input = {
  userId: "user", projectId: "project", manuscriptId: "manuscript", sourceHash: "hash",
  channelId: "channel", model: "test", locale: "zh" as const,
};
const notes = (summary: string): ManuscriptNotes => ({ summary, characters: [], locations: [], props: [], rules: [] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MANUSCRIPT_ANALYSIS_CONCURRENCY", "3");
  mocks.save.mockResolvedValue({ id: "deliverable" });
  mocks.artifacts.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("parallel manuscript analysis", () => {
  it("reuses old fingerprints, preserves source order, and merges only within a level", async () => {
    const sourceText = Array.from({ length: 8 }, (_, index) => `SEGMENT${index}`.padEnd(12_000, "文")).join("");
    mocks.manuscript.mockResolvedValue({ id: "manuscript", sourceHash: "hash", sourceText, title: "原著" });
    const chunks = chunkSource(sourceText);
    const key = sourceFingerprint({ ref: "0:12000", text: chunks[0].text, model: "test", channel: "channel", version: 1 });
    const artifacts = new Map<string, unknown>([[`manuscript.chunk:${key}`, notes("cached-first")]]);
    const requests: number[] = [];
    const merges: string[][] = [];
    let active = 0, peak = 0, activeChunks = 0;
    mocks.request.mockImplementation(async ({ prompt }: { prompt: { text: string } }) => {
      active++; peak = Math.max(peak, active);
      const match = prompt.text.match(/SEGMENT(\d)/);
      if (match) {
        const index = Number(match[1]);
        activeChunks++;
        requests.push(index);
        await new Promise(resolve => setTimeout(resolve, index === 1 ? 12 : 1));
        activeChunks--; active--;
        return { data: notes(`source-${index}`), trace: { model: "test" } };
      }
      expect(activeChunks).toBe(0);
      merges.push(Array.from(prompt.text.matchAll(/"summary":"([^"]+)"/g), match => match[1]));
      await Promise.resolve();
      active--;
      return { data: notes("merged"), trace: { model: "test" } };
    });
    const reportProgress = vi.fn<(message: string) => Promise<void>>(async () => {});
    const result = await analyzeManuscript(input, {
      assertActive: async () => {},
      loadArtifact: async (type, ref) => artifacts.get(`${type}:${ref}`) ?? null,
      persistArtifact: async (type, ref, data) => { artifacts.set(`${type}:${ref}`, data); },
      reportProgress,
    });
    expect(result).toEqual({ deliverableId: "deliverable", chunkCount: 8 });
    expect(requests.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
    expect(merges).toEqual([["cached-first", "source-1", "source-2", "source-3", "source-4", "source-5"], ["source-6", "source-7"], ["merged", "merged"]]);
    expect(mocks.save.mock.calls[0][2].payload.chunks.map((chunk: { index: number }) => chunk.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const progress = reportProgress.mock.calls.map(call => call[0]);
    expect(progress.filter(message => message.startsWith("已提取"))).toEqual(
      Array.from({ length: 8 }, (_, index) => `已提取原著资料 ${index + 1}/8（3 路并发）`));
  });

  it("uses a bounded concurrency setting", () => {
    vi.unstubAllEnvs();
    const saved = process.env.MANUSCRIPT_ANALYSIS_CONCURRENCY;
    delete process.env.MANUSCRIPT_ANALYSIS_CONCURRENCY;
    vi.stubEnv("SOURCE_ANALYSIS_CONCURRENCY", "6");
    expect(manuscriptAnalysisConcurrency()).toBe(6);
    if (saved !== undefined) process.env.MANUSCRIPT_ANALYSIS_CONCURRENCY = saved;
    for (const [value, expected] of [["0", 1], ["2", 2], ["100", 8], ["invalid", 6]] as const) {
      vi.stubEnv("MANUSCRIPT_ANALYSIS_CONCURRENCY", value);
      expect(manuscriptAnalysisConcurrency()).toBe(expected);
    }
  });

  it("reuses a previous run's valid notes without calling the model and copies the checkpoint", async () => {
    const sourceText = "原著正文";
    mocks.manuscript.mockResolvedValue({ id: "manuscript", sourceHash: "hash", sourceText, title: "原著" });
    const refId = sourceFingerprint({ ref: `0:${sourceText.length}`, text: sourceText, model: "test", channel: "channel", version: 1 });
    mocks.artifacts.mockResolvedValue([{ artifactType: "manuscript.chunk", refId, payload: notes("已有依据") }]);
    const persistArtifact = vi.fn(async () => {});
    await analyzeManuscript(input, { assertActive: async () => {}, loadArtifact: async () => null, persistArtifact });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(persistArtifact).toHaveBeenCalledWith("manuscript.chunk", refId, notes("已有依据"));
    expect(mocks.artifacts.mock.calls[0][0].where.run).toMatchObject({ userId: "user", projectId: "project", targetId: "manuscript", input: { path: ["sourceHash"], equals: "hash" } });
  });

  it("calls the model on explicit restart even if older runs contain valid notes", async () => {
    const sourceText = "原著正文";
    mocks.manuscript.mockResolvedValue({ id: "manuscript", sourceHash: "hash", sourceText, title: "原著" });
    const refId = sourceFingerprint({ ref: `0:${sourceText.length}`, text: sourceText, model: "test", channel: "channel", version: 1 });
    mocks.artifacts.mockResolvedValue([{ artifactType: "manuscript.chunk", refId, payload: notes("旧结果") }]);
    mocks.request.mockResolvedValue({ data: notes("新结果"), trace: { model: "test" } });
    await analyzeManuscript(input, {
      reusePreviousResults: false,
      assertActive: async () => {}, loadArtifact: async () => null, persistArtifact: async () => {},
    });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.artifacts).not.toHaveBeenCalled();
    expect(mocks.save.mock.calls[0][2].payload.summary).toEqual(notes("新结果"));
  });
});
