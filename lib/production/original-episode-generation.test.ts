import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { StructuredValidationIssue } from "@/lib/llm/structured-output";
import type { SourceTaskHooks } from "@/lib/episodes/long-source";
import type { StoryPackage } from "./story-package-contract";

const mocks = vi.hoisted(() => ({
  episode: vi.fn(), previous: vi.fn(), packages: vi.fn(), request: vi.fn(), provider: vi.fn(),
  assets: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/server/prisma", () => ({ prisma: {
  episode: { findFirst: mocks.episode, findUnique: mocks.previous },
  productionDeliverable: { findMany: mocks.packages },
  novelCharacter: { findMany: mocks.assets }, novelLocation: { findMany: mocks.assets }, novelProp: { findMany: mocks.assets },
  $transaction: mocks.transaction,
} }));
vi.mock("@/lib/llm/openai-structured", () => ({ requestOpenAiStructured: mocks.request }));
vi.mock("@/lib/episodes/provider", () => ({ resolveEpisodeTextProvider: mocks.provider }));

import { generateOriginalEpisode } from "./original-episode-generation";
import { normalizeOriginalEpisodeOutput } from "./original-episode-contract";
import { StoryPackageFirstEpisodeSchema } from "./story-package-contract";
import { makePackage } from "./story-package-test-fixture";

const input = { userId: "user", projectId: "project", episodeId: "episode-2", channelId: "channel", model: "fixture", locale: "zh" as const, workflowId: "workflow" };
type EpisodeOutput = { episode: StoryPackage["firstEpisode"] };
type EpisodeRequest = { schema: z.ZodType<EpisodeOutput>; validate: (value: EpisodeOutput) => StructuredValidationIssue[]; prompt: { text: string } };
const hooks = (cached?: EpisodeOutput): SourceTaskHooks => ({
  assertActive: vi.fn(async () => {}),
  loadArtifact: vi.fn(async (type: string) => type === "original.episode" ? cached ?? null : null),
  persistArtifact: vi.fn(async () => {}),
});
function setStory(story: StoryPackage) {
  mocks.packages.mockResolvedValue([{ id: "package", version: 1, payload: { packageFormat: "cyanyi-story-package-v1", adoption: { episodeIds: [input.episodeId] }, storyPackage: story } }]);
}
async function inspectRequest(instructions?: string, cache?: EpisodeOutput) {
  await expect(generateOriginalEpisode({ ...input, instructions }, hooks(cache))).rejects.toThrow("STOP_AT_REQUEST");
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.transaction).not.toHaveBeenCalled();
  return mocks.request.mock.calls[0][0] as EpisodeRequest;
}

beforeEach(() => {
  vi.resetAllMocks();
  setStory(makePackage());
  mocks.episode.mockResolvedValue({ id: input.episodeId, episodeNumber: 2, project: { config: { episodeTargetDurationSeconds: 95 } } });
  mocks.previous.mockResolvedValue({ id: "episode-1", name: "前集", novelText: "阿青把旧零件放在炉边。" });
  mocks.provider.mockResolvedValue({ baseUrl: "https://example.invalid", apiKeys: ["fixture"], model: "fixture" });
  // Stop at the provider boundary: these tests exercise real request validation without a model or database write.
  mocks.request.mockRejectedValue(new Error("STOP_AT_REQUEST"));
  mocks.assets.mockRejectedValue(new Error("STOP_AT_ASSETS"));
});

