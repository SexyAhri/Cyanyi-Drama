import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  episode: vi.fn(), channel: vi.fn(), model: vi.fn(), request: vi.fn(),
  characters: vi.fn(), locations: vi.fn(), props: vi.fn(),
  saveCharacters: vi.fn(), saveLocations: vi.fn(), saveProps: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: {
  episode: { findFirst: mocks.episode }, channel: { findFirst: mocks.channel },
  providerModel: { findFirst: mocks.model },
} }));
vi.mock("@/lib/server/crypto", () => ({ decryptSecret: () => '["test-key"]' }));
vi.mock("@/lib/server/channel-access", () => ({ accessibleChannelWhere: vi.fn(() => ({})) }));
vi.mock("@/lib/settings/runtime-contract", () => ({ structuredRequestOptions: () => ({}) }));
vi.mock("@/lib/settings/runtime-store", () => ({ loadUserRuntimeSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/agent/provider-types", () => ({ supportsStoredStructuredOutputs: () => false }));
vi.mock("@/lib/llm/openai-structured", () => ({ requestOpenAiStructured: mocks.request }));
vi.mock("./domain-store", () => ({
  listNovelCharacters: mocks.characters,
  listNovelLocations: mocks.locations,
  upsertNovelCharacters: mocks.saveCharacters,
  upsertNovelLocations: mocks.saveLocations,
}));
vi.mock("@/lib/production/domain-store", () => ({
  listProductionProps: mocks.props,
  upsertProductionProps: mocks.saveProps,
}));

import { parseNovelAndPersist } from "./parser-runtime";
import { PROMPT_IDS } from "@/lib/prompts";
import type { WorkflowRequestUpdate } from "@/lib/workflow/request-events";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.episode.mockResolvedValue({ novelText: "episode text" });
  mocks.channel.mockResolvedValue({ protocol: "openai-compatible", baseUrl: "https://example.invalid", encryptedApiKeys: "encrypted" });
  mocks.model.mockResolvedValue({ selected: true, capabilitiesJson: "{}" });
  mocks.characters.mockResolvedValue([
    { name: "甲", aliases: ["甲别名"] }, { name: "乙", aliases: [] },
  ]);
  mocks.locations.mockResolvedValue([{ name: "城" }, { name: "林" }]);
  mocks.props.mockResolvedValue([{ name: "钥匙" }, { name: "玉佩" }]);
  mocks.saveCharacters.mockImplementation(async (_userId: string, _projectId: string, values: unknown) => values);
  mocks.saveLocations.mockImplementation(async (_userId: string, _projectId: string, values: unknown) => values);
  mocks.saveProps.mockImplementation(async (_userId: string, _projectId: string, values: unknown) => values);
});

describe("long episode character and asset analysis", () => {
  it("sends ordered source ranges as independent bounded requests and merges their grounded results", async () => {
    const first = "甲在城持钥匙。\n".repeat(1500);
    const second = "乙在林持玉佩。\n".repeat(20);
    const sourceText = first + second;
    const requests: Array<{ id: string; source: string; libraries: string[] }> = [];
    mocks.request.mockImplementation(async ({ prompt }: { prompt: { id: string; variables: Record<string, string> } }) => {
      const source = prompt.variables.source_text;
      requests.push({ id: prompt.id, source, libraries: [prompt.variables.character_library, prompt.variables.location_library, prompt.variables.prop_library].filter(Boolean) });
      const trace = { model: "test", promptId: prompt.id, tokenUsage: null };
      if (prompt.id === PROMPT_IDS.STORY_CHARACTER_ANALYSIS) {
        const firstChunk = source.includes("甲在城");
        return { data: { characters: [{ name: firstChunk ? "甲" : "乙", aliases: firstChunk ? ["甲别名"] : [],
          profile: { sourceChunk: firstChunk ? 0 : 1 }, introduction: firstChunk ? "先前事实" : "后续事实", evidence: [firstChunk ? "甲" : "乙"] }] }, trace };
      }
      const firstChunk = source.includes("甲在城");
      return { data: {
        locations: [{ name: firstChunk ? "城" : "林", summary: firstChunk ? "石墙" : "竹林", evidence: [firstChunk ? "城" : "林"] }],
        props: [{ name: firstChunk ? "钥匙" : "玉佩", summary: firstChunk ? "铜制" : "玉制", evidence: [firstChunk ? "钥匙" : "玉佩"] }],
      }, trace };
    });

    const recordRequest = vi.fn<(event: WorkflowRequestUpdate) => Promise<void>>().mockResolvedValue(undefined);
    const persistArtifact = vi.fn<(type: string, refId: string, payload: unknown) => Promise<void>>().mockResolvedValue(undefined);
    const result = await parseNovelAndPersist("user-1", {
      projectId: "project-1", episodeId: "episode-1", channelId: "channel-1", model: "text-model", sourceText,
    }, { assertActive: async () => {}, recordRequest, persistArtifact });

    expect(requests).toHaveLength(4);
    expect(requests.every((request) => request.source.length <= 12_000)).toBe(true);
    expect(requests.map((request) => request.source).filter((value, index, all) => all.indexOf(value) === index))
      .toEqual([first, second]);
    expect(result.analysis.characters.map((item) => item.name)).toEqual(["甲", "乙"]);
    expect(result.analysis.locations.map((item) => item.name)).toEqual(["城", "林"]);
    expect(result.analysis.props.map((item) => item.name)).toEqual(["钥匙", "玉佩"]);
    const starts = recordRequest.mock.calls.filter(([event]) => event.status === "running").map(([event]) => event);
    expect(starts).toHaveLength(4);
    expect(new Set(starts.map((event) => event.requestId)).size).toBe(4);
    expect(starts.map((event) => (event.input as { sourceRange: { start: number; end: number } }).sourceRange).sort((a, b) => a.start - b.start)).toEqual([
      { start: 0, end: 12_000 }, { start: 0, end: 12_000 },
      { start: 12_000, end: sourceText.length }, { start: 12_000, end: sourceText.length },
    ]);
    expect(persistArtifact.mock.calls.filter(([type]) => type === "prompt.trace")).toHaveLength(6);
    expect(mocks.saveCharacters.mock.calls[0][2].map((item: { name: string }) => item.name)).toEqual(["甲", "乙"]);
  });
});
