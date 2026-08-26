import { beforeEach, describe, expect, it, vi } from "vitest";

const requestOpenAiStructured = vi.hoisted(() => vi.fn());
const listProductionClips = vi.hoisted(() => vi.fn());
const listProductionProps = vi.hoisted(() => vi.fn());
const saveProductionClips = vi.hoisted(() => vi.fn());
const listNovelCharacters = vi.hoisted(() => vi.fn());
const listNovelLocations = vi.hoisted(() => vi.fn());
const episodeFindFirst = vi.hoisted(() => vi.fn());
const channelFindFirst = vi.hoisted(() => vi.fn());
const providerModelFindFirst = vi.hoisted(() => vi.fn());
const storyClipUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/llm/openai-structured", () => ({ requestOpenAiStructured }));
vi.mock("@/lib/production/domain-store", () => ({
  listProductionClips,
  listProductionProps,
  saveProductionClips,
}));
vi.mock("./domain-store", () => ({
  listNovelCharacters,
  listNovelLocations,
}));
vi.mock("@/lib/server/crypto", () => ({
  decryptSecret: (value: string) => value,
}));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    episode: { findFirst: episodeFindFirst },
    channel: { findFirst: channelFindFirst },
    providerModel: { findFirst: providerModelFindFirst },
    storyClip: { update: storyClipUpdate },
  },
}));

import {
  convertEpisodeClipsToScreenplays,
  hasCompleteClipCoverage,
  mapWithConcurrency,
  ScreenplayBatchError,
  splitEpisodeIntoClips,
} from "./story-to-script-runtime";

const runtimeInput = {
  projectId: "project-1",
  episodeId: "episode-1",
  channelId: "channel-1",
  model: "model-1",
  locale: "zh" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  currentClips = [];
  episodeFindFirst.mockResolvedValue({ novelText: "甲说：你好。乙走进书房。" });
  channelFindFirst.mockResolvedValue({
    protocol: "openai-compatible",
    baseUrl: "https://provider.test/v1",
    encryptedApiKeys: '["key-1"]',
  });
  providerModelFindFirst.mockResolvedValue({ capabilitiesJson: "{}" });
  listNovelCharacters.mockResolvedValue([{ name: "甲" }, { name: "乙" }]);
  listNovelLocations.mockResolvedValue([{ name: "书房" }]);
  listProductionProps.mockResolvedValue([]);
  storyClipUpdate.mockImplementation(
    async (input: {
      where: { id: string };
      data: { screenplay?: string; status?: string };
    }) => {
      const clip = currentClips.find((item) => item.id === input.where.id);
      if (clip) Object.assign(clip, input.data);
      return clip;
    },
  );
});

let currentClips: Array<{
  id: string;
  clipIndex: number;
  content: string;
  screenplay: string | null;
  status: string;
}> = [];

