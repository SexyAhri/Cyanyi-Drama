import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  channelFindFirst: vi.fn(),
  enqueueTask: vi.fn(),
  projectConfigFindUnique: vi.fn(),
  providerModelCount: vi.fn(),
  providerModelFindFirst: vi.fn(),
  mediaTaskCount: vi.fn(),
  storyboardPanelUpdate: vi.fn(),
  storyboardPanelFindFirst: vi.fn(),
  storyboardVideoSegmentDeleteMany: vi.fn(),
  storyboardVideoSegmentUpsert: vi.fn(),
  taskCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    channel: { findFirst: mocks.channelFindFirst },
    projectConfig: { findUnique: mocks.projectConfigFindUnique },
    providerModel: {
      count: mocks.providerModelCount,
      findFirst: mocks.providerModelFindFirst,
    },
    mediaTask: { count: mocks.mediaTaskCount },
    storyboardPanel: {
      findFirst: mocks.storyboardPanelFindFirst,
      update: mocks.storyboardPanelUpdate,
    },
    storyboardVideoSegment: {
      deleteMany: mocks.storyboardVideoSegmentDeleteMany,
      upsert: mocks.storyboardVideoSegmentUpsert,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/media/task-store", () => ({
  createDatabaseMediaTaskStore: () => ({ create: mocks.taskCreate }),
}));

vi.mock("@/lib/media/task-submit", () => ({
  enqueuePersistedMediaTask: mocks.enqueueTask,
}));

vi.mock("@/lib/assets/story-world", () => ({
  loadProjectAssetStoryWorldContext: vi.fn().mockResolvedValue({
    lock: { setting: "premodern", evidence: ["王朝"] },
    groundingText: "王朝古镇",
  }),
  getStoryWorldDirective: vi.fn(() => "故事时代硬约束：前现代世界"),
}));

import {
  createStoryboardPanelImageTask,
  createStoryboardPanelVideoTask,
  previewStoryboardPanelPrompt,
} from "./project-asset-tasks";

