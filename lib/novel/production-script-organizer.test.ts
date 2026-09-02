import { describe, expect, it } from "vitest";

import { extractProductionScriptCatalog } from "./production-script-organizer";

describe("production script asset catalog", () => {
  it("combines declared assets with explicit dialogue speakers and scene headings", () => {
    const source = `标题：寒门少年
本集资产：
角色：韩宇、韩子枫
场景：韩家庄练武场、简陋屋舍
道具：铁石、无字典籍

场次 01｜预计时长：12 秒｜外景·韩家庄练武场·深冬夜
画面与动作：韩宇举起铁石。
对白/旁白：无

场次 02｜预计时长：15 秒｜内景·简陋屋舍·深冬夜
画面与动作：父子二人隔桌相望。
对白/旁白：
韩宇：父亲，你怎么起来了？
韩子枫：宇儿，你回来了。`;

    expect(extractProductionScriptCatalog(source)).toEqual({
      characters: ["韩宇", "韩子枫"],
      locations: ["韩家庄练武场", "简陋屋舍"],
      props: ["铁石", "无字典籍"],
      declared: {
        characters: ["韩宇", "韩子枫"],
        locations: ["韩家庄练武场", "简陋屋舍"],
        props: ["铁石", "无字典籍"],
      },
      dialogueSpeakers: ["韩宇", "韩子枫"],
    });
  });

  it("recovers speakers and locations from older scripts without an asset list", () => {
    const source = `**场次 01｜预计时长：15 秒｜外景·练武场·深冬夜**
**画面与动作：** 韩宇举起铁石。
**对白/旁白：** 无

**场次 02｜预计时长：15 秒｜内景·简陋屋舍·深冬夜**
**画面与动作：** 韩宇接过典籍。
**对白/旁白：** 韩宇：我会变强。 韩子枫：好。`;

    const catalog = extractProductionScriptCatalog(source);

    expect(catalog.characters).toEqual(["韩宇", "韩子枫"]);
    expect(catalog.locations).toEqual(["练武场", "简陋屋舍"]);
    expect(catalog.props).toEqual([]);
  });

  it("does not turn narration or an empty prop list into assets", () => {
    const source = `本集资产：
角色：林岚
场景：山门
道具：无

场次 01｜预计时长：10 秒｜外景·山门·清晨
对白/旁白：旁白：晨雾散开。`;

    const catalog = extractProductionScriptCatalog(source);

    expect(catalog.characters).toEqual(["林岚"]);
    expect(catalog.props).toEqual([]);
    expect(catalog.dialogueSpeakers).toEqual([]);
  });
});
