import { beforeEach, describe, expect, it, vi } from "vitest";

const requestOpenAiText = vi.hoisted(() => vi.fn());
const requestOpenAiStructured = vi.hoisted(() => vi.fn());
const mediaFindMany = vi.hoisted(() => vi.fn());
const storyboardPanelFindFirst = vi.hoisted(() => vi.fn());
const storyboardPanelFindMany = vi.hoisted(() => vi.fn());
const projectFindFirst = vi.hoisted(() => vi.fn());
const channelFindFirst = vi.hoisted(() => vi.fn());
const providerModelFindFirst = vi.hoisted(() => vi.fn());
const characterFindMany = vi.hoisted(() => vi.fn());
const locationFindFirst = vi.hoisted(() => vi.fn());
const propFindMany = vi.hoisted(() => vi.fn());
const configurationFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/llm/openai-structured", () => ({ requestOpenAiText, requestOpenAiStructured }));
vi.mock("@/lib/server/crypto", () => ({
  decryptSecret: () => '["test-key"]',
}));
vi.mock("@/lib/settings/runtime-store", () => ({
  loadUserRuntimeSettings: vi.fn().mockResolvedValue({
    structuredRequestTimeoutSeconds: 600,
    structuredOutputStreaming: true,
    structuredTransportMaxAttempts: 3,
  }),
}));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    productionConfiguration: { findMany: configurationFindMany },
    mediaAsset: { findMany: mediaFindMany },
    storyboardPanel: {
      findFirst: storyboardPanelFindFirst,
      findMany: storyboardPanelFindMany,
    },
    project: { findFirst: projectFindFirst },
    channel: { findFirst: channelFindFirst },
    providerModel: { findFirst: providerModelFindFirst },
    novelCharacter: { findMany: characterFindMany },
    novelLocation: { findFirst: locationFindFirst },
    novelProp: { findMany: propFindMany },
  },
}));

import {
  designStoryboardMediaPrompt,
  parseStoryboardMediaPromptDesignText,
  captureStoryboardPromptContext,
} from "./storyboard-prompt-design";
import { withProductionConfiguration } from "@/lib/production-configuration/context";
import { mergeProductionConfigurations, type ProductionConfigurationSnapshot } from "@/lib/production-configuration/contract";

const profile = JSON.stringify({
  version: 1,
  source: "manual",
  updatedAt: "2026-08-30T00:00:00.000Z",
  spec: {
    visualIdentity: "少年武者，额前碎发",
    shapeAndStructure: "清瘦挺拔",
    surfaceAndStyling: "深灰短打",
    colorPalette: "深灰与冷青",
    lightingAndPresentation: "柔和侧光",
    signatureDetails: ["旧布护腕"],
    consistencyRules: ["保持脸型", "保持护腕"],
    negativePrompt: "禁止现代服装",
    inferenceNotes: [],
  },
});

const panel = {
  id: "panel-2",
  storyboardId: "storyboard-1",
  panelIndex: 1,
  sceneNumber: 0,
  shotType: "中景",
  cameraMove: "缓慢推近",
  description: "韩宇接住父亲递来的铁盒，抬眼看向父亲。",
  locationName: "简陋院落",
  charactersJson: '["韩宇","韩子枫"]',
  propsJson: '["铁盒"]',
  imagePrompt: "韩宇接住铁盒",
  videoPrompt: "父亲递盒，韩宇接住",
  firstLastFramePrompt: "从递盒到韩宇抬眼",
  durationSeconds: 6,
  subtitleText: "这是你母亲留下的。",
  speakingCharacter: "韩子枫",
  lipSyncText: "这是你母亲留下的。",
  voiceoverText: null,
  startStateJson: '{"ironBox":"韩子枫手中"}',
  endStateJson: '{"ironBox":"韩宇双手托住"}',
  motionBeatsJson:
    '[{"startSecond":0,"endSecond":3,"action":"韩子枫递出铁盒"},{"startSecond":3,"endSecond":6,"action":"韩宇接住并抬眼"}]',
  worldContextJson: '{"setting":"古代东方修炼世界"}',
  vfxCuesJson: '[{"time":4,"effect":"铁盒边缘冷光"}]',
  sfxCuesJson: '[{"time":3,"sound":"衣袖摩擦与铁盒轻响"}]',
  actingNotesJson:
    '{"韩宇":{"emotion":"惊疑","action":"双手接盒","expression":"眉心微收"}}',
  photographyRules: "保持父子视线轴线",
  sourceEvidenceJson: '["韩子枫将一枚精致铁盒交给韩宇。"]',
  imageAssetId: "image-2",
  linkedToNextPanel: true,
};