describe("storyboard prompt preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.channelFindFirst.mockResolvedValue({
      id: "channel-1",
      protocol: "openai-compatible",
      providerKey: "openai",
    });
    mocks.providerModelFindFirst.mockResolvedValue({ capabilitiesJson: "{}" });
    mocks.providerModelCount.mockResolvedValue(1);
    mocks.mediaTaskCount.mockResolvedValue(0);
    mocks.storyboardPanelUpdate.mockResolvedValue({});
    mocks.storyboardVideoSegmentDeleteMany.mockResolvedValue({ count: 0 });
    mocks.storyboardVideoSegmentUpsert.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (operations) =>
      Promise.all(operations),
    );
    mocks.enqueueTask.mockImplementation(async (_userId, task) => ({
      ...task,
      status: "queued",
    }));
    mocks.projectConfigFindUnique.mockResolvedValue({ artStyle: "chinese-ink" });
    mocks.storyboardPanelFindFirst.mockResolvedValue(panel());
  });

  it("shows project style and provider safety rewrites before image submission", async () => {
    const preview = await previewStoryboardPanelPrompt({
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      panelId: "panel-1",
      kind: "image",
    });

    expect(preview.compiledPrompt).toContain(
      "项目统一画风（最高优先级）：中国水墨动画风格",
    );
    expect(preview.compiledPrompt).toContain("故事时代硬约束：前现代世界");
    expect(preview.compiledPrompt).toContain("镜头起始画面");
    expect(preview.compiledPrompt).toContain("林玄站立");
    expect(preview.compiledPrompt).not.toContain("林玄后退后站稳");
    expect(preview.compiledPrompt).not.toContain("后退一步");
    expect(preview.compiledPrompt).toContain("嘴角溢出鲜血");
    expect(preview.finalPrompt).toContain("嘴角留有少量红色水迹");
    expect(preview.safetyRewrites).toEqual([
      expect.objectContaining({ category: "visible_blood" }),
    ]);
  });

  it("keeps negative modern terms as model guidance without blocking generation", async () => {
    mocks.storyboardPanelFindFirst.mockResolvedValue({
      ...panel(),
      imagePrompt: "排除西装、汽车和现代房间，保持古代服饰与建筑。",
    });
    const preview = await previewStoryboardPanelPrompt({
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      panelId: "panel-1",
      kind: "image",
    });

    expect(preview.compiledPrompt).toContain("故事时代硬约束");
    expect(preview.issues).not.toContainEqual(
      expect.objectContaining({ code: "story_world_conflict" }),
    );
  });

  it("previews the exact video prompt and only blocks a missing reference frame", async () => {
    const preview = await previewStoryboardPanelPrompt({
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      panelId: "panel-1",
      kind: "video",
      mode: "reference",
      duration: "10s",
      ratio: "16:9",
      resolution: "1080p",
    });

    expect(preview.issues.map((issue) => issue.code)).toEqual([
      "missing_reference_frame",
    ]);
    expect(preview.submissionMode).toBe("verbatim");
    expect(preview.basePrompt).toBe("林玄后退一步");
    expect(preview.compiledPrompt).toBe(preview.basePrompt);
    expect(preview.finalPrompt).toBe(preview.basePrompt);
    expect(preview.safetyRewrites).toEqual([]);
    expect(preview.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "submission_mode",
          value: "场次完整视频提示词原样提交",
        }),
        expect.objectContaining({
          key: "audio_mode",
          value: "关闭（audioMode=none，声音由后期独立合成）",
        }),
      ]),
    );
    expect(preview.sources).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "dialogue_timing" }),
        expect.objectContaining({ key: "visual_profiles" }),
      ]),
    );
  });

  it("does not rewrite the designed video prompt during preview", async () => {
    mocks.storyboardPanelFindFirst.mockResolvedValue({
      ...panel(),
      description: "窗外左侧自然光照亮木桌",
      videoPrompt: "weather=晴；keyLightSource=窗外日光；人物转身",
      startStateJson: JSON.stringify({
        body: "人物站在桌边",
        environmentState: {
          weather: "晴",
          keyLightSource: "窗外日光",
          lightDirection: "画左至画右",
        },
      }),
      imageAsset: { url: "data:image/png;base64,AQID", storageKey: null },
    });

    const preview = await previewStoryboardPanelPrompt({
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      panelId: "panel-1",
      kind: "video",
      mode: "reference",
    });

    expect(preview.basePrompt).toBe(
      "weather=晴；keyLightSource=窗外日光；人物转身",
    );
    expect(preview.compiledPrompt).toBe(preview.basePrompt);
    expect(preview.finalPrompt).toBe(preview.basePrompt);
    expect(preview.referenceCount).toBe(1);
    expect(preview.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "frame_mode",
          value: "1 张分镜首帧（角色 / 场景 / 道具设定已用于生成该首帧）",
        }),
      ]),
    );
  });

  it("submits the designed video prompt unchanged with silent model audio", async () => {
    const exactPrompt =
      "深冬夜晚，韩宇从参考图姿态起身，镜头缓慢横移；不生成可辨识人声。";
    mocks.storyboardPanelFindFirst.mockResolvedValue({
      ...panel(),
      videoPrompt: exactPrompt,
      imageAsset: {
        url: "data:image/png;base64,AQID",
        storageKey: null,
        mimeType: "image/png",
      },
      storyboard: {
        status: "ready",
        episode: panel().storyboard.episode,
      },
    });

    await createStoryboardPanelVideoTask({
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      panelId: "panel-1",
      channelId: "channel-1",
      model: "video-model",
      mode: "reference",
      ratio: "9:16",
      resolution: "1080p",
      duration: "10s",
    });

    const task = mocks.taskCreate.mock.calls[0][0];
    expect(task.request).toMatchObject({
      prompt: exactPrompt,
      audioMode: "none",
      duration: "10s",
      ratio: "9:16",
      resolution: "1080p",
      videoMode: "reference",
    });
    expect(task.request.referenceImages).toEqual([
      expect.objectContaining({ role: "first_frame" }),
    ]);
  });

  it("generates storyboard first frames in the configured video ratio", async () => {
    mocks.storyboardPanelFindFirst.mockResolvedValue({
      ...panel(),
      storyboard: {
        status: "ready",
        episode: panel().storyboard.episode,
      },
    });

    await createStoryboardPanelImageTask({
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      panelId: "panel-1",
      channelId: "channel-1",
      model: "image-model",
      mediaDefaults: {
        imageGenerationRatio: "1:1",
        imageGenerationResolution: "1k",
        imageGenerationCount: 1,
        imageGenerationQuality: "high",
        videoGenerationRatio: "16:9",
        videoGenerationResolution: "1080p",
        videoGenerationDuration: "10s",
      },
    });

    expect(mocks.taskCreate.mock.calls[0][0].request.ratio).toBe("16:9");
  });

  it("creates one persisted task per local video segment", async () => {
    mocks.providerModelFindFirst.mockResolvedValue({
      capabilitiesJson: JSON.stringify({ maxDurationSeconds: 15 }),
    });
    mocks.storyboardPanelFindFirst.mockResolvedValue({
      ...panel(),
      description: "韩宇看向铁盒。韩子枫打开盒盖。古籍泛起微光。",
      durationSeconds: 18,
      videoPrompt:
        "场景：简陋屋舍\n可见画面与动作：完整动作\n仅生成静音视频。",
      imageAsset: {
        url: "data:image/png;base64,AQID",
        storageKey: null,
        mimeType: "image/png",
      },
    });

    const result = await createStoryboardPanelVideoTask({
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      panelId: "panel-1",
      channelId: "channel-1",
      model: "video-model",
      mode: "reference",
    });

    expect(result.tasks).toHaveLength(2);
    expect(
      mocks.taskCreate.mock.calls.map(([task]) => task.request.duration),
    ).toEqual(["9s", "9s"]);
    expect(mocks.taskCreate.mock.calls[0][0].request.prompt).toContain(
      "本场次第 1/2 段",
    );
    expect(mocks.taskCreate.mock.calls[1][0].request.prompt).toContain(
      "本场次第 2/2 段",
    );
    expect(mocks.storyboardVideoSegmentUpsert).toHaveBeenCalledTimes(2);
  });
});

