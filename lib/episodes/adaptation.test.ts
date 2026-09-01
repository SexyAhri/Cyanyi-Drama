import { describe, expect, it } from "vitest";

import {
  buildEpisodeContinuityContext,
  parseAdaptationText,
} from "./adaptation";

describe("episode adaptation local metadata", () => {
  it("reads AI-authored title and synopsis from a soft text format", () => {
    expect(
      parseAdaptationText(
        "标题：寒门少年\n梗概：韩宇苦练后得知母亲仍在世。\n正文：\n凛冽冬夜，韩宇仍在练武。",
      ),
    ).toEqual({
      title: "寒门少年",
      summary: "韩宇苦练后得知母亲仍在世。",
      content: "凛冽冬夜，韩宇仍在练武。",
    });
  });

  it("keeps unformatted AI prose instead of failing a format check", () => {
    expect(parseAdaptationText("凛冽冬夜，韩宇仍在练武。")).toEqual({
      title: null,
      summary: null,
      content: "凛冽冬夜，韩宇仍在练武。",
    });
  });
});

describe("episode adaptation continuity", () => {
  it("separates prior continuity from the next-episode hard boundary", () => {
    const context = buildEpisodeContinuityContext({
      episodeNumber: 2,
      previous: {
        episodeNumber: 1,
        name: "第一集",
        description: "韩宇接过古籍",
        novelText: `开场${"前".repeat(1_300)}上一集结尾`,
      },
      next: {
        episodeNumber: 3,
        name: "第三集",
        description: "宗门来人",
        novelText: `下一集开场${"后".repeat(1_300)}`,
      },
    });

    expect(context.previousEpisode?.boundaryText).toContain("上一集结尾");
    expect(context.previousEpisode?.boundaryText).not.toContain("开场");
    expect(context.nextEpisode?.boundaryText).toContain("下一集开场");
    expect(context.nextEpisode?.boundaryText).not.toContain("后".repeat(1_250));
    expect(context.policy).toContain("do not consume");
  });
});