describe("original episode continuation constraints", () => {
  it("validates the project duration target and frozen continuity for new continuations", async () => {
    const request = await inspectRequest();
    const episode = makePackage().firstEpisode;
    expect(request.validate({ episode })).toEqual([]);
    expect(request.validate({ episode: { ...episode, scenes: episode.scenes.slice(0, 3) } })).toContainEqual(expect.objectContaining({ code: "episode_duration_out_of_range", path: "episode.scenes" }));
    expect(request.validate({ episode: { ...episode, targetDurationSeconds: 120 } })).toContainEqual(expect.objectContaining({ code: "episode_duration_target_mismatch", path: "episode.targetDurationSeconds" }));
    episode.scenes[0].productionDesign!.startState.hands = "双手已空";
    expect(request.validate({ episode })).toContainEqual(expect.objectContaining({ code: "scene_start_state_changed", path: "episode.scenes.0.productionDesign.startState.hands" }));
  });

  it("retains exact adopted scene limits and gives the frozen duration priority over project settings", async () => {
    const story = makePackage();
    story.productionConstraints = { sceneCount: 2, characterCount: 1, locationCount: 1, targetDurationSeconds: 30 };
    setStory(story);
    const request = await inspectRequest();
    const episode = { ...story.firstEpisode, targetDurationSeconds: 30, scenes: story.firstEpisode.scenes.slice(0, 2) };
    expect(request.validate({ episode })).toEqual([]);
    expect(request.validate({ episode: { ...episode, scenes: episode.scenes.slice(0, 1) } })).toContainEqual(expect.objectContaining({ code: "story_constraint_mismatch", path: "episode.scenes" }));
    expect(request.prompt.text).toMatch(/"targetSeconds"\s*:\s*30/);
  });

  it("applies explicit continuation instructions over adopted scene and duration constraints", async () => {
    const story = makePackage();
    story.productionConstraints = { sceneCount: 2, targetDurationSeconds: 30 };
    setStory(story);
    const request = await inspectRequest("本集恰好三场，时长45秒。");
    const episode = { ...story.firstEpisode, targetDurationSeconds: 45, scenes: story.firstEpisode.scenes.slice(0, 3) };
    expect(request.validate({ episode })).toEqual([]);
    expect(request.prompt.text).toMatch(/"targetSeconds"\s*:\s*45/);
    expect(story.productionConstraints).toEqual({ sceneCount: 2, targetDurationSeconds: 30 });
  });

  it("counts episode appearances independently of the five-character, two-location registry", async () => {
    const story = makePackage();
    story.characters = ["阿青", "乙", "丙", "丁", "戊"].map(name => ({ ...story.characters[0], name }));
    story.locations = ["修理铺", "后院"].map(name => ({ ...story.locations[0], name }));
    story.productionConstraints = { characterCount: 5, locationCount: 2, sceneCount: 2, targetDurationSeconds: 30 };
    setStory(story);
    const request = await inspectRequest("本集仅2个人物，仅1个地点；所有道具作为普通场景道具。");
    const episode = { ...story.firstEpisode, targetDurationSeconds: 30, scenes: story.firstEpisode.scenes.slice(0, 2) };
    for (const scene of episode.scenes) {
      scene.characters = ["阿青", "乙"];
      scene.props = [];
      scene.productionDesign!.acting = scene.characters.map(name => ({ ...scene.productionDesign!.acting[0], name }));
      scene.imageReferenceSlots = [{ number: 1, kind: "character", name: "阿青" }, { number: 2, kind: "character", name: "乙" }, { number: 3, kind: "location", name: "修理铺" }];
    }
    expect(request.validate({ episode })).toEqual([]);
    const extraCharacter = structuredClone(episode);
    extraCharacter.scenes[1].characters.push("丙");
    expect(request.validate({ episode: extraCharacter })).toContainEqual(expect.objectContaining({ code: "story_constraint_mismatch", message: expect.stringContaining("characterCount: expected 2, received 3") }));
    const extraLocation = structuredClone(episode);
    extraLocation.scenes[1].location = "后院";
    expect(request.validate({ episode: extraLocation })).toContainEqual(expect.objectContaining({ code: "story_constraint_mismatch", message: expect.stringContaining("locationCount: expected 1, received 2") }));
    const independentProp = structuredClone(episode);
    independentProp.scenes[0].props.push("旧零件");
    expect(request.validate({ episode: independentProp })).toContainEqual(expect.objectContaining({ code: "story_prop_scope_mismatch" }));
    expect(story.props).toHaveLength(1);
    expect(story.characters).toHaveLength(5);
  });

  it("falls back to the adopted series duration when project settings are absent", async () => {
    mocks.episode.mockResolvedValue({ id: input.episodeId, episodeNumber: 2, project: { config: null } });
    const request = await inspectRequest();
    expect(request.validate({ episode: { ...makePackage().firstEpisode, targetDurationSeconds: 120 } })).toContainEqual(expect.objectContaining({ code: "episode_duration_target_mismatch" }));
    expect(request.prompt.text).toMatch(/"targetSeconds"\s*:\s*95/);
  });

  it.each(["duration", "legacy"] as const)("does not reuse a cached %s episode that fails current generation requirements", async (kind) => {
    const episode = makePackage().firstEpisode;
    if (kind === "duration") episode.targetDurationSeconds = 120;
    else for (const scene of episode.scenes) delete scene.continuity;
    await inspectRequest(undefined, { episode });
  });

  it("reuses a valid continuation and preserves legacy data for saved-source readers", async () => {
    const episode = makePackage().firstEpisode;
    await expect(generateOriginalEpisode(input, hooks({ episode }))).rejects.toThrow("STOP_AT_ASSETS");
    expect(mocks.request).not.toHaveBeenCalled();
    for (const scene of episode.scenes) { delete scene.continuity; delete scene.productionDesign; }
    const normalized = normalizeOriginalEpisodeOutput({ episode }, makePackage(), "zh") as EpisodeOutput;
    expect(StoryPackageFirstEpisodeSchema.shape.firstEpisode.safeParse(normalized.episode).success).toBe(true);
    expect(normalized.episode.scenes[0].continuity).toBeUndefined();
    expect(normalized.episode.scenes[0].productionDesign).toBeUndefined();
  });
});
