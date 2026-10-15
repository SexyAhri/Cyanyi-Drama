import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { WorkflowRequestUpdate } from "@/lib/workflow/request-events";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  project: vi.fn(),
  provider: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/lib/llm/openai-structured", () => ({
  requestOpenAiStructured: mocks.request,
}));
vi.mock("@/lib/server/prisma", () => ({
  prisma: { project: { findFirst: mocks.project } },
}));
vi.mock("@/lib/episodes/provider", () => ({
  resolveEpisodeTextProvider: mocks.provider,
}));
vi.mock("./deliverables", () => ({ createProductionDeliverable: mocks.save }));

import { generateAndSaveStoryPackage, validateFirstEpisode, type StoryPackageGenerationProgress } from "./story-package-generation";

import { makePackage, phaseResponses } from "./story-package-test-fixture";

const input = {
  userId: "user-1", projectId: "project-1", channelId: "channel-1", model: "mock-model", locale: "zh" as const,
  setup: { storyIdea: "修理师追查旧器物", genres: [], audience: [], characters: [], eras: [], hooks: [], artStyle: "anime", episodeCount: 20, structure: "三幕式" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.project.mockResolvedValue({ id: "project-1", name: "测试项目", description: null, config: { episodeTargetDurationSeconds: 95 } });
  mocks.provider.mockResolvedValue({ baseUrl: "https://example.invalid", apiKeys: ["mock-key"], model: "mock-model" });
  mocks.save.mockResolvedValue({ id: "package-1", title: "废器炉 · 全剧策划包", version: 1, status: "draft" });
});


function mockPhases(responses: unknown[]) {
  mocks.request.mockImplementation(async ({ schema, validate, normalizeRaw }: { schema: z.ZodType; validate?: (value: never) => unknown[]; normalizeRaw?: (value: unknown) => unknown }) => {
    const raw = responses.shift();
    const data = schema.parse(normalizeRaw ? normalizeRaw(raw) : raw);
    expect(validate?.(data as never) ?? []).toEqual([]);
    return { data, trace: { promptId: "story_package_generation", correctionAttempts: 0, tokenUsage: null, outputHash: "mock-hash" } };
  });
}

