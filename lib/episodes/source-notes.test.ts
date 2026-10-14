import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), provider: vi.fn() }));
vi.mock("@/lib/llm/openai-structured", () => ({ requestOpenAiStructured: mocks.request }));
vi.mock("./provider", () => ({ resolveEpisodeTextProvider: mocks.provider }));
import { condenseAdaptationSource } from "./source-notes";
import { workflowCacheFingerprint } from "@/lib/workflow/cache-fingerprint";
import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import { AdaptationNotesSchema } from "./source-notes-schema";
import { z } from "zod";

function adaptationCacheKey(source: string, channelId: string, model: string) {
  const prompt = renderPrompt({ id: PROMPT_IDS.SOURCE_NOTES, variables: {
    source_text: source,
    output_schema: JSON.stringify(z.toJSONSchema(AdaptationNotesSchema)),
    extraction_task: "提取本段原文的改编依据：保留关键事件、人物关系、对白短引用、场景道具、世界限制和结尾状态。为有限时长的改编提炼重点，不提前发生事件。",
  } });
  return workflowCacheFingerprint({
    source: { reference: `0:${source.length}`, text: source },
    prompt,
    promptVersion: "adaptation-notes-v2",
    channelId,
    model,
    agentConfiguration: null,
    parameters: { temperature: 0.2, stream: false, schema: z.toJSONSchema(AdaptationNotesSchema) },
  });
}

beforeEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); mocks.provider.mockResolvedValue({ model: "model" }); });
describe("parallel adaptation notes", () => {
  it("runs chunks concurrently, preserves source order, and reuses checkpoints", async () => {
    vi.stubEnv("SOURCE_ANALYSIS_CONCURRENCY", "2");
    const source = "甲".repeat(12000) + "乙".repeat(12000);
    const cache = new Map<string, unknown>();
    let first!: (value: unknown) => void;
    let second!: (value: unknown) => void;
    let started!: () => void;
    const bothStarted = new Promise<void>(resolve => { started = resolve; });
    mocks.request.mockImplementationOnce(() => new Promise(resolve => { first = resolve; }));
    mocks.request.mockImplementationOnce(() => new Promise(resolve => { second = resolve; started(); }));
    const hooks = {
      assertActive: vi.fn().mockResolvedValue(undefined),
      loadArtifact: vi.fn(async (type: string, id: string) => cache.get(`${type}:${id}`) ?? null),
      persistArtifact: vi.fn(async (type: string, id: string, value: unknown) => { cache.set(`${type}:${id}`, value); }),
      reportProgress: vi.fn().mockResolvedValue(undefined),
    };
    const input = { source, userId: "user", channelId: "channel", model: "model", hooks };
    const result = condenseAdaptationSource(input);
    await bothStarted;
    expect(mocks.request).toHaveBeenCalledTimes(2);
    second({ data: { notes: "第二段" }, trace: { tokenUsage: null } });
    first({ data: { notes: "第一段" }, trace: { tokenUsage: null } });
    expect(await result).toBe("第一段\n\n第二段");
    expect(await condenseAdaptationSource(input)).toBe("第一段\n\n第二段");
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request.mock.calls[0][0]).toMatchObject({ stream: false, prompt: { id: "source_notes" } });
  });
  it("does not call the model for a saved note", async () => {
    const source = "保存的原文";
    const key = adaptationCacheKey(source, "channel", "model");
    const recordRequest = vi.fn(async () => {});
    const hooks = { assertActive: vi.fn(), persistArtifact: vi.fn(), recordRequest,
      loadArtifact: vi.fn(async (_type, id) => id === key ? { notes: "保存的笔记" } : null) };
    expect(await condenseAdaptationSource({ source, userId: "user", channelId: "channel", model: "model", hooks })).toBe("保存的笔记");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(recordRequest).toHaveBeenCalledWith(expect.objectContaining({
      status: "succeeded", reused: true, reuseReason: "cache_fingerprint_match",
      inputHash: key, cacheVersion: "workflow-cache-v2", artifactRefs: [`adaptation.notes:${key}`],
    }));
  });
});
