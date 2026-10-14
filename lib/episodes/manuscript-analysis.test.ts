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
import { chunkSource } from "./long-source";
import { workflowCacheFingerprint } from "@/lib/workflow/cache-fingerprint";
import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import { ManuscriptNotesSchema } from "./source-notes-schema";
import { z } from "zod";

const input = {
  userId: "user", projectId: "project", manuscriptId: "manuscript", sourceHash: "hash",
  channelId: "channel", model: "test", locale: "zh" as const,
};
const notes = (summary: string): ManuscriptNotes => ({ summary, characters: [], locations: [], props: [], rules: [] });
function cacheKey(ref: string, text: string) {
  const prompt = renderPrompt({ id: PROMPT_IDS.SOURCE_NOTES, locale: input.locale, variables: {
    source_text: text,
    output_schema: JSON.stringify(z.toJSONSchema(ManuscriptNotesSchema)),
    extraction_task: "提取本段明确发生的事件及人物、场景、道具、世界规则。概要以约 600 字为目标，实体详情约 100 字，包含短引用；关键事实需要时可用结构允许的完整长度。",
  } });
  return workflowCacheFingerprint({
    source: { manuscriptId: input.manuscriptId, sourceHash: input.sourceHash, ref, text },
    prompt,
    promptVersion: "source-notes-v2",
    channelId: input.channelId,
    model: input.model,
    agentConfiguration: null,
    parameters: { temperature: 0.2, timeoutMs: 120_000, stream: false, schema: z.toJSONSchema(ManuscriptNotesSchema) },
  });
}

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
    const key = cacheKey("0:12000", chunks[0].text);
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
    const recordRequest = vi.fn(async () => {});
    const result = await analyzeManuscript(input, {
      assertActive: async () => {},
      loadArtifact: async (type, ref) => artifacts.get(`${type}:${ref}`) ?? null,
      persistArtifact: async (type, ref, data) => { artifacts.set(`${type}:${ref}`, data); },
      reportProgress,
      recordRequest,
    });
    expect(result).toEqual({ deliverableId: "deliverable", chunkCount: 8 });
    expect(requests.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
    expect(merges).toEqual([["cached-first", "source-1", "source-2", "source-3", "source-4", "source-5"], ["source-6", "source-7"], ["merged", "merged"]]);
    expect(mocks.save.mock.calls[0][2].payload.chunks.map((chunk: { index: number }) => chunk.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const progress = reportProgress.mock.calls.map(call => call[0]);
    expect(progress.filter(message => message.startsWith("已提取"))).toEqual(
      Array.from({ length: 8 }, (_, index) => `已提取原著资料 ${index + 1}/8（3 路并发）`));
    expect(recordRequest).toHaveBeenCalledWith(expect.objectContaining({
      status: "succeeded", reused: true, reuseReason: "cache_fingerprint_match",
      cacheVersion: "workflow-cache-v2", promptVersion: expect.any(String),
      artifactRefs: [`manuscript.chunk:${key}`],
    }));
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
    const refId = cacheKey(`0:${sourceText.length}`, sourceText);
    mocks.artifacts.mockResolvedValue([{ artifactType: "manuscript.chunk", refId, payload: notes("已有依据") }]);
    const persistArtifact = vi.fn(async () => {});
    const recordRequest = vi.fn(async () => {});
    await analyzeManuscript(input, { assertActive: async () => {}, loadArtifact: async () => null, persistArtifact, recordRequest });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(persistArtifact).toHaveBeenCalledWith("manuscript.chunk", refId, notes("已有依据"));
    expect(mocks.artifacts.mock.calls[0][0].where.run).toMatchObject({ userId: "user", projectId: "project", targetId: "manuscript", input: { path: ["sourceHash"], equals: "hash" } });
    expect(recordRequest).toHaveBeenCalledWith(expect.objectContaining({
      status: "succeeded", reused: true, reuseReason: "previous_validated_artifact",
      artifactRefs: [`manuscript.chunk:${refId}`],
    }));
  });

  it("calls the model on explicit restart even if older runs contain valid notes", async () => {
    const sourceText = "原著正文";
    mocks.manuscript.mockResolvedValue({ id: "manuscript", sourceHash: "hash", sourceText, title: "原著" });
    const refId = cacheKey(`0:${sourceText.length}`, sourceText);
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
