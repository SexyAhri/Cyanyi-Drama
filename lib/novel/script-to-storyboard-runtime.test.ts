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

vi.mock("@/lib/llm/openai-structured", () => ({ requestOpenAiStructured }));
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
        cameraMove: null,
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
