import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({ count: vi.fn(), provider: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({ prisma: { project: { count: mocks.count } } }));
vi.mock("./provider", () => ({ resolveEpisodeTextProvider: mocks.provider }));
vi.mock("@/lib/llm/openai-structured", () => ({ requestOpenAiStructured: mocks.request }));

import { splitEpisodesWithAi } from "./split";
import { workflowCacheFingerprint } from "@/lib/workflow/cache-fingerprint";
import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import { episodeSplitSchema } from "@/lib/prompts/schemas";

const input = {
  userId: "user-1",
  projectId: "project-1",
  content: "第一段开始，故事发生，第一段结束。",
  channelId: "channel-1",
  model: "text-test",
  locale: "zh" as const,
};
const validBoundaries = { episodes: [{ number: 1, title: "第一集", summary: "故事发生", startMarker: "第一段开始", endMarker: "第一段结束" }] };

function cacheKey() {
  const prompt = renderPrompt({ id: PROMPT_IDS.EPISODE_SPLIT, locale: input.locale, variables: { source_text: input.content } });
  return workflowCacheFingerprint({
    source: { projectId: input.projectId, sourceRange: { start: 0, end: input.content.length }, text: input.content },
    prompt,
    promptVersion: "episode-split-v2",
    channelId: input.channelId,
    model: input.model,
    agentConfiguration: null,
    parameters: {
      temperature: 0.2,
      stream: false,
      structuredOutputMode: "json_schema",
      schema: z.toJSONSchema(episodeSplitSchema),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.count.mockResolvedValue(1);
  mocks.provider.mockResolvedValue({ structuredOutputMode: "json_schema" });
  mocks.request.mockResolvedValue({ data: validBoundaries, trace: { model: "text-test" } });
});

describe("episode split cache validation", () => {
  it("reuses only a schema and source-boundary validated cached result and records its version", async () => {
    const recordRequest = vi.fn(async () => {});
    const result = await splitEpisodesWithAi({ ...input, hooks: {
      assertActive: async () => {},
      loadArtifact: async () => ({ boundaries: validBoundaries, trace: { model: "text-test" } }),
      persistArtifact: async () => {},
      recordRequest,
    } });

    expect(mocks.request).not.toHaveBeenCalled();
    expect(result.episodes).toHaveLength(1);
    expect(recordRequest).toHaveBeenCalledWith(expect.objectContaining({
      status: "succeeded",
      reused: true,
      reuseReason: "cache_fingerprint_match",
      inputHash: cacheKey(),
      cacheVersion: "workflow-cache-v2",
      promptVersion: expect.any(String),
      artifactRefs: [`episode.split-chunk:${cacheKey()}`],
    }));
  });

  it("rejects cached markers that do not belong to the exact source and regenerates", async () => {
    const persistArtifact = vi.fn(async () => {});
    const invalidCached = { episodes: [{ ...validBoundaries.episodes[0], startMarker: "invented marker" }] };
    const result = await splitEpisodesWithAi({ ...input, hooks: {
      assertActive: async () => {},
      loadArtifact: async () => ({ boundaries: invalidCached, trace: { model: "text-test" } }),
      persistArtifact,
    } });

    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(persistArtifact).toHaveBeenCalledWith("episode.split-chunk", cacheKey(), expect.objectContaining({ boundaries: validBoundaries }));
    expect(result.episodes[0].content).toBe(input.content);
  });
});