describe("story-to-script runtime", () => {
  it("recognizes only contiguous, exact source coverage", () => {
    expect(
      hasCompleteClipCoverage(" 甲\n乙 ", [
        { clipIndex: 0, content: " 甲\n" },
        { clipIndex: 1, content: "乙 " },
      ]),
    ).toBe(true);
    expect(
      hasCompleteClipCoverage(" 甲\n乙 ", [
        { clipIndex: 0, content: "甲\n" },
        { clipIndex: 1, content: "乙" },
      ]),
    ).toBe(false);
  });

  it("keeps bounded concurrency and result order", async () => {
    let active = 0;
    let maxActive = 0;
    const result = await mapWithConcurrency([30, 5, 10, 1], 2, async (delay) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return delay;
    });

    expect(maxActive).toBe(2);
    expect(result).toEqual([30, 5, 10, 1]);
  });

  it("persists exact clip text and an incremental split artifact", async () => {
    const sourceText = " 甲\n乙 ";
    episodeFindFirst.mockResolvedValue({ novelText: sourceText });
    listProductionClips.mockResolvedValue([]);
    requestOpenAiStructured.mockResolvedValue({
      data: {
        clips: [
          {
            start: " 甲",
            end: "甲\n",
            text: " 甲\n",
            summary: "第一段",
            location: null,
            characters: ["甲"],
            props: [],
          },
          {
            start: "乙",
            end: "乙 ",
            text: "乙 ",
            summary: "第二段",
            location: null,
            characters: ["乙"],
            props: [],
          },
        ],
      },
      trace: trace("story_clip_segmentation"),
    });
    const saved = [
      { id: "clip-1", clipIndex: 0, content: " 甲\n" },
      { id: "clip-2", clipIndex: 1, content: "乙 " },
    ];
    saveProductionClips.mockResolvedValue(saved);
    const hooks = runtimeHooks();

    const result = await splitEpisodeIntoClips(
      "user-1",
      runtimeInput,
      hooks,
    );

    expect(result.clipCount).toBe(2);
    const persisted = saveProductionClips.mock.calls[0][3];
    expect(persisted.map((clip: { content: string }) => clip.content).join(""))
      .toBe(sourceText);
    expect(hooks.persistArtifact).toHaveBeenCalledWith(
      "clips.split",
      "episode-1",
      expect.objectContaining({ clips: saved }),
    );
  });

  it("keeps successful clips and retries only failed screenplay work", async () => {
    currentClips = [
      clip("clip-1", 0, "甲说：你好。"),
      clip("clip-2", 1, "乙走进书房。"),
    ];
    listProductionClips.mockImplementation(async () => currentClips);
    requestOpenAiStructured
      .mockResolvedValueOnce(structuredScreenplay("clip-1", "甲说：你好。"))
      .mockRejectedValueOnce(new Error("provider unavailable"));
    const firstHooks = runtimeHooks();

    await expect(
      convertEpisodeClipsToScreenplays(
        "user-1",
        { ...runtimeInput, concurrency: 1 },
        firstHooks,
      ),
    ).rejects.toBeInstanceOf(ScreenplayBatchError);

    expect(currentClips[0].status).toBe("screenplay_ready");
    expect(currentClips[0].screenplay).not.toBeNull();
    expect(currentClips[1].status).toBe("screenplay_failed");
    expect(firstHooks.persistArtifact).toHaveBeenCalledWith(
      "screenplay.clip",
      "clip-1",
      expect.objectContaining({ success: true }),
    );

    requestOpenAiStructured.mockReset();
    requestOpenAiStructured.mockResolvedValueOnce(
      structuredScreenplay("clip-2", "乙走进书房。"),
    );
    const retryHooks = runtimeHooks();
    const retried = await convertEpisodeClipsToScreenplays(
      "user-1",
      { ...runtimeInput, concurrency: 1 },
      retryHooks,
    );

    expect(requestOpenAiStructured).toHaveBeenCalledTimes(1);
    expect(retried.reusedCount).toBe(1);
    expect(retried.convertedCount).toBe(1);
    expect(currentClips.every((item) => item.status === "screenplay_ready"))
      .toBe(true);
  });
});

function runtimeHooks() {
  return {
    assertActive: vi.fn().mockResolvedValue(undefined),
    persistArtifact: vi.fn().mockResolvedValue(undefined),
  };
}

function clip(id: string, clipIndex: number, content: string) {
  return { id, clipIndex, content, screenplay: null, status: "split_ready" };
}

function structuredScreenplay(clipId: string, originalText: string) {
  const dialogue = originalText.includes("你好")
    ? [
        {
          type: "dialogue" as const,
          character: "甲",
          parenthetical: null,
          lines: "你好",
        },
      ]
    : [{ type: "action" as const, text: originalText }];
  return {
    data: {
      clipId,
      originalText,
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "书房", time: "日" },
          description: "",
          characters: originalText.includes("你好") ? ["甲"] : ["乙"],
          content: dialogue,
        },
      ],
    },
    trace: trace("story_screenplay_conversion"),
  };
}

function trace(promptId: string) {
  return {
    promptId,
    agentId: "agent",
    promptVersion: 3,
    promptVersionHash: "version-hash",
    systemHash: "system-hash",
    model: "model-1",
    structuredOutputMode: "json_object" as const,
    repaired: false,
    correctionAttempts: 0,
    tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    outputHash: "output-hash",
  };
}