function panel() {
  return {
    id: "panel-1",
    storyboardId: "storyboard-1",
    panelIndex: 0,
    linkedToNextPanel: false,
    description: "林玄受创",
    durationSeconds: 4,
    imagePrompt: "林玄嘴角溢出鲜血",
    videoPrompt: "林玄后退一步",
    firstLastFramePrompt: null,
    actingNotesJson: JSON.stringify({
      characters: [
        {
          name: "林玄",
          emotion: "受创后警觉",
          action: "后退并稳住重心",
          expression: "压住痛感",
          beats: [
            {
              startSecond: 0,
              endSecond: 4,
              objective: "稳住呼吸再判断来袭方向",
              subtext: "不能露出破绽",
              action: "后退一步",
              expression: "目光收紧",
              gazeTarget: "来袭方向",
              reactionTo: "B1",
            },
          ],
        },
      ],
    }),
    photographyRules: JSON.stringify({
      composition: "保持林玄与来袭方向同框",
      cameraPosition: "侧前方",
    }),
    startStateJson: JSON.stringify({ body: "林玄站立" }),
    endStateJson: JSON.stringify({ body: "林玄后退后站稳" }),
    motionBeatsJson: JSON.stringify([
      { startSecond: 0, endSecond: 4, action: "林玄后退一步" },
    ]),
    worldContextJson: JSON.stringify({ technique: "护体诀" }),
    vfxCuesJson: JSON.stringify([]),
    sfxCuesJson: JSON.stringify([]),
    sourceEvidenceJson: JSON.stringify(["林玄受创后退。"]),
    charactersJson: "[]",
    propsJson: "[]",
    locationName: null,
    imageAsset: null,
    storyboard: {
      status: "ready",
      episode: {
        description: "雨夜中的短暂交锋",
        novelText: "入夜后，林玄在雨中迎敌。",
      },
    },
  };
}
