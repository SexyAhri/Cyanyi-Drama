import { beforeEach, describe, expect, it, vi } from "vitest";

const requestOpenAiStructured = vi.hoisted(() => vi.fn());
const listProductionClips = vi.hoisted(() => vi.fn());
const listProductionProps = vi.hoisted(() => vi.fn());
const listNovelCharacters = vi.hoisted(() => vi.fn());
const listNovelLocations = vi.hoisted(() => vi.fn());
const saveStoryboard = vi.hoisted(() => vi.fn());
const episodeFindFirst = vi.hoisted(() => vi.fn());
const channelFindFirst = vi.hoisted(() => vi.fn());
const providerModelFindFirst = vi.hoisted(() => vi.fn());
const storyClipUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/llm/openai-structured", () => ({
  requestOpenAiStructured,
  isRetryableStructuredProviderError: (error: unknown) =>
    error instanceof Error &&
    (/^STRUCTURED_PROVIDER_TIMEOUT:/.test(error.message) ||
      /^STRUCTURED_PROVIDER_FAILED:(408|425|429|5\d\d):/.test(error.message)),
}));
vi.mock("@/lib/production/domain-store", () => ({
  listProductionClips,
  listProductionProps,
}));
vi.mock("./domain-store", () => ({
  listNovelCharacters,
  listNovelLocations,
  saveStoryboard,
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
    storyClip: { update: storyClipUpdate },
  },
}));

import { PROMPT_IDS } from "@/lib/prompts";
import {
  storyboardPlanningSchema,
  storyboardRefinementSchema,
} from "@/lib/prompts/schemas";
import {
  validateActingCoverage,
  validateCinematographyCoverage,
  validateContinuityReview,
  validateStoryboardPlanning,
  validateStoryboardRefinement,
} from "@/lib/prompts/validators";
import {
  buildDeterministicStoryboardPhases,
  buildEpisodeStoryboard,
  normalizeStoryboardPlanningProviderPayload,
  normalizeStoryboardRefinementProviderPayload,
  stitchStoryboardClipBoundaries,
  StoryboardBatchError,
} from "./script-to-storyboard-runtime";

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
  episodeFindFirst.mockImplementation(
    (query: { where?: { episodeNumber?: unknown } }) =>
      query.where?.episodeNumber
        ? Promise.resolve(null)
        : Promise.resolve({
            id: "episode-1",
            name: "第一集",
            description: "开篇",
            novelText: "甲在书房说你好。",
            episodeNumber: 1,
            project: { config: { artStyle: "chinese-animation" } },
          }),
  );
  channelFindFirst.mockResolvedValue({
    protocol: "openai-compatible",
    baseUrl: "https://provider.test/v1",
    encryptedApiKeys: '["key-1"]',
  });
  providerModelFindFirst.mockResolvedValue({ capabilitiesJson: "{}" });
  listNovelCharacters.mockResolvedValue([
    {
      name: "甲",
      aliases: [],
      profile: {},
      introduction: null,
    },
  ]);
  listNovelLocations.mockResolvedValue([{ name: "书房", summary: null }]);
  listProductionProps.mockResolvedValue([]);
  listProductionClips.mockResolvedValue([clip()]);
  storyClipUpdate.mockResolvedValue({});
  saveStoryboard.mockImplementation(
    async (
      _userId: string,
      _projectId: string,
      _episodeId: string,
      input: { panels: unknown[] },
    ) => ({ id: "storyboard-1", panels: input.panels }),
  );
});

