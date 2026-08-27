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
});
