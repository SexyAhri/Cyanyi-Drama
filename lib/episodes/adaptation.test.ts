import { describe, expect, it } from "vitest";

import {
  buildEpisodeContinuityContext,
  createJsonStringFieldStream,
  extractPartialJsonStringField,
  normalizeEpisodeAdaptationOutput,
} from "./adaptation";

describe("episode adaptation streaming preview", () => {
  it("extracts a JSON string field before the response is complete", () => {
    expect(
      extractPartialJsonStringField(
        '{"title":"第一集","summary":"完整梗概","adaptedText":"第一段\\n第二段',
        "adaptedText",
      ),
    ).toBe("第一段\n第二段");
    expect(
      extractPartialJsonStringField(
        '{"title":"第一集","summary":"尚未完成',
        "adaptedText",
      ),
    ).toBeNull();
  });

  it("waits for a complete unicode escape instead of showing broken text", () => {
    expect(
      extractPartialJsonStringField(
        '{"adaptedText":"开场\\u4e2',
        "adaptedText",
      ),
    ).toBe("开场");
    expect(
      extractPartialJsonStringField(
        '{"adaptedText":"开场\\u4e2d',
        "adaptedText",
      ),
    ).toBe("开场中");
  });

  it("emits only new adapted text across model chunks", () => {
    const stream = createJsonStringFieldStream("adaptedText");

    expect(stream.push('{"title":"第一集","adapted')).toBe("");
    expect(stream.push('Text":"第一段\\n第')).toBe("第一段\n第");
    expect(stream.push('二段\\u4e2')).toBe("二段");
    expect(stream.push('d","changeSummary":[]}')).toBe("中");
  });
});

describe("episode adaptation normalization", () => {
  it("keeps usable model text and removes obsolete planning fields", () => {
    expect(
      normalizeEpisodeAdaptationOutput(
        {
          status: "ready",
          title: " 第一集 ",
          adaptedText: " 改编正文 ",
          productionPlan: { beats: [] },
        },
        { title: "原始标题" },
      ),
    ).toEqual({
      title: "第一集",
      summary: "改编正文",
      adaptedText: "改编正文",
      changeSummary: [],
    });
  });

  it("accepts common local aliases without another model request", () => {
    expect(
      normalizeEpisodeAdaptationOutput(
        { content: "可用正文", synopsis: "本集梗概", changeSummary: [" 精简说明 ", 1] },
        { title: "默认标题" },
      ),
    ).toEqual({
      title: "默认标题",
      summary: "本集梗概",
      adaptedText: "可用正文",
      changeSummary: ["精简说明"],
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