describe("script-to-storyboard runtime", () => {
  it("stitches state and frame linkage across continuous clip boundaries", () => {
    const endState = {
      body: "甲立于书桌旁",
      hands: "右手按住古籍",
      gaze: "看向门口",
      screenDirection: "面向画面右侧",
      props: "古籍位于桌面",
    };
    const panels = stitchStoryboardClipBoundaries([
      {
        clipId: "clip-1",
        locationName: "书房",
        characters: ["甲"],
        startState: { ...endState, hands: "双手垂下" },
        endState,
        linkedToNextPanel: false,
      },
      {
        clipId: "clip-2",
        locationName: "书房",
        characters: ["甲"],
        startState: { ...endState, hands: "双手重置" },
        endState: { ...endState, gaze: "看向窗外" },
        linkedToNextPanel: false,
      },
    ]);

    expect(panels[0].linkedToNextPanel).toBe(true);
    expect(panels[1].startState).toEqual(endState);
  });

  it("persists clip identity, global panel order, and phase details", async () => {
    requestOpenAiStructured.mockImplementation(successfulPhaseResponse);
    const hooks = artifactHooks();

    const result = await buildEpisodeStoryboard(
      "user-1",
      runtimeInput,
      hooks,
    );

    expect(result).toMatchObject({
      clipCount: 1,
      panelCount: 1,
      continuityIssueCount: 0,
    });
    expect(result.promptTraces).toHaveLength(5);
    expect(saveStoryboard).toHaveBeenCalledWith(
      "user-1",
      "project-1",
      "episode-1",
      expect.objectContaining({
        status: "ready",
        panels: [
          expect.objectContaining({
            clipId: "clip-1",
            clipPanelIndex: 0,
            panelIndex: 0,
            phase: "continuity",
            durationSeconds: 3,
            videoPrompt: expect.stringContaining(
              "0-1s | 节拍：普通动作 | 触发：承接上一状态",
            ),
            vfxCues: [],
            sfxCues: [],
            sourceEvidence: ["你好", "甲说：你好。"],
          }),
        ],
      }),
    );
    const savedPanel = saveStoryboard.mock.calls[0]?.[3]?.panels?.[0] as {
      videoPrompt?: string;
    };
    expect(savedPanel.videoPrompt).toContain("角色表演与心理外化");
    expect(savedPanel.videoPrompt).toContain(
      "甲 | 表演优先级：primary",
    );
    expect(savedPanel.videoPrompt).toContain("动作与反应：说话");
    expect(savedPanel.videoPrompt).toContain("潜台词=先观察对方是否理解");
    expect(hooks.persistArtifact).toHaveBeenCalledWith(
      "storyboard.clip.phase3",
      "clip-1",
      expect.objectContaining({ success: true }),
    );
  });

  it("reuses successful phases and requests only failed downstream work", async () => {
    let failActing = true;
    requestOpenAiStructured.mockImplementation((input: PhaseRequest) => {
      if (input.prompt.id === PROMPT_IDS.STORY_ACTING_DIRECTION && failActing)
        return Promise.reject(new Error("acting unavailable"));
      return successfulPhaseResponse(input);
    });
    const hooks = artifactHooks();

    await expect(
      buildEpisodeStoryboard("user-1", runtimeInput, hooks),
    ).rejects.toBeInstanceOf(StoryboardBatchError);
    expect(artifact(hooks, "storyboard.clip.phase1", "clip-1")).toMatchObject({
      success: true,
    });
    expect(
      artifact(hooks, "storyboard.clip.phase2.cine", "clip-1"),
    ).toMatchObject({ success: true });
    expect(
      artifact(hooks, "storyboard.clip.phase2.acting", "clip-1"),
    ).toMatchObject({ success: false });

    failActing = false;
    requestOpenAiStructured.mockClear();
    const retried = await buildEpisodeStoryboard(
      "user-1",
      runtimeInput,
      hooks,
    );

    const requestedPromptIds = requestOpenAiStructured.mock.calls.map(
      (call) => (call[0] as PhaseRequest).prompt.id,
    );
    expect(requestedPromptIds).toEqual([
      PROMPT_IDS.STORY_ACTING_DIRECTION,
      PROMPT_IDS.STORY_STORYBOARD_REFINEMENT,
      PROMPT_IDS.STORY_CONTINUITY_REVIEW,
    ]);
    expect(retried.results[0].reusedPhases).toEqual([
      "phase1",
      "phase2.cine",
    ]);
  });

  it.each([
    ["STRUCTURED_PROVIDER_FAILED:524:Provider gateway timeout", "PROVIDER_HTTP_524"],
    ["STRUCTURED_PROVIDER_TIMEOUT:120000", "PROVIDER_TIMEOUT"],
    [
      "STRUCTURED_SEMANTIC_INVALID:panels: [SPOKEN_SEQUENCE_MISMATCH] expected voiceover",
      "STRUCTURED_SEMANTIC_INVALID",
    ],
    [
      "STRUCTURED_SCHEMA_INVALID:panels.0.startState.props: expected string",
      "STRUCTURED_SCHEMA_INVALID",
    ],
  ])(
    "persists a valid deterministic storyboard after %s",
    async (message, fallbackReason) => {
      requestOpenAiStructured.mockRejectedValue(new Error(message));
      const hooks = artifactHooks();

      const result = await buildEpisodeStoryboard(
        "user-1",
        runtimeInput,
        hooks,
      );

      expect(result).toMatchObject({
        clipCount: 1,
        panelCount: 1,
        degradedCount: 1,
        results: [
          expect.objectContaining({
            success: true,
            degraded: true,
            fallbackReason,
          }),
        ],
      });
      const fallback = artifact(
        hooks,
        "storyboard.clip.fallback",
        "clip-1",
      ) as { data: ReturnType<typeof buildDeterministicStoryboardPhases> };
      expect(fallback).toMatchObject({
        success: true,
        degraded: true,
        fallbackReason,
      });
      expectFallbackToPassValidators(fallback.data);
      expect(fallback.data.refinement.panels[0].description.length).toBeLessThanOrEqual(
        243,
      );
      expect(storyClipUpdate).toHaveBeenLastCalledWith({
        where: { id: "clip-1" },
        data: { status: "storyboard_ready", shotCount: 1 },
      });

      requestOpenAiStructured.mockClear();
      const reused = await buildEpisodeStoryboard(
        "user-1",
        runtimeInput,
        hooks,
      );
      expect(requestOpenAiStructured).not.toHaveBeenCalled();
      expect(reused.results[0]).toMatchObject({
        degraded: true,
        fallbackReason,
        reusedPhases: ["fallback"],
      });
    },
  );

  it("keeps non-retryable provider errors as workflow failures", async () => {
    requestOpenAiStructured.mockRejectedValue(
      new Error("STRUCTURED_PROVIDER_FAILED:400:invalid request"),
    );
    const hooks = artifactHooks();

    await expect(
      buildEpisodeStoryboard("user-1", runtimeInput, hooks),
    ).rejects.toBeInstanceOf(StoryboardBatchError);

    expect(artifact(hooks, "storyboard.clip.fallback", "clip-1")).toBeUndefined();
    expect(storyClipUpdate).toHaveBeenLastCalledWith({
      where: { id: "clip-1" },
      data: { status: "storyboard_failed" },
    });
  });

  it("invalidates acting cache when character context changes", async () => {
    requestOpenAiStructured.mockImplementation(successfulPhaseResponse);
    const hooks = artifactHooks();

    await buildEpisodeStoryboard("user-1", runtimeInput, hooks);
    requestOpenAiStructured.mockClear();
    listNovelCharacters.mockResolvedValue([
      {
        name: "甲",
        aliases: [],
        profile: { temperament: "说话前先观察对方反应" },
        introduction: null,
      },
    ]);

    const rerun = await buildEpisodeStoryboard("user-1", runtimeInput, hooks);
    const requestedPromptIds = requestOpenAiStructured.mock.calls.map(
      (call) => (call[0] as PhaseRequest).prompt.id,
    );

    expect(requestedPromptIds).toEqual([
      PROMPT_IDS.STORY_STORYBOARD_PLANNING,
      PROMPT_IDS.STORY_ACTING_DIRECTION,
      PROMPT_IDS.STORY_STORYBOARD_REFINEMENT,
      PROMPT_IDS.STORY_CONTINUITY_REVIEW,
    ]);
    expect(rerun.results[0].reusedPhases).toEqual(["phase2.cine"]);
  });

  it("normalizes continuity prop arrays before planning schema parsing", () => {
    const raw = planning();
    raw.panels[0].startState.props = ["长剑", "护符"] as unknown as string;
    raw.panels[0].endState.props = [] as unknown as string;

    const normalized = normalizeStoryboardPlanningProviderPayload(raw);

    expect(normalized).toMatchObject({
      panels: [
        expect.objectContaining({
          startState: expect.objectContaining({ props: "长剑、护符" }),
          endState: expect.objectContaining({ props: "无" }),
        }),
      ],
    });
    expect(storyboardPlanningSchema.safeParse(normalized).success).toBe(true);
  });

  it("removes only the known extra clipId from refinement payloads", () => {
    const raw = { clipId: "clip-1", ...planning() };
    const normalized = normalizeStoryboardRefinementProviderPayload(raw);

    expect(normalized).toEqual(planning());
    expect(storyboardRefinementSchema.safeParse(normalized).success).toBe(true);

    const unexpected = { ...raw, summary: "extra" };
    expect(normalizeStoryboardRefinementProviderPayload(unexpected)).toBe(
      unexpected,
    );
    expect(storyboardRefinementSchema.safeParse(unexpected).success).toBe(false);
  });

  it("splits long fallback scenes into video-sized shots with complete beats", () => {
    const longAction = Array.from(
      { length: 12 },
      (_, index) => `甲完成第${index + 1}个连续训练动作。`,
    ).join("");
    const screenplay = {
      clipId: "clip-1",
      originalText: longAction,
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "书房", time: "夜" },
          description: longAction,
          characters: ["甲"],
          content: [{ type: "action" as const, text: longAction }],
        },
      ],
    };
    const sourceText = JSON.stringify(screenplay, null, 2);
    const result = buildDeterministicStoryboardPhases({
      canonical: { characters: ["甲"], locations: ["书房"], props: [] },
      clip: { ...clip(), content: longAction },
      props: [],
      screenplay,
      sourceText,
    });

    expect(result.planning.panels.length).toBeGreaterThan(1);
    expect(
      result.planning.panels.every(
        (panel) =>
          panel.durationSeconds >= 1 &&
          panel.durationSeconds <= 15 &&
          panel.motionTimeline[0]?.startSecond === 0 &&
          panel.motionTimeline.at(-1)?.endSecond === panel.durationSeconds,
      ),
    ).toBe(true);
    expect(
      validateStoryboardPlanning(result.planning, {
        sourceText,
        canonical: { characters: ["甲"], locations: ["书房"], props: [] },
      }),
    ).toEqual([]);
  });

  it("keeps screenplay VFX and SFX design in deterministic fallback panels", () => {
    const source = "林澈施展青霄剑诀，剑光击中石壁，碎石迸裂。";
    const screenplay = {
      clipId: "clip-1",
      originalText: source,
      coverage: [
        {
          eventId: "E001",
          evidence: source,
          modes: ["visual" as const],
          reason: null,
        },
      ],
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "石室", time: "夜" },
          description: "石室夜间",
          characters: ["林澈"],
          content: [
            {
              type: "action" as const,
              text: source,
              origin: "source" as const,
              actionDesign: {
                kind: "skill" as const,
                performer: "林澈",
                target: "石壁",
                realm: null,
                technique: "青霄剑诀",
                visualMotif: "青白剑气呈窄长弧线，银色边缘粒子快速收束消散",
                visualMotifSource: "production_inference" as const,
                visualMotifRationale: "依据剑诀与项目画风建立跨集表现",
                choreography: ["林澈沉肩起剑", "挥剑释放剑光", "石壁碎裂后收势"],
                impact: "剑光击中石壁，碎石迸裂",
                environmentResponse: "石壁碎石迸裂",
                vfxPlan: [
                  {
                    phase: "release" as const,
                    category: "weapon_trail" as const,
                    description: "青白剑光沿挥剑方向延伸",
                  },
                ],
                sfxPlan: [
                  {
                    phase: "impact" as const,
                    type: "destruction" as const,
                    description: "剑光命中与碎石爆裂",
                  },
                ],
                evidence: [source],
              },
            },
          ],
        },
      ],
    };
    const sourceText = JSON.stringify(screenplay, null, 2);
    const result = buildDeterministicStoryboardPhases({
      canonical: { characters: ["林澈"], locations: ["石室"], props: [] },
      clip: { ...clip(), content: source },
      props: [],
      screenplay,
      sourceText,
    });

    expect(result.planning.panels[0]).toMatchObject({
      startState: {
        environmentState: {
          keyLightSource: expect.any(String),
          damageState: [],
          particles: [],
        },
      },
      worldContext: {
        technique: "青霄剑诀",
        visualMotif: "青白剑气呈窄长弧线，银色边缘粒子快速收束消散",
        shotIntent: {
          primaryVisibleEvent: expect.any(String),
          endBeat: expect.any(String),
        },
        constraints: {
          mustHold: expect.any(Array),
          changesHere: expect.any(Array),
          mustNotAppear: expect.arrayContaining([
            expect.stringContaining("穿模"),
          ]),
        },
        riskFocus: expect.arrayContaining(["interaction_physics"]),
      },
      motionTimeline: [
        expect.objectContaining({
          trigger: expect.any(String),
          preparation: expect.any(String),
          forceSource: expect.any(String),
          settle: expect.any(String),
        }),
        expect.any(Object),
        expect.objectContaining({ contactMaterial: expect.any(String) }),
      ],
      vfxCues: [{ category: "weapon_trail" }],
      sfxCues: [{ type: "destruction" }],
    });
    expect(result.cinematography.rules[0]).toMatchObject({
      cameraStart: expect.any(Object),
      cameraPath: { primaryMovement: expect.any(String) },
      cameraEnd: { nextCutPoint: expect.any(String) },
    });
    expect(result.acting.directions[0]?.characters[0]).toMatchObject({
      performancePriority: expect.any(String),
      allowedMicroMotion: expect.any(String),
      beats: [
        expect.objectContaining({
          trigger: expect.any(String),
          microPause: expect.any(String),
          breath: expect.any(String),
          weightShift: expect.any(String),
        }),
      ],
    });
    expect(
      validateStoryboardPlanning(result.planning, {
        sourceText,
        canonical: { characters: ["林澈"], locations: ["石室"], props: [] },
        screenplay,
      }),
    ).toEqual([]);
  });

  it("keeps a voice-over speaker and abbreviated key prop on fallback panels", () => {
    const screenplay = {
      clipId: "clip-1",
      originalText: "韩子枫望着古籍，若自己没有重伤，韩宇本可早早突破。",
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "书房", time: "夜" },
          description: "",
          characters: ["韩子枫", "韩宇"],
          content: [
            {
              type: "voiceover" as const,
              character: "韩子枫",
              text: "若自己没有重伤，韩宇本可早早突破。",
            },
            { type: "action" as const, text: "韩子枫望着古籍。" },
          ],
        },
      ],
    };
    const sourceText = JSON.stringify(screenplay, null, 2);
    const result = buildDeterministicStoryboardPhases({
      canonical: {
        characters: ["韩子枫", "韩宇"],
        locations: ["书房"],
        props: ["无字古籍"],
      },
      clip: { ...clip(), content: screenplay.originalText },
      props: [
        { name: "无字古籍", summary: null, metadata: {}, visualProfile: {} },
      ],
      screenplay,
      sourceText,
    });

    expect(result.refinement.panels[0].characters).toEqual(["韩子枫"]);
    expect(result.refinement.panels[1].props).toEqual(["无字古籍"]);
  });
});

