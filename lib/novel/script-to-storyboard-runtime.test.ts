import { beforeEach, describe, expect, it, vi } from "vitest";

const listProductionClips = vi.hoisted(() => vi.fn());
const listProductionProps = vi.hoisted(() => vi.fn());
const getStoryboard = vi.hoisted(() => vi.fn());
const saveStoryboard = vi.hoisted(() => vi.fn());
const episodeFindFirst = vi.hoisted(() => vi.fn());
const storyClipUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/production/domain-store", () => ({
  listProductionClips,
  listProductionProps,
}));
vi.mock("./domain-store", () => ({ getStoryboard, saveStoryboard }));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    episode: { findFirst: episodeFindFirst },
    storyClip: { update: storyClipUpdate },
  },
}));

import {
  buildEpisodeStoryboard,
  buildSceneStoryboardPanels,
  extractProductionDirectives,
} from "./script-to-storyboard-runtime";

const productionScript = `标题：寒门少年
成片规格：约120秒｜中国水墨动画风格，16:9画幅
全局视听规则：冷调青蓝光影，声音以寒风和配乐营造张力，动作聚焦情感抉择。
场次 01｜预计时长：15 秒｜外景·韩家庄练武场·深冬夜
画面与动作：韩宇双手紧握铁石，猛然发力，铁石缓缓离地。
镜头表达：低角度中景，缓慢向上推镜。
对白/旁白：韩宇：我一定要变强。 旁白：寒夜见证少年的坚持。
声音与氛围：凛冽寒风，铁石摩擦声。
视觉特效：稀薄劲气环绕双臂。`;

const screenplay = {
  clipId: "clip-1",
  originalText: productionScript,
  scenes: [
    {
      sceneNumber: 0,
      heading: { intExt: "EXT", location: "韩家庄练武场", time: "深冬夜" },
      description: "镜头表达：低角度中景，缓慢向上推镜。",
      characters: ["韩宇"],
      content: [
        { type: "action", text: "韩宇双手紧握铁石，猛然发力，铁石缓缓离地。" },
        { type: "dialogue", character: "韩宇", parenthetical: null, lines: "我一定要变强。" },
        { type: "voiceover", character: null, text: "寒夜见证少年的坚持。" },
      ],
    },
  ],
};

const clip = {
  id: "clip-1",
  projectId: "project-1",
  episodeId: "episode-1",
  clipIndex: 0,
  summary: "韩宇举起铁石",
  content: productionScript,
  startText: null,
  endText: null,
  screenplay: JSON.stringify(screenplay),
  characters: ["韩宇"],
  locations: ["韩家庄练武场"],
  props: ["铁石"],
  shotCount: null,
  status: "screenplay_ready",
  shots: [],
  createdAt: "2026-09-02T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  episodeFindFirst.mockResolvedValue({
    novelText: productionScript,
    project: { config: { artStyle: "chinese-ink" } },
  });
  listProductionClips.mockResolvedValue([clip]);
  listProductionProps.mockResolvedValue([{ name: "铁石" }]);
  getStoryboard.mockResolvedValue(null);
  saveStoryboard.mockImplementation(
    async (_userId, _projectId, _episodeId, input) => ({
      id: "storyboard-1",
      panels: input.panels,
    }),
  );
  storyClipUpdate.mockResolvedValue({});
});

describe("scene storyboard runtime", () => {
  it("extracts production and audiovisual directives", () => {
    expect(extractProductionDirectives(productionScript)).toEqual({
      productionSpec: "约120秒｜中国水墨动画风格，16:9画幅",
      visualRules: "冷调青蓝光影，声音以寒风和配乐营造张力，动作聚焦情感抉择。",
    });
  });

  it("maps one approved scene to one storyboard card locally", () => {
    const panels = buildSceneStoryboardPanels([clip], {
      artStyle: "中国水墨动画风格",
      productionSpec: "约120秒，16:9",
      visualRules: "冷调青蓝光影",
      propNames: ["铁石"],
      locale: "zh",
    });

    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({
      clipId: "clip-1",
      clipPanelIndex: 0,
      panelIndex: 0,
      sceneNumber: 0,
      locationName: "韩家庄练武场",
      characters: ["韩宇"],
      props: ["铁石"],
      durationSeconds: 15,
      cameraMove: "低角度中景，缓慢向上推镜。",
      voiceoverText: "寒夜见证少年的坚持。",
      speakingCharacter: null,
      lipSyncText: null,
      phase: "scene",
      status: "ready",
    });
    expect(panels[0].videoPrompt).toContain("仅生成静音视频");
    expect(panels[0].videoPrompt).not.toContain("我一定要变强");
    expect(panels[0].videoPrompt).not.toContain("凛冽寒风");
    expect(panels[0].imagePrompt).toContain("稀薄劲气环绕双臂");
  });

  it("persists scene cards without a model request or hard review", async () => {
    const hooks = {
      assertActive: vi.fn().mockResolvedValue(undefined),
      persistArtifact: vi.fn().mockResolvedValue(undefined),
    };
    const result = await buildEpisodeStoryboard(
      "user-1",
      { projectId: "project-1", episodeId: "episode-1", locale: "zh" },
      hooks,
    );

    expect(result).toMatchObject({
      source: "local-production-script",
      clipCount: 1,
      sceneCount: 1,
      panelCount: 1,
      promptTraces: [],
    });
    expect(saveStoryboard).toHaveBeenCalledWith(
      "user-1",
      "project-1",
      "episode-1",
      expect.objectContaining({ status: "ready", preserveImagePrompts: false }),
    );
    expect(hooks.persistArtifact).toHaveBeenCalledWith(
      "storyboard.scenes",
      "episode-1",
      expect.objectContaining({ sceneCount: 1 }),
    );
    expect(storyClipUpdate).toHaveBeenCalledWith({
      where: { id: "clip-1" },
      data: { status: "storyboard_ready", shotCount: 1 },
    });
  });
});
