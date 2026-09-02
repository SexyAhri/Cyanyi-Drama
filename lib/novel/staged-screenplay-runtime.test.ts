import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  screenplayAssemblySceneSchema,
  screenplayBeatPlanSchema,
} from "@/lib/prompts/schemas";

const listProductionClips = vi.hoisted(() => vi.fn());
const storyClipUpdate = vi.hoisted(() => vi.fn());
const loadLocalScreenplayContext = vi.hoisted(() => vi.fn());

vi.mock("@/lib/production/domain-store", () => ({ listProductionClips }));
vi.mock("@/lib/server/prisma", () => ({
  prisma: { storyClip: { update: storyClipUpdate } },
}));
vi.mock("./story-to-script-runtime", () => ({
  buildClipProductionContracts: vi.fn(() => new Map()),
  loadLocalScreenplayContext,
  mapWithConcurrency: async <T, R>(
    values: T[],
    _concurrency: number,
    worker: (value: T, index: number) => Promise<R>,
  ) => Promise.all(values.map(worker)),
}));

import {
  normalizeAssemblyScenePayload,
  normalizeBeatPlanPayload,
} from "./screenplay-stage-normalization";
import {
  assembleEpisodeScreenplays,
  assembleSceneLocally,
  generateEpisodeScreenplayBeats,
  isProducibleScreenplay,
} from "./staged-screenplay-runtime";

const runtimeInput = {
  projectId: "project-1",
  episodeId: "episode-1",
  channelId: "channel-1",
  model: "model-1",
  locale: "zh" as const,
  concurrency: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  listProductionClips.mockResolvedValue([
    {
      id: "clip-1",
      clipIndex: 0,
      content: "韩宇举起铁石。",
      screenplay: null,
      status: "split_ready",
    },
  ]);
  loadLocalScreenplayContext.mockResolvedValue({
    sourceText: "韩宇举起铁石。",
    productionPlan: null,
    characters: [{ name: "韩宇" }],
    locations: [{ name: "练武场" }],
    props: [{ name: "铁石" }],
    canonical: {
      characters: ["韩宇"],
      locations: ["练武场"],
      props: ["铁石"],
    },
    worldBibleText: "{}",
    projectStyleDirective: "国风动画",
    storyWorldDirective: "前现代世界",
    effectLibrary: [],
    previousEpisodeHandoff: {
      episodeId: "episode-0",
      episodeNumber: 1,
      episodeName: "第一集",
      episodeSummary: "韩宇得到无字典籍。",
      finalScene: null,
      finalPanel: {
        panelIndex: 8,
        description: "韩宇捧着典籍。",
        locationName: "卧房",
        characters: ["韩宇"],
        props: ["无字典籍"],
        endState: { heldBy: "韩宇" },
        worldContext: { time: "夜" },
      },
    },
    workflowConcurrency: 1,
    provider: {
      baseUrl: "https://provider.test/v1",
      apiKeys: ["key"],
      model: "model-1",
      stream: true,
      timeoutMs: 600_000,
      maxTransportAttempts: 1,
    },
  });
  storyClipUpdate.mockResolvedValue({});
});

describe("staged screenplay generation", () => {
  it("organizes approved scene text locally without another model request", async () => {
    listProductionClips.mockResolvedValue([
      {
        id: "clip-1",
        clipIndex: 0,
        content: `场次 01｜预计时长：10 秒｜外景·练武场·夜
画面与动作：韩宇屈膝发力，举起铁石后平稳落地。
镜头表达：中景稳定跟随。
对白/旁白：韩宇（内心独白）：我一定要变强；旁白：寒风掠过练武场。
声音与氛围：寒风声、铁石落地闷响。`,
        screenplay: null,
        status: "split_ready",
      },
    ]);
    const hooks = runtimeHooks();

    const result = await generateEpisodeScreenplayBeats(
      "user-1",
      runtimeInput,
      hooks,
    );

    expect(result.clipCount).toBe(1);
    expect(result.locallyConvertedCount).toBe(1);
    expect(hooks.persistArtifact).toHaveBeenCalledWith(
      "screenplay.beats.raw",
      "clip-1",
      expect.objectContaining({
        locallyConverted: true,
      }),
    );
    expect(hooks.persistArtifact).toHaveBeenCalledWith(
      "screenplay.beats",
      "clip-1",
      expect.objectContaining({
        clipId: "clip-1",
        scenes: [
          expect.objectContaining({
            heading: { intExt: "EXT", location: "练武场", time: "夜" },
            beats: [{ text: "韩宇屈膝发力，举起铁石后平稳落地。" }],
          }),
        ],
      }),
    );
  });

  it("keeps plain text as a producible action instead of rejecting it", async () => {
    const hooks = runtimeHooks();

    const result = await generateEpisodeScreenplayBeats(
      "user-1",
      runtimeInput,
      hooks,
    );

    expect(result.locallyConvertedCount).toBe(1);
    expect(hooks.persistArtifact).toHaveBeenCalledWith(
      "screenplay.beats.raw",
      "clip-1",
      expect.objectContaining({ locallyConverted: true }),
    );
    const derived = hooks.persistArtifact.mock.calls.find(
      ([type]) => type === "screenplay.beats",
    )?.[2];
    expect(screenplayBeatPlanSchema.safeParse(derived).success).toBe(true);
  });

  it("assembles approved stage outputs locally without another model request", async () => {
    const hooks = runtimeHooks();
    await hooks.persistArtifact("screenplay.beats", "clip-1", {
      clipId: "clip-1",
      scenes: [
        {
          heading: { intExt: "INT", location: "卧房", time: "夜" },
          description: "灯火摇曳。",
          characters: ["韩子枫"],
          beats: [{ text: "韩子枫转身。" }],
        },
      ],
    });
    await hooks.persistArtifact("screenplay.dialogue", "clip-1", {
      clipId: "clip-1",
      lines: [
        {
          sceneIndex: 0,
          afterBeatIndex: 0,
          character: "韩子枫",
          parenthetical: null,
          lines: "宇儿，你回来了。",
        },
      ],
    });
    await hooks.persistArtifact("screenplay.narration", "clip-1", {
      clipId: "clip-1",
      lines: [],
    });
    await hooks.persistArtifact("screenplay.effects", "clip-1", {
      clipId: "clip-1",
      designs: [],
    });

    await assembleEpisodeScreenplays("user-1", runtimeInput, hooks);

    const screenplay = JSON.parse(
      storyClipUpdate.mock.calls.at(-1)?.[0].data.screenplay,
    );
    expect(screenplay.scenes[0].content).toEqual([
      { type: "action", text: "韩子枫转身。" },
      {
        type: "dialogue",
        character: "韩子枫",
        parenthetical: null,
        lines: "宇儿，你回来了。",
      },
    ]);
  });
});