type PhaseRequest = { prompt: { id: string } };

function artifactHooks() {
  const artifacts = new Map<string, unknown>();
  return {
    artifacts,
    assertActive: vi.fn().mockResolvedValue(undefined),
    persistArtifact: vi.fn(
      async (artifactType: string, refId: string, payload: unknown) => {
        artifacts.set(`${artifactType}:${refId}`, payload);
      },
    ),
    loadArtifact: vi.fn(async (artifactType: string, refId: string) =>
      artifacts.get(`${artifactType}:${refId}`) ?? null,
    ),
  };
}

function artifact(
  hooks: ReturnType<typeof artifactHooks>,
  artifactType: string,
  refId: string,
) {
  return hooks.artifacts.get(`${artifactType}:${refId}`);
}

function successfulPhaseResponse(input: PhaseRequest) {
  if (input.prompt.id === PROMPT_IDS.STORY_STORYBOARD_PLANNING)
    return Promise.resolve({ data: planning(), trace: trace(input.prompt.id) });
  if (input.prompt.id === PROMPT_IDS.STORY_CINEMATOGRAPHY)
    return Promise.resolve({
      data: {
        rules: [
          {
            panelIndex: 0,
            camera: "平视中景",
            cameraPosition: "角色正前方两米",
            focalLength: "50mm",
            lighting: "窗侧自然光",
            composition: "甲位于画面左侧",
            depthOfField: "中等景深",
            colorTone: "中性色调",
          },
        ],
      },
      trace: trace(input.prompt.id),
    });
  if (input.prompt.id === PROMPT_IDS.STORY_ACTING_DIRECTION)
    return Promise.resolve({
      data: {
        directions: [
          {
            panelIndex: 0,
            characters: [
              {
                name: "甲",
                emotion: "平静",
                action: "说话",
                expression: "自然",
                evidence: ["你好"],
                beats: [
                  {
                    startSecond: 0,
                    endSecond: 3,
                    objective: "确认对方听清问候",
                    subtext: "先观察对方是否理解",
                    action: "自然说出问候并观察",
                    expression: "语气平稳，目光专注",
                    gazeTarget: "对方",
                    reactionTo: null,
                    evidence: ["你好"],
                  },
                ],
              },
            ],
          },
        ],
      },
      trace: trace(input.prompt.id),
    });
  if (input.prompt.id === PROMPT_IDS.STORY_STORYBOARD_REFINEMENT)
    return Promise.resolve({ data: planning(), trace: trace(input.prompt.id) });
  return Promise.resolve({
    data: { passed: true, issues: [] },
    trace: trace(input.prompt.id),
  });
}

