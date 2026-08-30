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
const storyClipFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/llm/openai-structured", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/llm/openai-structured")
  >()),
  requestOpenAiStructured,
}));
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
vi.mock("@/lib/assets/story-world", () => ({
  loadProjectAssetStoryWorldContext: vi.fn().mockResolvedValue({
    lock: { setting: "premodern", evidence: ["王朝"] },
  }),
  getStoryWorldDirective: vi.fn(() => "故事时代硬约束：前现代世界"),
}));
vi.mock("@/lib/settings/runtime-store", () => ({
  loadUserRuntimeSettings: vi.fn().mockResolvedValue({
    structuredRequestTimeoutSeconds: 600,
    structuredOutputStreaming: true,
    structuredTransportMaxAttempts: 3,
    workflowStepMaxAttempts: 3,
    workflowConcurrency: 2,
    screenplayClipMaxChars: 1_600,
  }),
}));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    episode: { findFirst: episodeFindFirst },
    channel: { findFirst: channelFindFirst },
    providerModel: { findFirst: providerModelFindFirst },
    storyClip: { update: storyClipUpdate, findMany: storyClipFindMany },
  },
}));

import {
  buildBeatAwareClipSegmentation,
  buildDeterministicClipSegmentation,
  buildDeterministicScreenplay,
  buildSourceUnits,
  convertEpisodeClipsToScreenplays,
  extractProjectEffectLibrary,
  hasCompleteClipCoverage,
  mapWithConcurrency,
  MAX_SCREENPLAY_CLIP_CHARS,
  normalizeScreenplayClipSizes,
  restoreSourceBackedClips,
  ScreenplayBatchError,
  splitEpisodeIntoClips,
} from "./story-to-script-runtime";
import type { EpisodeProductionPlan } from "@/lib/episodes/production-plan";

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
  storyClipFindMany.mockResolvedValue([]);
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
  it("builds one reusable VFX motif per recurring technique", () => {
    const screenplay = JSON.stringify({
      scenes: [
        {
          content: [
            {
              type: "action",
              actionDesign: {
                kind: "skill",
                performer: "甲",
                technique: "青霄剑诀",
                visualMotif: "青白细线剑气，边缘银亮，尾迹快速收束",
                visualMotifSource: "production_inference",
                visualMotifRationale: "遵循剑诀事实与项目画风",
                vfxPlan: [{ phase: "release", category: "weapon_trail" }],
              },
            },
          ],
        },
      ],
    });

    expect(extractProjectEffectLibrary([screenplay, screenplay])).toEqual([
      expect.objectContaining({
        key: "technique:青霄剑诀",
        visualMotif: "青白细线剑气，边缘银亮，尾迹快速收束",
      }),
    ]);
  });

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
            endUnitId: "U0001",
            summary: "第一段",
            location: null,
            characters: ["甲"],
            props: [],
          },
          {
            endUnitId: "U0002",
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
    expect(requestOpenAiStructured).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 600_000 }),
    );
    const persisted = saveProductionClips.mock.calls[0][3];
    expect(persisted.map((clip: { content: string }) => clip.content).join(""))
      .toBe(sourceText);
    expect(hooks.persistArtifact).toHaveBeenCalledWith(
      "clips.split",
      "episode-1",
      expect.objectContaining({ clips: saved }),
    );
  });

  it("restores model-selected boundaries from immutable source units", () => {
    const sourceText = " 甲说完。\r\n\r\n乙回答！ ";
    const sourceUnits = buildSourceUnits(sourceText);
    const clips = restoreSourceBackedClips(
      [
        {
          endUnitId: sourceUnits[0].id,
          summary: "甲说话",
          location: null,
          characters: ["甲"],
          props: [],
        },
        {
          endUnitId: sourceUnits.at(-1)!.id,
          summary: "乙回答",
          location: null,
          characters: ["乙"],
          props: [],
        },
      ],
      sourceUnits,
    );

    expect(sourceUnits.map((unit) => unit.text).join("")).toBe(sourceText);
    expect(clips.map((clip) => clip.text).join("")).toBe(sourceText);
    expect(clips[0].text).toContain("\r\n\r\n");
  });

  it("falls back to deterministic slicing after semantic rejection", async () => {
    const sourceText = `${"甲在练武场挥剑。".repeat(120)}\n\n乙回到书房。`;
    episodeFindFirst.mockResolvedValue({ novelText: sourceText });
    listProductionClips.mockResolvedValue([]);
    requestOpenAiStructured.mockRejectedValue(
      new Error(
        "STRUCTURED_SEMANTIC_INVALID:clips.last.endUnitId: [SOURCE_COVERAGE_MISMATCH]",
      ),
    );
    saveProductionClips.mockImplementation(
      async (_userId, _projectId, _episodeId, clips) =>
        clips.map((item: { content: string }, index: number) => ({
          id: `clip-${index}`,
          clipIndex: index,
          content: item.content,
        })),
    );
    const hooks = runtimeHooks();

    const result = await splitEpisodeIntoClips(
      "user-1",
      runtimeInput,
      hooks,
    );

    expect(result.degraded).toBe(true);
    expect(result.fallbackReason).toContain("STRUCTURED_SEMANTIC_INVALID");
    expect(result.clips.map((clip) => clip.content).join("")).toBe(sourceText);
    expect(hooks.persistArtifact).toHaveBeenCalledWith(
      "clips.split",
      "episode-1",
      expect.objectContaining({ degraded: true }),
    );
  });

  it("does not degrade segmentation after a provider timeout", async () => {
    const sourceText = `${"甲在练武场挥剑。".repeat(120)}\n\n${"乙回到书房。".repeat(120)}`;
    episodeFindFirst.mockResolvedValue({ novelText: sourceText });
    listProductionClips.mockResolvedValue([]);
    requestOpenAiStructured.mockRejectedValue(
      new Error("STRUCTURED_PROVIDER_FAILED:524:Provider gateway timeout"),
    );
    saveProductionClips.mockImplementation(
      async (_userId, _projectId, _episodeId, clips) =>
        clips.map((item: { content: string }, index: number) => ({
          id: `clip-${index}`,
          clipIndex: index,
          content: item.content,
        })),
    );

    await expect(
      splitEpisodeIntoClips("user-1", runtimeInput, runtimeHooks()),
    ).rejects.toThrow("STRUCTURED_PROVIDER_FAILED:524");
    expect(saveProductionClips).not.toHaveBeenCalled();
  });

  it("calls the provider when a failed segmentation step is retried", async () => {
    const sourceText = `${"甲在练武场挥剑。".repeat(120)}\n\n乙回到书房。`;
    episodeFindFirst.mockResolvedValue({ novelText: sourceText });
    listProductionClips.mockResolvedValue([]);
    saveProductionClips.mockImplementation(
      async (_userId, _projectId, _episodeId, clips) =>
        clips.map((item: { content: string }, index: number) => ({
          id: `clip-${index}`,
          clipIndex: index,
          content: item.content,
        })),
    );
    requestOpenAiStructured.mockResolvedValue({
      data: {
        clips: [
          {
            endUnitId: buildSourceUnits(sourceText).at(-1)!.id,
            summary: "重试后拆分",
            location: null,
            characters: [],
            props: [],
          },
        ],
      },
      trace: trace("story_clip_segmentation"),
    });

    const result = await splitEpisodeIntoClips(
      "user-1",
      { ...runtimeInput, resumeExisting: true },
      runtimeHooks(),
    );

    expect(requestOpenAiStructured).toHaveBeenCalledTimes(1);
    expect(result.degraded).toBe(false);
    expect(result.clips.map((clip) => clip.content).join("")).toBe(sourceText);
  });

  it("builds bounded fallback clips with canonical production assets", () => {
    const sourceText = `${"甲在练武场挥剑。".repeat(120)}\n\n乙拿起长剑回到书房。`;
    const clips = buildDeterministicClipSegmentation(
      sourceText,
      {
        characters: ["甲", "乙"],
        locations: ["练武场", "书房"],
        props: ["长剑"],
      },
      400,
    );

    expect(clips.length).toBeGreaterThan(1);
    expect(clips.map((clip) => clip.text).join("")).toBe(sourceText);
    expect(clips.every((clip) => clip.text.length <= 400)).toBe(true);
    expect(clips.at(-1)).toMatchObject({
      location: "书房",
      props: ["长剑"],
    });
    expect(clips.at(-1)?.characters).toEqual(expect.arrayContaining(["乙"]));
  });

  it("splits an approved adaptation only between production beats", () => {
    const first = `甲先咬牙。${"甲在练武场挥拳。".repeat(24)}甲收拳站稳。`;
    const second = `乙推开房门。${"乙回到书房坐下。".repeat(24)}乙靠在椅背。`;
    const sourceText = `${first}\n${second}`;
    const plan = {
      version: 1,
      sourceHash: "a".repeat(64),
      runtime: {
        targetDurationSeconds: 85,
        plannedDurationSeconds: 40,
        hardMaxDurationSeconds: 90,
        estimatedShotCount: 12,
        estimatedSpokenSeconds: 0,
        fit: "short_source",
      },
      beats: [
        productionBeat("B01", first, "练武场"),
        productionBeat("B02", second, "书房"),
      ],
      sourceCoverage: [],
      dialoguePlan: [],
      narrationPlan: [],
      cliffhanger: {
        beatId: "B02",
        setup: "乙返回书房",
        finalImageOrLine: "乙坐下",
      },
    } as EpisodeProductionPlan;

    const clips = buildBeatAwareClipSegmentation(
      sourceText,
      plan,
      {
        characters: ["甲", "乙"],
        locations: ["练武场", "书房"],
        props: [],
      },
      220,
    );

    expect(clips.map((clip) => clip.text).join("")).toBe(sourceText);
    expect(clips.map((clip) => clip.productionBeatIds)).toEqual([
      ["B01"],
      ["B02"],
    ]);
    expect(clips.map((clip) => clip.location)).toEqual(["练武场", "书房"]);
  });

  it("uses the active Production Plan without requesting AI segmentation", async () => {
    const first = "甲先咬牙，双手握拳，挥拳击出，衣袖震动，随后收拳站稳。";
    const second = "乙推开房门，跨过门槛，走到书桌前坐下，随后靠在椅背。";
    const sourceText = `${first}\n${second}`;
    const plan: EpisodeProductionPlan = {
      version: 1,
      sourceHash: "a".repeat(64),
      runtime: {
        targetDurationSeconds: 85,
        plannedDurationSeconds: 40,
        hardMaxDurationSeconds: 90,
        estimatedShotCount: 12,
        estimatedSpokenSeconds: 0,
        fit: "short_source",
      },
      beats: [
        productionBeat("B01", first, "练武场"),
        productionBeat("B02", second, "书房"),
      ],
      sourceCoverage: [
        {
          sourceUnitId: "U0001",
          beatId: "B01",
          adaptedEvidence: "甲先咬牙",
          treatment: "preserved",
        },
      ],
      dialoguePlan: [],
      narrationPlan: [],
      cliffhanger: {
        beatId: "B02",
        setup: "乙进入书房",
        finalImageOrLine: "乙靠在椅背",
      },
    };
    episodeFindFirst.mockResolvedValue({
      novelText: sourceText,
      activeSourceId: "source-1",
      sourceVersions: [
        { id: "source-1", content: sourceText, productionPlan: plan },
      ],
    });
    listProductionClips.mockResolvedValue([]);
    saveProductionClips.mockImplementation(
      async (_userId, _projectId, _episodeId, clips) =>
        clips.map((item: { content: string }, index: number) => ({
          id: `clip-${index}`,
          clipIndex: index,
          content: item.content,
        })),
    );

    const result = await splitEpisodeIntoClips(
      "user-1",
      runtimeInput,
      runtimeHooks(),
    );

    expect(requestOpenAiStructured).not.toHaveBeenCalled();
    expect(result.clips.map((item) => item.content).join("")).toBe(sourceText);
    expect(saveProductionClips.mock.calls[0][3]).toEqual([
      expect.objectContaining({
        content: sourceText,
        summary: "练武场动作 / 书房动作",
      }),
    ]);
  });

  it("deterministically bounds oversized provider clips before persistence", () => {
    const sourceText = `${"甲在练武场挥剑。".repeat(220)}乙拿起长剑回到书房。`;
    const clips = normalizeScreenplayClipSizes(
      [
        {
          start: sourceText.slice(0, 20),
          end: sourceText.slice(-20),
          text: sourceText,
          summary: "模型返回的整章片段",
          location: "练武场",
          characters: ["甲", "乙"],
          props: ["长剑"],
        },
      ],
      {
        characters: ["甲", "乙"],
        locations: ["练武场", "书房"],
        props: ["长剑"],
      },
    );

    expect(clips.length).toBeGreaterThan(1);
    expect(clips.map((clip) => clip.text).join("")).toBe(sourceText);
    expect(
      clips.every((clip) => clip.text.length <= MAX_SCREENPLAY_CLIP_CHARS),
    ).toBe(true);
    expect(clips.at(-1)).toMatchObject({
      location: "书房",
      props: ["长剑"],
    });
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

  it("reuses successful screenplays after source-event boundary normalization", async () => {
    const source = "“哇！”海丹麟坠落于地。";
    currentClips = [
      {
        ...clip("clip-1", 0, source),
        status: "screenplay_ready",
        screenplay: JSON.stringify({
          clipId: "clip-1",
          originalText: source,
          coverage: [
            {
              eventId: "E001",
              evidence: "“哇！",
              modes: ["visual"],
              reason: null,
            },
            {
              eventId: "E002",
              evidence: "”海丹麟坠落于地。",
              modes: ["visual"],
              reason: null,
            },
          ],
          scenes: [
            {
              sceneNumber: 0,
              heading: { intExt: "INT", location: "书房", time: "日" },
              description: "",
              characters: ["乙"],
              content: [{ type: "action", text: source }],
            },
          ],
        }),
      },
    ];
    listProductionClips.mockImplementation(async () => currentClips);

    const result = await convertEpisodeClipsToScreenplays(
      "user-1",
      { ...runtimeInput, concurrency: 1 },
      runtimeHooks(),
    );

    expect(requestOpenAiStructured).not.toHaveBeenCalled();
    expect(result.reusedCount).toBe(1);
    expect(currentClips[0].status).toBe("screenplay_ready");
  });

  it("calls the model for missing screenplays when a workflow retry resumes", async () => {
    currentClips = [
      clip("clip-1", 0, "甲说：你好。"),
      clip("clip-2", 1, "乙走进书房。"),
    ];
    listProductionClips.mockImplementation(async () => currentClips);
    requestOpenAiStructured
      .mockResolvedValueOnce(structuredScreenplay("clip-1", "甲说：你好。"))
      .mockResolvedValueOnce(structuredScreenplay("clip-2", "乙走进书房。"));
    const result = await convertEpisodeClipsToScreenplays(
      "user-1",
      { ...runtimeInput, concurrency: 2, resumeExisting: true },
      runtimeHooks(),
    );

    expect(requestOpenAiStructured).toHaveBeenCalledTimes(2);
    expect(result.degradedCount).toBe(0);
    expect(currentClips.every((item) => item.status === "screenplay_ready"))
      .toBe(true);
    expect(
      currentClips.map((item) => JSON.parse(item.screenplay ?? "{}").originalText),
    ).toEqual(["甲说：你好。", "乙走进书房。"]);
  });

  it("does not degrade temporary screenplay provider failures", async () => {
    currentClips = [clip("clip-1", 0, "甲说：你好。")];
    listProductionClips.mockImplementation(async () => currentClips);
    requestOpenAiStructured.mockRejectedValue(
      new Error("STRUCTURED_PROVIDER_FAILED:524:Provider gateway timeout"),
    );

    await expect(
      convertEpisodeClipsToScreenplays(
        "user-1",
        runtimeInput,
        runtimeHooks(),
      ),
    ).rejects.toBeInstanceOf(ScreenplayBatchError);
    expect(currentClips[0].status).toBe("screenplay_failed");
  });

  it("builds a validator-safe deterministic screenplay", () => {
    const screenplay = buildDeterministicScreenplay(
      "clip-1",
      "甲走进书房。",
      {
        characters: ["甲"],
        locations: ["书房"],
        props: [],
      },
    );

    expect(screenplay).toMatchObject({
      clipId: "clip-1",
      originalText: "甲走进书房。",
      scenes: [
        {
          heading: { intExt: "INT", location: "书房" },
          characters: ["甲"],
          content: [{ type: "action", text: "甲走进书房。" }],
        },
      ],
    });
  });
});

function runtimeHooks() {
  return {
    assertActive: vi.fn().mockResolvedValue(undefined),
    persistArtifact: vi.fn().mockResolvedValue(undefined),
  };
}

function productionBeat(beatId: string, text: string, location: string) {
  return {
    beatId,
    kind: "action" as const,
    purpose: `${location}动作`,
    location,
    durationSeconds: 20,
    adaptedStartMarker: text.slice(0, 12),
    adaptedEndMarker: text.slice(-12),
    actionChain: {
      triggerOrIntent: text.slice(0, 4),
      preparation: text.slice(4, 8),
      execution: text.slice(8, 12),
      stateChange: text.slice(12, 16),
      settleOrReaction: text.slice(-8),
    },
    transition: null,
    performanceIntent: "动作连续",
    interactions: [],
    effects: [],
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
      coverage: originalText
        .split(/(?<=[。！？!?；;\n])/u)
        .filter((value) => Boolean(value.trim()))
        .map((evidence, index) => ({
          eventId: `E${String(index + 1).padStart(3, "0")}`,
          evidence,
          modes: [originalText.includes("你好") ? ("dialogue" as const) : ("visual" as const)],
          reason: null,
        })),
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
