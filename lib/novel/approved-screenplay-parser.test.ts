import { describe, expect, it } from "vitest";

import {
  organizeApprovedScreenplayClip,
  parseApprovedScreenplay,
  splitApprovedScreenplayScenes,
} from "./approved-screenplay-parser";

const SCRIPT = `标题：寒门少年
梗概：韩宇寒夜苦修，父亲交给他母亲留下的典籍。
正文：
成片规格：约 120 秒｜9:16 国风动画
核心剧情：韩宇确认母亲仍在人世。
全局视听规则：深冬寒夜，冷色环境光与油灯暖光并存。

场次 01｜预计时长：10 秒｜外景·韩家练武场·深冬寒夜
画面与动作：韩宇屈膝发力，缓缓举起铁石，随后平稳落地。
镜头表达：中景稳定跟随韩宇的完整发力动作。
对白/旁白：韩宇（内心独白）：我一定要变强；旁白：寒风掠过空旷的练武场。
声音与氛围：寒风声、铁石落地闷响。

场次 02｜预计时长：12 秒｜内景·偏院厅堂·夜
画面与动作：韩子枫缓慢转身，韩宇停在门边。
镜头表达：双人平视中景。
对白/旁白：韩子枫：宇儿，你回来了。；韩宇：父亲，你怎么起来了？
声音与氛围：油灯燃烧声。
特效：无。`;

describe("approved screenplay parser", () => {
  it("splits only on readable scene headers and preserves all source text", () => {
    const clips = splitApprovedScreenplayScenes(SCRIPT);

    expect(clips).toHaveLength(2);
    expect(clips.join("")).toBe(SCRIPT);
    expect(clips[0]).toContain("全局视听规则");
    expect(clips[1]).toContain("场次 02");
  });

  it("separates action, dialogue, narration, sound, and headings", () => {
    const scenes = parseApprovedScreenplay(SCRIPT);

    expect(scenes[0]).toMatchObject({
      durationSeconds: 10,
      intExt: "EXT",
      location: "韩家练武场",
      time: "深冬寒夜",
      action: "韩宇屈膝发力，缓缓举起铁石，随后平稳落地。",
      camera: "中景稳定跟随韩宇的完整发力动作。",
      sound: "寒风声、铁石落地闷响。",
    });
    expect(scenes[0].lines).toEqual([
      {
        character: "韩宇",
        kind: "voiceover",
        parenthetical: "内心独白",
        text: "我一定要变强",
      },
      {
        character: null,
        kind: "voiceover",
        parenthetical: null,
        text: "寒风掠过空旷的练武场。",
      },
    ]);
    expect(scenes[1].lines).toEqual([
      expect.objectContaining({
        character: "韩子枫",
        kind: "dialogue",
        text: "宇儿，你回来了。",
      }),
      expect.objectContaining({
        character: "韩宇",
        kind: "dialogue",
        text: "父亲，你怎么起来了？",
      }),
    ]);
  });

  it("organizes readable text locally without coverage IDs or source anchors", () => {
    const organized = organizeApprovedScreenplayClip("clip-1", SCRIPT, {
      characters: ["韩宇", "韩子枫"],
      locations: ["韩家练武场", "偏院厅堂"],
    });

    expect(organized.beats.scenes).toHaveLength(2);
    expect(organized.dialogue.lines).toHaveLength(2);
    expect(organized.narration.lines).toHaveLength(2);
    expect(JSON.stringify(organized)).not.toMatch(
      /coverage|anchor|beatId|sceneNumber/iu,
    );
    expect(organized.beats.scenes[0].characters).toEqual(["韩宇"]);
    expect(organized.beats.scenes[1].characters).toEqual(["韩宇", "韩子枫"]);
  });

  it("does not treat characters mentioned only in the synopsis as present in scene one", () => {
    const organized = organizeApprovedScreenplayClip(
      "clip-preamble",
      [
        "梗概：韩宇回家探望父亲韩子枫。",
        "场次 01｜预计时长：10 秒｜外景·练武场·夜",
        "画面与动作：韩宇独自在雪地举起铁石。",
        "对白/旁白：无",
      ].join("\n"),
      { characters: ["韩宇", "韩子枫"], locations: ["练武场"] },
    );

    expect(organized.beats.scenes[0].characters).toEqual(["韩宇"]);
  });

  it("recognizes markdown-bold scene headers and field labels", () => {
    const source = [
      "**成片规格：约120秒｜水墨动画｜16:9**",
      "**场次 01｜预计时长：15 秒｜外景·练武场·深冬夜**",
      "**画面与动作：** 韩宇握紧铁石，屈膝发力，铁石缓缓离地。",
      "**镜头表达：** 低角度中景，缓慢推镜。",
      "**对白/旁白：** 韩宇：今日我必举起它。",
      "**声音与氛围：** 寒风与铁石摩擦声。",
      "**场次 02｜预计时长：12 秒｜内景·偏院·深冬夜**",
      "**画面与动作：** 韩宇推门回家，韩子枫缓缓转身。",
      "**镜头表达：** 双人中景。",
      "**对白/旁白：** 韩子枫：宇儿，你回来了。",
      "**声音与氛围：** 木门轻响。",
    ].join("\n");

    const organized = organizeApprovedScreenplayClip("clip-bold", source, {
      characters: ["韩宇", "韩子枫"],
      locations: ["练武场", "偏院"],
    });

    expect(organized.beats.scenes).toHaveLength(2);
    expect(organized.beats.scenes[0]).toMatchObject({
      heading: { intExt: "EXT", location: "练武场", time: "深冬夜" },
      beats: [{ text: "韩宇握紧铁石，屈膝发力，铁石缓缓离地。" }],
    });
    expect(organized.dialogue.lines.map((line) => line.lines)).toEqual([
      "今日我必举起它。",
      "宇儿，你回来了。",
    ]);
  });

  it("separates multiple speakers written on the same dialogue line", () => {
    const organized = organizeApprovedScreenplayClip(
      "clip-dialogue",
      [
        "**场次 01｜预计时长：15 秒｜内景·偏院·深冬夜**",
        "**画面与动作：** 韩宇推门回家，韩子枫缓缓转身。",
        "**对白/旁白：** 韩宇：父亲，你怎么起来了？ 韩子枫：宇儿，你回来了。",
        "**声音与氛围：** 木门轻响。",
      ].join("\n"),
      { characters: ["韩宇", "韩子枫"], locations: ["偏院"] },
    );

    expect(organized.dialogue.lines).toMatchObject([
      { character: "韩宇", lines: "父亲，你怎么起来了？" },
      { character: "韩子枫", lines: "宇儿，你回来了。" },
    ]);
  });

  it("keeps unstructured text as action instead of rejecting it", () => {
    const organized = organizeApprovedScreenplayClip(
      "clip-plain",
      "韩宇推门进屋，韩子枫缓慢转过身。",
      { characters: ["韩宇", "韩子枫"], locations: ["屋内"] },
    );

    expect(organized.beats.scenes[0].beats).toEqual([
      { text: "韩宇推门进屋，韩子枫缓慢转过身。" },
    ]);
  });
});