describe("story package generation phases", () => {
  it("checks original-package scene duration against the configured episode target", () => {
    const episode = makePackage().firstEpisode;
    expect(validateFirstEpisode(episode, "zh", undefined, 95)).toEqual([]);
    const tooShort = { ...episode, scenes: episode.scenes.slice(0, 3) };
    expect(validateFirstEpisode(tooShort, "zh", undefined, 95).map(issue => issue.code)).toContain("episode_duration_out_of_range");
    expect(validateFirstEpisode({ ...episode, targetDurationSeconds: 120 }, "zh", undefined, 95).map(issue => issue.code)).toContain("episode_duration_target_mismatch");
  });
  it("generates all outlines before assets, streams readable previews, and saves the complete package", async () => {
    const storyPackage = makePackage();
    mockPhases(phaseResponses(storyPackage));
    const progress: StoryPackageGenerationProgress[] = [];

    const result = await generateAndSaveStoryPackage({ ...input, onProgress: (event) => progress.push(event) });

    expect(mocks.request).toHaveBeenCalledTimes(16);
    const prompts = mocks.request.mock.calls.map(([call]) => call.prompt.text as string);
    expect(prompts[1]).toContain('"priorEpisodeOutlines": []');
    expect(prompts[2]).toContain("独有集纲事件 5");
    expect(prompts[2]).not.toContain("独有集纲事件 20");
    expect(prompts[5]).toContain("独有集纲事件 20");
    expect(prompts[6]).toContain('"name": "阿青"');
    const preview = progress.map((event) => event.delta ?? "").join("");
    expect(preview.indexOf("# 故事大纲")).toBeLessThan(preview.indexOf("## 第 1-5 集大纲"));
    expect(preview.indexOf("## 第 16-20 集大纲")).toBeLessThan(preview.indexOf("## 资产档案"));
    expect(preview).toContain("第一集故事正文");
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][2].payload.storyPackage).toEqual(result.storyPackage);
    expect(result.storyPackage.episodeOutlines).toHaveLength(20);
  });

  it("retains the received outline preview and does not save an incomplete package when the next phase fails", async () => {
    const storyPackage = makePackage();
    mocks.request.mockResolvedValueOnce({ data: storyPackage, trace: { correctionAttempts: 0, tokenUsage: null, outputHash: "mock-hash" } });
    mocks.request.mockRejectedValueOnce(new Error("MODEL_CONNECTION_FAILED"));
    const progress: StoryPackageGenerationProgress[] = [];

    await expect(generateAndSaveStoryPackage({ ...input, onProgress: (event) => progress.push(event) })).rejects.toThrow("MODEL_CONNECTION_FAILED");

    expect(progress.map((event) => event.delta ?? "").join("")).toContain("# 故事大纲");
    expect(progress.at(-1)?.status).toContain("已收到的内容保留");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("retains validated phases across a socket failure and resumes without repeating them", async () => {
    const responses = phaseResponses(makePackage());
    mockPhases(responses);
    const implementation = mocks.request.getMockImplementation()!;
    let attempt = 0;
    mocks.request.mockImplementation(async (...args) => {
      if (++attempt === 4) throw new Error("STRUCTURED_PROVIDER_TRANSPORT_FAILED:stage=response_body;reason=terminated;causeCode=UND_ERR_SOCKET");
      return implementation(...args);
    });
    const artifacts = new Map<string, unknown>();
    const hooks = {
      assertActive: vi.fn(async () => {}), reusePreviousResults: true,
      loadArtifact: vi.fn(async (type: string, key: string) => artifacts.get(`${type}:${key}`) ?? null),
      persistArtifact: vi.fn(async (type: string, key: string, value: unknown) => { artifacts.set(`${type}:${key}`, value); }),
      recordRequest: vi.fn(async (_event: WorkflowRequestUpdate) => { void _event; }),
    };
    await expect(generateAndSaveStoryPackage({ ...input, workflowId: "run", hooks })).rejects.toThrow("已完成阶段已保留");
    expect(mocks.save).not.toHaveBeenCalled();
    expect(artifacts.size).toBe(6);
    const result = await generateAndSaveStoryPackage({ ...input, workflowId: "run", hooks });
    expect(result.storyPackage.episodeOutlines).toHaveLength(20);
    expect(mocks.request).toHaveBeenCalledTimes(17); // 16 successes + exactly one failed request
    expect(hooks.recordRequest.mock.calls.filter(([event]) => (event as { reused?: boolean }).reused)).toHaveLength(3);
    expect(mocks.save.mock.calls[0][2].idempotencyKey).toBe("story-package:run");
  });

  it("plans 100 episodes in bounded batches and does not force a serial finale", async () => {
    const story = makePackage();
    story.format.episodeCount = 100;
    story.episodeOutlines = Array.from({ length: 100 }, (_, i) => ({ ...story.episodeOutlines[0], episodeNumber: i + 1 }));
    story.hooks = Array.from({ length: 100 }, (_, i) => ({ ...story.hooks[0], episodeNumber: i + 1 }));
    story.volumes = Array.from({ length: 10 }, (_, i) => ({ ...story.volumes[0], volume: i + 1, episodeRange: `${i * 10 + 1}-${i * 10 + 10}` }));
    mockPhases(phaseResponses(story));
    const result = await generateAndSaveStoryPackage({ ...input, setup: { ...input.setup, episodeCount: 100, storyIdea: "长篇治愈种田连载" } });
    expect(result.storyPackage.episodeOutlines).toHaveLength(100);
    expect(mocks.request).toHaveBeenCalledTimes(32);
    const outlinePrompts = mocks.request.mock.calls.slice(1, 21).map(([call]) => call.prompt.text as string);
    expect(outlinePrompts[19]).toContain("第 96-100 集");
    expect(outlinePrompts[19]).toContain("不强行全剧完结");
    expect(outlinePrompts.every(text => text.includes("恰好生成 5 集"))).toBe(true);
  });

  it("reuses every phase after final-save failure, but invalidates changed input and explicit restarts", async () => {
    const artifacts = new Map<string, unknown>();
    const hooks = {
      assertActive: async () => {}, reusePreviousResults: true,
      loadArtifact: async (type: string, key: string) => artifacts.get(`${type}:${key}`) ?? null,
      persistArtifact: async (type: string, key: string, value: unknown) => { artifacts.set(`${type}:${key}`, value); },
    };
    mockPhases(phaseResponses(makePackage()));
    mocks.save.mockRejectedValueOnce(new Error("SAVE_TEMPORARILY_UNAVAILABLE"));
    await expect(generateAndSaveStoryPackage({ ...input, workflowId: "run", hooks })).rejects.toThrow("SAVE_TEMPORARILY_UNAVAILABLE");
    await generateAndSaveStoryPackage({ ...input, workflowId: "run", hooks });
    expect(mocks.request).toHaveBeenCalledTimes(16);
    mockPhases(phaseResponses(makePackage()));
    await generateAndSaveStoryPackage({ ...input, workflowId: "run", hooks, setup: { ...input.setup, storyIdea: "修改后的新创意" } });
    expect(mocks.request).toHaveBeenCalledTimes(32);
    mockPhases(phaseResponses(makePackage()));
    await generateAndSaveStoryPackage({ ...input, workflowId: "run", hooks: { ...hooks, reusePreviousResults: false } });
    expect(mocks.request).toHaveBeenCalledTimes(48);
  });

  it("keeps the frozen project config and dramatic dialogue while designing individual scenes", async () => {
    const frozen = { id: "project-1", name: "冻结的项目名", description: null, config: {
      episodeTargetDurationSeconds: 95, artStyle: "anime", videoRatio: "9:16", videoResolution: "720p",
      visualEra: "source", visualEraCustom: "", workflowMode: "novel-promotion",
    } };
    mocks.project.mockResolvedValue({ ...frozen, name: "编辑后的项目名", config: { ...frozen.config, episodeTargetDurationSeconds: 180 } });
    mockPhases(phaseResponses(makePackage()));
    const result = await generateAndSaveStoryPackage({ ...input, projectSnapshot: frozen });
    expect(result.storyPackage.firstEpisode.scenes.map(scene => scene.dialogue)).toEqual(makePackage().firstEpisode.scenes.map(scene => scene.dialogue));
    expect(mocks.request.mock.calls[0][0].prompt.text).toContain("冻结的项目名");
    expect(mocks.request.mock.calls[0][0].prompt.text).not.toContain("编辑后的项目名");
    const design = mocks.request.mock.calls[10][0].prompt.text;
    expect(design).toContain("只输出 imagePrompt、videoPrompt、productionDesign 三项");
    expect(design).toContain("imageReferenceSlots 已由服务端从冻结正文生成");
    expect(design).not.toContain("至少 4 场可拍正文");
  });

  it("bounds each asset request to two exact registered entities", async () => {
    const story = makePackage();
    story.characters = [story.characters[0], ...["大伯", "老猎户", "苏晚秋"].map(name => ({ ...story.characters[0], name }))];
    mockPhases(phaseResponses(story));
    const result = await generateAndSaveStoryPackage(input);
    expect(result.storyPackage.characters.map(character => character.name)).toEqual(["阿青", "大伯", "老猎户", "苏晚秋"]);
    expect(mocks.request).toHaveBeenCalledTimes(17);
    const firstDossier = mocks.request.mock.calls[6][0].schema.safeParse({ characters: story.characters });
    expect(firstDossier.success).toBe(false);
    const validation = mocks.request.mock.calls[7][0].validate({ characters: story.characters.slice(0, 2) });
    expect(validation[0].code).toBe("asset_registry_mismatch");
  });
});
