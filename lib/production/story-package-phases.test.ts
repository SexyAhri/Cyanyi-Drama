import { describe, expect, it, vi } from "vitest";
import { generateStoryPackageFirstEpisode, type StoryPhaseRunner } from "./story-package-phases";
import { makePackage, phaseResponses } from "./story-package-test-fixture";
import { validateFirstEpisode } from "./story-package-generation";
import { buildSceneReferenceSlots } from "./story-scene-references";
import type { StoryProductionConstraints } from "./story-quality-contract";

function fixture() {
  const story = makePackage();
  story.props = ["旧棉袄", "旧木桌", "登记本与铅笔", "布包"].map(name => ({ ...story.props[0], name }));
  story.locations[0].name = "亲戚家屋与门前";
  story.firstEpisode.scenes.forEach((scene, i) => {
    scene.props = [story.props[i % story.props.length].name];
    scene.location = story.locations[0].name;
    // No generated slot list or numeric references: only creative direction.
    scene.videoPrompt = scene.videoPrompt.replace(/图片\s*\d+（[^）]+）[。，]?/g, "");
  });
  return story;
}

function run(story = fixture(), mutate?: (value: Record<string, unknown>, call: number) => void, constraints?: StoryProductionConstraints) {
  const responses = phaseResponses(story).slice(-story.firstEpisode.scenes.length - 1);
  let count = 0;
  const request = vi.fn();
  const runPhase: StoryPhaseRunner = async phase => {
    request(phase);
    const value = structuredClone(responses.shift()) as Record<string, unknown>;
    mutate?.(value, count++);
    const normalized = phase.normalizeRaw ? phase.normalizeRaw(value) : value;
    const data = phase.schema.parse(normalized);
    const issues = phase.validate?.(data) ?? [];
    if (issues.length) throw new Error(issues.map(issue => issue.code).join(","));
    return data;
  };
  const result = generateStoryPackageFirstEpisode({
    request: runPhase, locale: "zh", assets: story, context: {}, targetSeconds: constraints?.targetDurationSeconds ?? 95, constraints, designTask: "Design only",
    validate: episode => validateFirstEpisode(episode, "zh", story),
  });
  return { result, request };
}

describe("asset-bound first episode phases", () => {
  it("allows exactly two 30-second dramatic scenes without forcing four scene drafts", async () => {
    const story = fixture();
    story.firstEpisode.targetDurationSeconds = 60;
    story.firstEpisode.scenes = story.firstEpisode.scenes.slice(0, 2).map(scene => ({ ...scene, durationSeconds: 30,
      videoPrompt: scene.videoPrompt.replace("15 秒", "30 秒") + "15-30 秒：阿青将零件放回炉边。",
      productionDesign: { ...scene.productionDesign!, motionBeats: [{ startSecond: 0, endSecond: 30, action: "检查并放下零件", camera: "前推" }] } }));
    const { result, request } = run(story, undefined, { sceneCount: 2, targetDurationSeconds: 60 });
    expect((await result).scenes).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[0][0].task).toContain("恰好 2 个连续戏剧场次");
  });
  it("rejects media design that changes frozen boundary states or omits dialogue", async () => {
    await expect(run(fixture(), (value, call) => {
      if (call === 1) (value.productionDesign as { startState: { hands: string } }).startState.hands = "已经空手";
    }).result).rejects.toThrow("frozen_start_state_changed");
    await expect(run(fixture(), (value, call) => {
      if (call === 1) value.videoPrompt = String(value.videoPrompt).replace("这是什么？", "");
    }).result).rejects.toThrow("dialogue_prompt_missing_or_reordered");
  });
  it.each(["omitted", "invalid"])("compiles %s redundant slots without corrective model calls, preserving action and dialogue", async mode => {
    const story = fixture();
    const { result, request } = run(story, (value, call) => {
      if (!call) return;
      if (mode === "omitted") delete value.imageReferenceSlots;
      else value.imageReferenceSlots = [{ number: 99, kind: "prop", name: "不存在" }];
    });
    const episode = await result;
    expect(request).toHaveBeenCalledTimes(7);
    expect(validateFirstEpisode(episode, "zh", story, 95)).toEqual([]);
    episode.scenes.forEach((scene, index) => {
      expect(scene.imageReferenceSlots).toEqual(buildSceneReferenceSlots(story.firstEpisode.scenes[index]));
      expect(scene.action).toBe(story.firstEpisode.scenes[index].action);
      expect(scene.dialogue).toEqual(story.firstEpisode.scenes[index].dialogue);
    });
    const schema = request.mock.calls[1][0].schema;
    expect(schema.safeParse({}).success).toBe(false);
  });

  it.each(["props", "characters", "location", "speaker"])("rejects unregistered %s before any design request", async field => {
    const { result, request } = run(fixture(), (value, call) => {
      if (call) return;
      const scene = (value.firstEpisode as { scenes: Array<Record<string, unknown>> }).scenes[0];
      if (field === "speaker") (scene.dialogue as Array<{ speaker: string }>)[0].speaker = "不存在";
      else scene[field] = field === "location" ? "不存在" : ["不存在"];
    });
    await expect(result).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("accepts presentation-only name variants without changing dramatic text", async () => {
    const story = fixture();
    const { result } = run(story, (value, call) => {
      if (call) return;
      const scene = (value.firstEpisode as { scenes: Array<Record<string, unknown>> }).scenes[0];
      scene.characters = [" ‘阿 青’ "];
      scene.props = [" 旧 棉袄 "];
      scene.location = "亲戚家屋 与门前";
      (scene.dialogue as Array<{ speaker: string }>)[0].speaker = "阿 青";
    });
    const episode = await result;
    expect(episode.scenes[0].characters).toEqual(["阿青"]);
    expect(episode.scenes[0].props).toEqual(["旧棉袄"]);
    expect(episode.scenes[0].dialogue).toEqual(story.firstEpisode.scenes[0].dialogue);
  });

  it("permits no registered props but rejects an invented prop", async () => {
    const story = makePackage();
    story.props = [];
    story.firstEpisode.scenes.forEach(scene => {
      scene.props = [];
      scene.videoPrompt = scene.videoPrompt.replace(/图片\s*\d+（[^）]+）[。，]?/g, "");
    });
    expect((await run(story).result).scenes.every(scene => scene.imageReferenceSlots.length === 2)).toBe(true);
    await expect(run(story, (value, call) => {
      if (!call) (value.firstEpisode as { scenes: Array<{ props: string[] }> }).scenes[0].props = ["布包"];
    }).result).rejects.toThrow();
  });

  it("rejects a registered speaker absent from this scene", async () => {
    const story = fixture();
    story.characters.push({ ...story.characters[0], name: "大伯" });
    const { result } = run(story, (value, call) => {
      if (!call) (value.firstEpisode as { scenes: Array<{ dialogue: Array<{ speaker: string }> }> }).scenes[0].dialogue[0].speaker = "大伯";
    });
    await expect(result).rejects.toThrow("draft_speaker_not_present");
  });

  it("does not let reference headers replace missing timing or directing data", async () => {
    await expect(run(fixture(), (value, call) => {
      if (call === 1) value.videoPrompt = "站立";
    }).result).rejects.toThrow();
    await expect(run(fixture(), (value, call) => {
      if (call === 1) delete value.productionDesign;
    }).result).rejects.toThrow();
    await expect(run(fixture(), (value, call) => {
      if (call === 1) value.videoPrompt = "站立，镜头缓缓移动，人物回头。".repeat(20);
    }).result).rejects.toThrow("video_prompt_timeline_incomplete");
  });
});