beforeEach(() => {
  vi.clearAllMocks();
    configurationFindMany.mockResolvedValue([]);
  storyboardPanelFindFirst.mockResolvedValue(panel);
  storyboardPanelFindMany.mockResolvedValue([
    {
      id: "panel-1",
      panelIndex: 0,
      shotType: "全景",
      cameraMove: "稳定",
      description: "父子坐在院中。",
      locationName: "简陋院落",
      charactersJson: '["韩宇","韩子枫"]',
      propsJson: '["铁盒"]',
      startStateJson: '{}',
      endStateJson: '{"ironBox":"韩子枫手中"}',
      imageAssetId: "image-1",
    },
    {
      id: "panel-3",
      panelIndex: 2,
      shotType: "特写",
      cameraMove: "稳定",
      description: "韩宇看清铁盒纹样。",
      locationName: "简陋院落",
      charactersJson: '["韩宇"]',
      propsJson: '["铁盒"]',
      startStateJson: '{"ironBox":"韩宇双手托住"}',
      endStateJson: '{"ironBox":"韩宇手中"}',
      imageAssetId: "image-3",
    },
  ]);
  projectFindFirst.mockResolvedValue({ config: { artStyle: "chinese-comic" } });
  channelFindFirst.mockResolvedValue({
    baseUrl: "https://provider.test/v1",
    protocol: "openai-compatible",
    encryptedApiKeys: "encrypted",
  });
  providerModelFindFirst.mockResolvedValue({
    capabilitiesJson: JSON.stringify({ supportsStructuredOutputs: true }),
  });
  mediaFindMany.mockImplementation(async ({ where }) => where.id.in.map((id: string) => ({ id, kind: "image", url: `data:image/png;base64,${id}`, storageKey: null })));
  characterFindMany.mockResolvedValue([
    { name: "韩宇", visualProfileJson: profile },
    { name: "韩子枫", visualProfileJson: profile },
  ]);
  locationFindFirst.mockResolvedValue({
    name: "简陋院落",
    visualProfileJson: profile,
  });
  propFindMany.mockResolvedValue([{ name: "铁盒", visualProfileJson: profile }]);
  const outputText = JSON.stringify({
      prompt: "中景静态关键帧，韩宇双手刚接住铁盒，抬眼看向父亲。",
      designNotes: ["锁定递接动作的接触瞬间"],
      continuitySafeguards: ["铁盒从父亲手中交到韩宇双手"],
  });
  requestOpenAiText.mockResolvedValue({
    text: outputText,
    outputText,
    trace: { promptId: "storyboard_media_prompt_design" },
  });
  const data = { ...JSON.parse(outputText), spatialAudit: {
    observations: ["父子之间铁盒可见，院落背景"], allowedMotion: ["沿递盒方向接住，缓慢推近"],
    forbiddenAdditions: ["不凭空增加人物"], conflicts: [], timeBudget: "6 秒内完成递接和抬眼",
  } };
  requestOpenAiStructured.mockImplementation(async ({ schema }) => ({ data: schema.parse(data), outputText: JSON.stringify(data), trace: { promptId: "storyboard_media_prompt_design" } }));
});

