import { describe, expect, it } from "vitest";

import { normalizeScreenplayDialogue } from "./screenplay-dialogue";

describe("screenplay dialogue normalization", () => {
  it("turns a father's inner narration into voice-over and extracts the son's unquoted reassurance", () => {
    const screenplay = normalizeScreenplayDialogue({
      clipId: "clip-1",
      originalText:
        "韩子枫望着儿子，既欣慰又愧疚。若自己没有重伤，韩宇本可早早突破。韩宇反而安慰父亲，只要坚持，终有一天能让轻视他们的人闭嘴。",
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "书房", time: "夜" },
          description: "",
          characters: ["韩宇", "韩子枫"],
          content: [
            {
              type: "action" as const,
              text:
                "韩子枫望着儿子，既欣慰又愧疚。若自己没有重伤，韩宇本可早早突破。韩宇反而安慰父亲，只要坚持，终有一天能让轻视他们的人闭嘴。",
            },
          ],
        },
      ],
    });

    const content = screenplay.scenes[0].content;
    expect(content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "voiceover",
          character: "韩子枫",
          text: expect.stringContaining("韩宇本可早早突破"),
        }),
        {
          type: "dialogue",
          character: "韩宇",
          parenthetical: null,
          lines: "只要坚持，终有一天能让轻视他们的人闭嘴。",
        },
      ]),
    );
  });

  it("keeps calling someone into a room as action and expands a grounded retrieval", () => {
    const source = "韩子枫把韩宇叫进卧房，从暗格中取出一个精致铁盒。";
    const screenplay = normalizeScreenplayDialogue({
      clipId: "clip-1",
      originalText: source,
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "卧房", time: "夜" },
          description: "",
          characters: ["韩宇", "韩子枫"],
          content: [{ type: "action" as const, text: source }],
        },
      ],
    });

    expect(screenplay.scenes[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "action", text: source }),
        expect.objectContaining({
          type: "action",
          origin: "bridge",
          text: "韩子枫走到暗格前，伸手靠近暗格。",
          evidence: [source],
        }),
      ]),
    );
    expect(screenplay.scenes[0].content).not.toContainEqual(
      expect.objectContaining({ type: "dialogue", lines: expect.stringContaining("取出") }),
    );
  });

  it("keeps the previous actor for a separately emitted inner thought", () => {
    const source =
      "韩子枫望着儿子冻红的双手，既欣慰又愧疚。若自己没有重伤，韩宇本可借助灵药早早突破。";
    const screenplay = normalizeScreenplayDialogue({
      clipId: "clip-1",
      originalText: source,
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "卧房", time: "夜" },
          description: "",
          characters: ["韩宇", "韩子枫"],
          content: [
            { type: "action" as const, text: "韩子枫望着儿子冻红的双手，既欣慰又愧疚。" },
            {
              type: "action" as const,
              text: "若自己没有重伤，韩宇本可借助灵药早早突破。",
            },
          ],
        },
      ],
    });

    expect(screenplay.scenes[0].content).toContainEqual({
      type: "voiceover",
      character: "韩子枫",
      text: "若自己没有重伤，韩宇本可借助灵药早早突破。",
    });
  });

  it("demotes a non-spoken retrieval line and preserves its actor", () => {
    const source = "韩子枫把韩宇叫进卧房，从暗格中取出一个精致铁盒。";
    const screenplay = normalizeScreenplayDialogue({
      clipId: "clip-1",
      originalText: source,
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "卧房", time: "夜" },
          description: "",
          characters: ["韩宇", "韩子枫"],
          content: [
            {
              type: "dialogue" as const,
              character: "韩子枫",
              parenthetical: null,
              lines: "从暗格中取出一个精致铁盒。",
            },
          ],
        },
      ],
    });

    expect(screenplay.scenes[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "action", text: "从暗格中取出一个精致铁盒。" }),
        expect.objectContaining({
          type: "action",
          origin: "bridge",
          text: "韩子枫走到暗格前，伸手靠近暗格。",
        }),
      ]),
    );
  });

  it("demotes action text emitted as dialogue after a shouted sound", () => {
    const source =
      "海宏赡厉喝一声，身前的平静海潮顿时骇浪升起，向着九炎天龙席卷而去。";
    const screenplay = normalizeScreenplayDialogue({
      clipId: "clip-1",
      originalText: source,
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT" as const, location: "虚空", time: "日" },
          description: "",
          characters: ["海宏赡", "九炎天龙"],
          content: [
            {
              type: "dialogue" as const,
              character: "海宏赡",
              parenthetical: null,
              lines:
                "身前的平静海潮顿时骇浪升起，向着九炎天龙席卷而去。",
            },
          ],
        },
      ],
    });

    expect(screenplay.scenes[0].content).toContainEqual({
      type: "action",
      text: "身前的平静海潮顿时骇浪升起，向着九炎天龙席卷而去。",
    });
    expect(screenplay.scenes[0].content).not.toContainEqual(
      expect.objectContaining({ type: "dialogue" }),
    );
  });
});
