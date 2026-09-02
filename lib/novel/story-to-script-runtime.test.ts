import { beforeEach, describe, expect, it, vi } from "vitest";

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
  extractProjectEffectLibrary,
  hasCompleteClipCoverage,
  mapWithConcurrency,
  MAX_SCREENPLAY_CLIP_CHARS,
  normalizeScreenplayClipSizes,
  restoreSourceBackedClips,
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
    const sourceText = `标题：测试集
正文：
场次 01｜预计时长：8 秒｜外景·院落·夜
画面与动作：甲推门进入院落。
对白/旁白：无
声音与氛围：风声。
场次 02｜预计时长：7 秒｜内景·书房·夜
画面与动作：乙在书桌前抬头。
对白/旁白：乙：你来了。
声音与氛围：无`;
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
      expect.objectContaining({ degraded: false, promptTraces: [] }),
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

  it("splits oversized plain text locally without semantic validation", async () => {
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
    const hooks = runtimeHooks();

    const result = await splitEpisodeIntoClips(
      "user-1",
      runtimeInput,
      hooks,
    );

    expect(result.degraded).toBe(false);
    expect(result.fallbackReason).toBeUndefined();
    expect(result.clips.map((clip) => clip.content).join("")).toBe(sourceText);
    expect(hooks.persistArtifact).toHaveBeenCalledWith(
      "clips.split",
      "episode-1",
      expect.objectContaining({ degraded: false }),
    );
  });

  it("does not depend on a provider while organizing clips", async () => {
    const sourceText = `${"甲在练武场挥剑。".repeat(120)}\n\n${"乙回到书房。".repeat(120)}`;
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

    const result = await splitEpisodeIntoClips(
      "user-1",
      runtimeInput,
      runtimeHooks(),
    );

    expect(result.clips.map((clip) => clip.content).join("")).toBe(sourceText);
    expect(result.promptTraces).toEqual([]);
  });

  it("rebuilds clips locally when a failed step is retried", async () => {
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
    const result = await splitEpisodeIntoClips(
      "user-1",
      { ...runtimeInput, resumeExisting: true },
      runtimeHooks(),
    );

    expect(result.degraded).toBe(false);
    expect(result.promptTraces).toEqual([]);
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

  it("ignores legacy Production Plan contracts while organizing readable text", async () => {
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

    expect(result.clips.map((item) => item.content).join("")).toBe(sourceText);
    expect(saveProductionClips.mock.calls[0][3]).toEqual([
      expect.objectContaining({
        content: sourceText,
        summary:
          "甲先咬牙，双手握拳，挥拳击出，衣袖震动，随后收拳站稳。 乙推开房门，跨过门槛，走到书桌前坐下，随后靠在椅背。",
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