describe("storyboard media prompt design", () => {
  it("designs an image keyframe from adjacent shots and confirmed asset profiles", async () => {
    const result = await designStoryboardMediaPrompt({
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      panelId: "panel-2",
      channelId: "channel-1",
      model: "analysis-model",
      kind: "image",
      currentPrompt: "保留双手递接关系",
      locale: "zh",
    });

    const request = requestOpenAiText.mock.calls[0][0];
    expect(request.prompt.text).toContain("媒体类型：图片");
    expect(request.prompt.text).toContain("父子坐在院中");
    expect(request.prompt.text).toContain("韩宇看清铁盒纹样");
    expect(request.prompt.text).toContain("视觉身份：少年武者");
    expect(request.prompt.text).toContain("保留双手递接关系");
    expect(result.design.prompt).toContain("静态关键帧");
  });

  it("designs video with interaction, performance, effects, sound, and boundary states", async () => {
    await designStoryboardMediaPrompt({
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      panelId: "panel-2",
      channelId: "channel-1",
      model: "analysis-model",
      kind: "video",
      mode: "first-last",
      locale: "zh",
    });

    const request = requestOpenAiStructured.mock.calls[0][0];
    const text = request.prompt.text;
    expect(request.imageUrls).toEqual(["data:image/png;base64,image-2", "data:image/png;base64,image-3"]);
    expect(request.requireVisionModel).toBe(true);
    expect(mediaFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ task: { userId: "user-1", projectId: "project-1" }, kind: { in: ["image"] } }) }));
    expect(text).toContain("生成模式：首尾帧");
    expect(text).toContain("韩子枫递出铁盒");
    expect(text).toContain("双手接盒");
    expect(text).toContain("铁盒边缘冷光");
    expect(text).toContain("衣袖摩擦与铁盒轻响");
    expect(text).toContain('"ironBox": "韩宇双手托住"');
    expect(text).toContain("视频 prompt 必须逐字保留并生成本镜头已有的对白、旁白、画外音和心声");
    expect(text).toContain("明确只有该角色自然开口，其他人物倾听或回应");
    expect(text).toContain("动作须适合给定时长，避免逐秒命令");
    expect(text).toContain("audioMode 由提交层提供");
    expect(text).toContain("2–4 个主要、可观察信号");
  });

  const videoInput = { userId: "user-1", projectId: "project-1", episodeId: "episode-1", panelId: "panel-2", channelId: "channel-1", model: "analysis-model", kind: "video" as const };

  it("freezes ordered voice lines and rejects reversed or missing dialogue before saving a design", async () => {
    const voiceLines = [{ id: "line-1", lineIndex: 0, speaker: "韩宇", content: "这是母亲的？", delivery: "dialogue" }, { id: "line-2", lineIndex: 1, speaker: "韩子枫", content: "替她收好。", delivery: "dialogue" }];
    storyboardPanelFindFirst.mockResolvedValue({ ...panel, voiceLines });
    const capturedContext = await captureStoryboardPromptContext(videoInput);
    expect(capturedContext.panel.voiceLines).toEqual(voiceLines);
    expect(storyboardPanelFindFirst.mock.calls[0][0].select.voiceLines.orderBy).toEqual({ lineIndex: "asc" });
    storyboardPanelFindFirst.mockResolvedValue({ ...panel, voiceLines: voiceLines.slice().reverse() });
    const configuration: ProductionConfigurationSnapshot = { ...mergeProductionConfigurations([{ sound: { mode: "native", dialogue: true } }]), format: "production-configuration-v1", sources: [] };
    const run = () => withProductionConfiguration("user-1", configuration, () => designStoryboardMediaPrompt({ ...videoInput, capturedContext }));
    for (const prompt of ["韩子枫：替她收好。 韩宇：这是母亲的？", "韩宇：这是母亲的？"]) {
      requestOpenAiStructured.mockImplementationOnce(async ({ schema }) => ({ data: schema.parse({ prompt, designNotes: [], continuitySafeguards: [], spatialAudit: { observations: ["人物与铁盒可见"], allowedMotion: ["沿轴线递接"], forbiddenAdditions: [], conflicts: [], timeBudget: "6秒" } }), trace: {}, outputText: prompt }));
      await expect(run()).rejects.toThrow("顺序、内容或说话人不一致");
    }
    const prompt = "韩宇：这是母亲的？ 韩子枫：替她收好。";
    requestOpenAiStructured.mockImplementationOnce(async ({ schema }) => ({ data: schema.parse({ prompt, designNotes: [], continuitySafeguards: [], spatialAudit: { observations: ["人物与铁盒可见"], allowedMotion: ["沿轴线递接"], forbiddenAdditions: [], conflicts: [], timeBudget: "6秒" } }), trace: {}, outputText: prompt }));
    const result = await run();
    expect(result.design.prompt).toContain("这是母亲的？");
    expect(requestOpenAiStructured.mock.calls.at(-1)?.[0].prompt.text).toContain('"id": "line-1"');
  });

  it("uses frozen facts and adopted images after a shot is edited", async () => {
    const capturedContext = await captureStoryboardPromptContext(videoInput);
    storyboardPanelFindFirst.mockResolvedValue({ ...panel, description: "edited description", imageAssetId: "replacement" });
    const result = await designStoryboardMediaPrompt({ ...videoInput, capturedContext });
    const request = requestOpenAiStructured.mock.calls[0][0];
    expect(request.imageUrls).toEqual(["data:image/png;base64,image-2"]);
    expect(request.prompt.text).not.toContain("edited description");
    expect(result.design.spatialAudit?.referenceAssetIds).toEqual(["image-2"]);
    expect(result.design.prompt).toContain("这是你母亲留下的。");
  });

  it("rejects foreign/deleted images and revoked shot access before model requests", async () => {
    mediaFindMany.mockResolvedValue([]);
    await expect(designStoryboardMediaPrompt(videoInput)).rejects.toThrow("不属于当前项目");
    expect(requestOpenAiStructured).not.toHaveBeenCalled();
    const capturedContext = await captureStoryboardPromptContext(videoInput);
    storyboardPanelFindFirst.mockResolvedValue(null);
    await expect(designStoryboardMediaPrompt({ ...videoInput, capturedContext })).rejects.toThrow("分镜格不存在");
  });

  it("rejects missing tail frames instead of silently downgrading first-last mode", async () => {
    storyboardPanelFindMany.mockResolvedValue([]);
    await expect(designStoryboardMediaPrompt({ ...videoInput, mode: "first-last" })).rejects.toThrow("首尾帧设计需要");
    expect(requestOpenAiStructured).not.toHaveBeenCalled();
  });

  it("does not claim a visual audit when no keyframe is adopted", async () => {
    storyboardPanelFindFirst.mockResolvedValue({ ...panel, imageAssetId: null });
    const result = await designStoryboardMediaPrompt(videoInput);
    expect(requestOpenAiText).toHaveBeenCalledOnce();
    expect(requestOpenAiStructured).not.toHaveBeenCalled();
    expect(result.design.spatialAudit).toBeUndefined();
  });

  it("keeps a freeform model response as an editable prompt", () => {
    expect(
      parseStoryboardMediaPromptDesignText(
        "中景，韩宇双手接住铁盒，抬眼看向父亲。保持父子视线轴线。",
      ),
    ).toEqual({
      prompt: "中景，韩宇双手接住铁盒，抬眼看向父亲。保持父子视线轴线。",
      designNotes: [],
      continuitySafeguards: [],
    });
  });
});
