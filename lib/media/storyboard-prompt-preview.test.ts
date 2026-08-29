import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findStoryWorldTextConflicts: vi.fn(
    (text: string, context: unknown): string[] => {
      void text;
      void context;
      return [];
    },
  ),
  projectConfigFindUnique: vi.fn(),
  storyboardPanelFindFirst: vi.fn(),
  voiceLineFindMany: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    projectConfig: { findUnique: mocks.projectConfigFindUnique },
    storyboardPanel: { findFirst: mocks.storyboardPanelFindFirst },
    voiceLine: { findMany: mocks.voiceLineFindMany },
  },
}));

vi.mock("@/lib/assets/story-world", () => ({
  loadProjectAssetStoryWorldContext: vi.fn().mockResolvedValue({
    lock: { setting: "premodern", evidence: ["王朝"] },
    groundingText: "王朝古镇",
  }),
  getStoryWorldDirective: vi.fn(() => "故事时代硬约束：前现代世界"),
  findStoryWorldTextConflicts: mocks.findStoryWorldTextConflicts,
}));

import { previewStoryboardPanelPrompt } from "./project-asset-tasks";

describe("storyboard prompt preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findStoryWorldTextConflicts.mockReturnValue([]);
    mocks.projectConfigFindUnique.mockResolvedValue({ artStyle: "chinese-ink" });
    mocks.voiceLineFindMany.mockResolvedValue([]);
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
    expect(preview.compiledPrompt).toContain("不可省略的结构化镜头制作蓝图");
    expect(preview.compiledPrompt).toContain("林玄受创");
    expect(preview.compiledPrompt).toContain("林玄站立");
    expect(preview.compiledPrompt).toContain("嘴角溢出鲜血");
    expect(preview.finalPrompt).toContain("嘴角留有少量红色水迹");
    expect(preview.safetyRewrites).toEqual([
      expect.objectContaining({ category: "visible_blood" }),
    ]);
  });

  it("does not scan the system story-world prohibition as positive shot content", async () => {
    mocks.findStoryWorldTextConflicts.mockImplementation(
      (text: string, context: unknown) => {
        void context;
        return text.includes("故事时代硬约束")
          ? ["现代建筑或室内"]
          : [];
      },
    );

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
    expect(mocks.findStoryWorldTextConflicts).toHaveBeenCalledWith(
      expect.not.stringContaining("故事时代硬约束"),
      expect.anything(),
    );
  });

  it("reports missing video references and dialogue audio without creating a task", async () => {
    mocks.voiceLineFindMany.mockResolvedValue([
      {
        speaker: "林玄",
        content: "退后。",
        delivery: "dialogue",
        durationSeconds: 1.2,
        audioAssetId: null,
      },
    ]);

    const preview = await previewStoryboardPanelPrompt({
      userId: "user-1",
      projectId: "project-1",
      episodeId: "episode-1",
      panelId: "panel-1",
      kind: "video",
      mode: "reference",
    });

    expect(preview.issues.map((issue) => issue.code)).toEqual([
      "missing_reference_frame",
      "missing_dialogue_audio",
    ]);
    expect(preview.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "dialogue_timing" }),
      ]),
    );
    expect(preview.compiledPrompt).toContain("动作时间线");
    expect(preview.compiledPrompt).toContain("林玄后退一步");
    expect(preview.compiledPrompt).toContain("逐角色分拍表演");
    expect(preview.compiledPrompt).toContain("稳住呼吸再判断来袭方向");
    expect(preview.compiledPrompt).toContain("摄影机位与构图规则");
    expect(preview.compiledPrompt).toContain("保持林玄与来袭方向同框");
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
  };
}
