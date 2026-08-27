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
  validateActingCoverage,
  validateCinematographyCoverage,
  validateContinuityReview,
  validateStoryboardPlanning,
  validateStoryboardRefinement,
} from "@/lib/prompts/validators";
import {
  buildDeterministicStoryboardPhases,
  buildEpisodeStoryboard,
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
  episodeFindFirst.mockResolvedValue({ id: "episode-1" });
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
              "0-1s | 动作：甲开始说你好",
            ),
            sourceEvidence: ["你好"],
          }),
        ],
      }),
    );
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
          panel.motionTimeline.length === panel.durationSeconds,
      ),
    ).toBe(true);
    expect(
      validateStoryboardPlanning(result.planning, {
        sourceText,
        canonical: { characters: ["甲"], locations: ["书房"], props: [] },
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
      props: [{ name: "无字古籍", summary: null, metadata: {} }],
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
        shotType: "中景",
        cameraMove: "缓慢推近",
        durationSeconds: 3,
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
        sourceEvidence: ["你好"],
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
