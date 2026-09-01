import { beforeEach, describe, expect, it, vi } from "vitest";

import { StructuredOutputError } from "@/lib/llm/structured-output";
import {
  screenplayAssemblySceneSchema,
  screenplayBeatPlanSchema,
} from "@/lib/prompts/schemas";

const requestOpenAiStructured = vi.hoisted(() => vi.fn());
const listProductionClips = vi.hoisted(() => vi.fn());
const storyClipUpdate = vi.hoisted(() => vi.fn());
const loadStoryContext = vi.hoisted(() => vi.fn());

vi.mock("@/lib/llm/openai-structured", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/llm/openai-structured")
  >()),
  requestOpenAiStructured,
}));
vi.mock("@/lib/production/domain-store", () => ({ listProductionClips }));
vi.mock("@/lib/server/prisma", () => ({
  prisma: { storyClip: { update: storyClipUpdate } },
}));
vi.mock("./story-to-script-runtime", () => ({
  buildClipProductionContracts: vi.fn(() => new Map()),
  loadStoryContext,
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
  assembleSceneLocally,
  generateEpisodeScreenplayBeats,
  isProducibleScreenplay,
  ScreenplayStageBatchError,
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
  loadStoryContext.mockResolvedValue({
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
  it("persists the raw model response and a locally normalized beat plan", async () => {
    requestOpenAiStructured.mockResolvedValue({
      data: {
        clipId: "model-changed-this-id",
        scenes: [
          {
            location: "练武场",
            actions: ["韩宇屈膝发力，举起铁石。"],
          },
        ],
      },
      outputText: '{"scenes":[{"location":"练武场"}]}',
      trace: trace("story_screenplay_beats"),
    });
    const hooks = runtimeHooks();

    const result = await generateEpisodeScreenplayBeats(
      "user-1",
      runtimeInput,
      hooks,
    );

    expect(result.clipCount).toBe(1);
    expect(requestOpenAiStructured).toHaveBeenCalledTimes(1);
    expect(hooks.persistArtifact).toHaveBeenCalledWith(
      "screenplay.beats.raw",
      "clip-1",
      expect.objectContaining({
        outputText: '{"scenes":[{"location":"练武场"}]}',
      }),
    );
    expect(hooks.persistArtifact).toHaveBeenCalledWith(
      "screenplay.beats",
      "clip-1",
      expect.objectContaining({
        clipId: "clip-1",
        scenes: [
          expect.objectContaining({
            beats: [{ text: "韩宇屈膝发力，举起铁石。" }],
          }),
        ],
      }),
    );
  });

  it("converts a non-JSON model response locally without another request", async () => {
    requestOpenAiStructured.mockRejectedValue(
      new StructuredOutputError(
        "STRUCTURED_JSON_INVALID",
        ["not json"],
        "韩宇屈膝发力，终于举起铁石。",
      ),
    );
    const hooks = runtimeHooks();

    const result = await generateEpisodeScreenplayBeats(
      "user-1",
      runtimeInput,
      hooks,
    );

    expect(requestOpenAiStructured).toHaveBeenCalledTimes(1);
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

  it("does not retry a provider network failure", async () => {
    requestOpenAiStructured.mockRejectedValue(
      new Error("STRUCTURED_PROVIDER_FAILED:524:gateway timeout"),
    );

    await expect(
      generateEpisodeScreenplayBeats(
        "user-1",
        runtimeInput,
        runtimeHooks(),
      ),
    ).rejects.toBeInstanceOf(ScreenplayStageBatchError);
    expect(requestOpenAiStructured).toHaveBeenCalledTimes(1);
    expect(storyClipUpdate).toHaveBeenLastCalledWith({
      where: { id: "clip-1" },
      data: { status: "screenplay_failed" },
    });
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

function trace(promptId: string) {
  return {
    promptId,
    agentId: "agent",
    promptVersion: 1,
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
