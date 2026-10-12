import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

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
import type { StoryPackage } from "./story-package-contract";

const imagePrompt = "国漫风格，中景，一名身穿蓝色长袍的修理师站在废器炉旁，背景为整齐的工具架，柔和侧光照亮衣料和金属纹理，构图清晰。";
const videoPrompt = `15 秒，国漫风格，9:16，图片 1（角色参考：阿青）。0-3 秒：阿青从炉旁站起，镜头缓慢前推。3-6 秒：伸手检查零件，炉火映亮手部。6-9 秒：转身走向工具架，镜头平移。9-12 秒：取下工具，低头检查接口，动作保持连贯。12-15 秒：回到炉前放下工具，火光照亮面部，保持最终姿态。`;

function makePackage(): StoryPackage {
  const visualProfile = {
    visualIdentity: "旧器物修理铺的基础参考", shapeAndStructure: "清晰结构", surfaceAndStyling: "旧布与铜质",
    colorPalette: "低饱和蓝灰", lightingAndPresentation: "柔和侧光", signatureDetails: ["铜纹"],
    consistencyRules: ["保持纹路"], negativePrompt: "无现代电器", inferenceNotes: ["材质为美术推定"],
  };
  return {
    resolvedSetup: { audience: ["悬疑爱好者"], characters: ["青年修理师"], eras: ["架空前工业小城"], hooks: ["旧物线索" ] },
    title: "废器炉",
    logline: "修理师追查一件旧器物的来历。",
    coreAppeal: ["修复器物", "揭开旧案"],
    emotionalCurve: "好奇到危机，再到解决。",
    synopsis: "阿青发现旧器物的秘密，逐步查明真相。",
    backgroundSetting: "以修复旧器物为生的小城。",
    format: { episodeCount: 20, episodeDurationSeconds: 95, structure: "三幕式", aspectRatio: "9:16", artStyle: "anime" },
    worldRules: Array.from({ length: 3 }, (_, i) => ({ rule: `规则 ${i + 1}`, consequence: `后果 ${i + 1}` })),
    volumes: [1, 2].map((volume) => ({
      volume, title: `阶段 ${volume}`, episodeRange: volume === 1 ? "1-10" : "11-20",
      phaseGoal: "从发现线索到确认事实", informationRelease: "揭开器物来源", distinctiveness: "推进新的调查目标",
      synopsis: "根据前阶段的证据推进调查。", climax: "面对真相", endingHook: "还有谁知道这个秘密？",
    })),
    episodeOutlines: Array.from({ length: 20 }, (_, i) => ({
      episodeNumber: i + 1, title: `集纲 ${i + 1}`, summary: `独有集纲事件 ${i + 1}`,
      endingHook: "出现新线索", plantedClue: "零件上的纹路", payoff: "确认器物的来源",
    })),
    hooks: Array.from({ length: 20 }, (_, i) => ({ episodeNumber: i + 1, hook: "出现新线索", questionRaised: "纹路从何而来？", promisedPayoff: "确认器物来源" })),
    foreshadowing: [{ clue: "特殊纹路", introducedAt: "第 1 集", introducedForm: "零件特写", payoffAt: "第 20 集", payoff: "查明制造者" }],
    reversals: [{ reveal: "器物来自旧工坊", setup: "零件上的标记", episodeNumber: 20 }],
    creativeProhibitions: ["不凭空解决问题", "不随意增加能力", "不改变器物来源"],
    whyWatch: { earlyEpisodes: [{ episodeNumber: 1, moment: "零件点亮炉火", questionRaised: "谁留下零件？" }], nonInterchangeabilityReason: "每集依据前集线索推进。" },
    characters: [{
      name: "阿青", role: "主角", storyFunction: "调查旧器物", tags: ["修理师"], ageAndAppearance: "青年，蓝衣",
      personality: "谨慎", motivation: "查明真相", arc: "从回避到面对", relationships: "独自经营修理铺",
      voiceStyle: "简短", speakingTell: "犹豫时停顿", signatureDetail: "蓝色围巾", pressureBehavior: "仔细观察",
      addressingRules: "直接称名", firstAppearanceEpisode: 1, keyEpisodes: [1, 20], imageReferenceSlot: 1, imagePrompt, visualProfile,
    }],
    props: [{ name: "旧零件", type: "机械零件", storyFunction: "提供调查线索", appearance: "带纹路的铜片", capabilities: "接通炉火", limits: "只能接通一次", costOrConsequence: "接通后损坏", firstAppearanceEpisode: 1, keyEpisodes: [1, 20], imageReferenceSlot: 2, imagePrompt, visualProfile }],
    locations: [{ name: "修理铺", type: "室内", storyFunction: "调查起点", spatialRules: "工具架与炉子之间有窄道", atmosphere: "昏暗温暖", reusableActions: "从炉子走向工具架", keyEpisodes: [1, 20], imageReferenceSlot: 3, imagePrompt, visualProfile }],
    firstEpisode: {
      title: "炉火", synopsis: "阿青检查旧零件。", endingHook: "谁留下零件？", targetDurationSeconds: 95,
      scenes: Array.from({ length: 6 }, (_, i) => ({
        sceneNumber: i + 1, heading: `修理铺场次 ${i + 1}`, durationSeconds: 15, location: "修理铺",
        characters: ["阿青"], props: ["旧零件"], action: "阿青检查零件。", dialogue: [{ speaker: "阿青", line: "这是什么？" }],
        camera: "缓慢前推", sound: "炉火声", endState: "零件放在炉边",
        imageReferenceSlots: [{ number: 1, kind: "character", name: "阿青" }, { number: 2, kind: "prop", name: "旧零件" }, { number: 3, kind: "location", name: "修理铺" }], imagePrompt,
        videoPrompt: `图片 2（道具：旧零件），图片 3（场景：修理铺）。${videoPrompt}`,
        productionDesign: {
          photography: { camera: "前推", cameraPosition: "炉前", focalLength: "50mm", lighting: "炉火", composition: "居中", depthOfField: "浅景深", colorTone: "暖色" },
          acting: [{ name: "阿青", emotion: "好奇", action: "检查零件", expression: "凝视" }],
          startState: { body: "站立", hands: "握零件", gaze: "向下", screenDirection: "朝右", props: "铜片在手" },
          motionBeats: [{ startSecond: 0, endSecond: 15, action: "检查并放下零件", camera: "缓慢前推" }],
          worldContext: { realm: "不适用", technique: "不适用", powerRule: "接通一次", environmentScale: "小铺", evidence: ["零件只能接通一次"] },
          vfxCues: [], sfxCues: [],
        },
      })),
    },
  };
}

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
    const { characters, props, locations, firstEpisode, episodeOutlines, hooks, foreshadowing, reversals, ...plan } = storyPackage;
    const responses = [
      plan,
      { episodeOutlines: episodeOutlines.slice(0, 10), hooks: hooks.slice(0, 10), foreshadowing, reversals },
      { episodeOutlines: episodeOutlines.slice(10), hooks: hooks.slice(10), foreshadowing, reversals },
      { characters, props, locations },
      { firstEpisode },
    ];
    mocks.request.mockImplementation(async ({ schema, validate }: { schema: z.ZodType; validate?: (value: never) => unknown[] }) => {
      const data = schema.parse(responses.shift());
      expect(validate?.(data as never) ?? []).toEqual([]);
      return { data, trace: { promptId: "story_package_generation", correctionAttempts: 0, tokenUsage: null, outputHash: "mock-hash" } };
    });
    const progress: StoryPackageGenerationProgress[] = [];

    const result = await generateAndSaveStoryPackage({ ...input, onProgress: (event) => progress.push(event) });

    expect(mocks.request).toHaveBeenCalledTimes(5);
    const prompts = mocks.request.mock.calls.map(([call]) => call.prompt.text as string);
    expect(prompts[1]).toContain('"priorEpisodeOutlines": []');
    expect(prompts[2]).toContain("独有集纲事件 10");
    expect(prompts[2]).not.toContain("独有集纲事件 20");
    expect(prompts[3]).toContain("独有集纲事件 20");
    expect(prompts[4]).toContain('"name": "阿青"');
    const preview = progress.map((event) => event.delta ?? "").join("");
    expect(preview.indexOf("# 故事大纲")).toBeLessThan(preview.indexOf("## 第 1-10 集大纲"));
    expect(preview.indexOf("## 第 11-20 集大纲")).toBeLessThan(preview.indexOf("## 角色与美术资产"));
    expect(preview).toContain("第一集完整正文");
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
});