function planning() {
  return {
    panels: [
      {
        panelIndex: 0,
        sceneNumber: 0,
        shotType: "中景",
        cameraMove: "缓慢推近",
        durationSeconds: 3,
        startState: {
          body: "甲站在书房",
          hands: "双手自然垂下",
          gaze: "看向前方",
          screenDirection: "面向画面左侧",
          props: "无关键道具变化",
        },
        endState: {
          body: "甲站在书房",
          hands: "双手自然垂下",
          gaze: "看向前方",
          screenDirection: "面向画面左侧",
          props: "无关键道具变化",
        },
        speakingCharacter: "甲",
        lipSyncText: "你好",
        voiceoverText: null,
        motionTimeline: [
          {
            startSecond: 0,
            endSecond: 1,
            action: "甲开始说你好",
            camera: "中景开始缓慢推近",
          },
          {
            startSecond: 1,
            endSecond: 2,
            action: "甲自然说完后半句",
            camera: "沿原方向继续推近",
          },
          {
            startSecond: 2,
            endSecond: 3,
            action: "甲说完后自然停顿",
            camera: "推近至近景并停稳",
          },
        ],
        description: "甲在书房说你好",
        locationName: "书房",
        characters: ["甲"],
        props: [],
        imagePrompt: "甲在书房",
        videoPrompt: "甲说你好",
        sourceEvidence: ["你好", "甲说：你好。"],
      },
    ],
  };
}