describe("screenplay stage normalization", () => {
  it("forms a filmable scene from loose model fields without semantic IDs", () => {
    const plan = normalizeBeatPlanPayload(
      {
        scenes: [
          {
            sceneNumber: 8,
            heading: { location: "练武场", time: "夜" },
            content: [
              { type: "action", text: "韩宇抱起铁石。", beatId: "wrong" },
              { type: "dialogue", lines: "不放弃。" },
            ],
          },
        ],
      },
      {
        clipId: "clip-1",
        clipText: "韩宇抱起铁石。",
        canonical: { characters: ["韩宇"], locations: ["练武场"] },
      },
    );

    expect(screenplayBeatPlanSchema.parse(plan)).toEqual(
      expect.objectContaining({
        clipId: "clip-1",
        scenes: [
          expect.objectContaining({
            heading: { intExt: "EXT", location: "练武场", time: "夜" },
            beats: [{ text: "韩宇抱起铁石。" }],
          }),
        ],
      }),
    );
    expect(JSON.stringify(plan)).not.toMatch(/beatId|sceneNumber/);
  });

  it("keeps prepared dialogue, narration, and effects when AI assembly omits them", () => {
    const fallback = assembleSceneLocally({
      scene: {
        heading: { intExt: "INT", location: "屋内", time: "夜" },
        description: "灯火摇曳",
        characters: ["韩宇"],
        beats: [{ text: "韩宇推门而入。" }],
      },
      dialogue: [
        {
          sceneIndex: 0,
          afterBeatIndex: 0,
          character: "韩宇",
          parenthetical: null,
          lines: "父亲，我回来了。",
        },
      ],
      narration: [
        {
          sceneIndex: 0,
          afterBeatIndex: null,
          character: null,
          text: "深冬入夜。",
        },
      ],
      effects: [
        {
          sceneIndex: 0,
          beatIndex: 0,
          actionDesign: effectDesign(),
        },
      ],
    });
    const assembled = normalizeAssemblyScenePayload(
      {
        scene: {
          heading: { intExt: "INT", location: "屋内", time: "夜" },
          description: "灯火摇曳",
          characters: ["韩宇"],
          content: [{ type: "action", text: "韩宇跨进屋内。" }],
        },
      },
      fallback,
    );

    expect(screenplayAssemblySceneSchema.safeParse(assembled).success).toBe(true);
    expect(assembled.scene.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "action", actionDesign: effectDesign() }),
        expect.objectContaining({
          type: "dialogue",
          lines: "父亲，我回来了。",
        }),
        expect.objectContaining({ type: "voiceover", text: "深冬入夜。" }),
      ]),
    );
    expect(
      isProducibleScreenplay({
        clipId: "clip-1",
        originalText: "韩宇推门而入。",
        scenes: [{ sceneNumber: 0, ...assembled.scene }],
      }),
    ).toBe(true);
  });
});

function runtimeHooks() {
  const artifacts = new Map<string, unknown>();
  return {
    assertActive: vi.fn().mockResolvedValue(undefined),
    persistArtifact: vi.fn(
      async (artifactType: string, refId: string, payload: unknown) => {
        artifacts.set(`${artifactType}:${refId}`, payload);
      },
    ),
    loadRunArtifact: vi.fn(async (artifactType: string, refId: string) =>
      artifacts.get(`${artifactType}:${refId}`) ?? null,
    ),
  };
}

function effectDesign() {
  return {
    kind: "phenomenon" as const,
    performer: "环境",
    target: null,
    realm: null,
    technique: null,
    visualMotif: "灯火被风压低",
    visualMotifSource: "production_inference" as const,
    visualMotifRationale: "增强寒夜氛围",
    choreography: ["冷风穿过门缝，灯火向内倾斜"],
    impact: null,
    environmentResponse: "室内明暗短暂变化",
    vfxPlan: [],
    sfxPlan: [],
    evidence: ["深冬入夜"],
  };
}