function expectFallbackToPassValidators(
  data: ReturnType<typeof buildDeterministicStoryboardPhases>,
) {
  const sourceText = JSON.stringify(JSON.parse(clip().screenplay), null, 2);
  const canonical = {
    characters: ["甲"],
    locations: ["书房"],
    props: [] as string[],
  };
  expect(
    validateStoryboardPlanning(data.planning, { sourceText, canonical }),
  ).toEqual([]);
  expect(
    validateCinematographyCoverage(data.cinematography, [0]),
  ).toEqual([]);
  expect(validateActingCoverage(data.acting, data.planning.panels)).toEqual([]);
  expect(
    validateStoryboardRefinement(data.refinement, data.planning.panels),
  ).toEqual([]);
  expect(
    validateContinuityReview(data.continuity, {
      panelIndices: [0],
      canonical,
    }),
  ).toEqual([]);
}

function clip() {
  return {
    id: "clip-1",
    projectId: "project-1",
    episodeId: "episode-1",
    clipIndex: 0,
    summary: "问候",
    content: "甲说：你好。",
    startText: "甲说",
    endText: "你好。",
    screenplay: JSON.stringify({
      clipId: "clip-1",
      originalText: "甲说：你好。",
      coverage: [
        {
          eventId: "E001",
          evidence: "甲说：你好。",
          modes: ["dialogue"],
          reason: null,
        },
      ],
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT", location: "书房", time: "日" },
          description: "",
          characters: ["甲"],
          content: [
            {
              type: "dialogue",
              character: "甲",
              parenthetical: null,
              lines: "你好",
            },
          ],
        },
      ],
    }),
    characters: ["甲"],
    locations: ["书房"],
    props: [],
    shotCount: null,
    status: "screenplay_ready",
    shots: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function trace(promptId: string) {
  return {
    promptId,
    agentId: "agent",
    promptVersion: 2,
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
