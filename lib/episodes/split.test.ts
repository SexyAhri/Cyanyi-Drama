import { describe, expect, it } from "vitest";

import {
  detectEpisodeMarkers,
  resolveAiEpisodeBoundaries,
  summarizeEpisodeContent,
} from "./split";

describe("episode splitting", () => {
  it("splits explicit Chinese episode markers without changing source text", () => {
    const source = [
      "前言内容".repeat(20),
      "\n第1集：相遇\n" + "第一集正文。".repeat(30),
      "\n第2集：追踪\n" + "第二集正文。".repeat(30),
      "\n第3集：真相\n" + "第三集正文。".repeat(30),
    ].join("");

    const result = detectEpisodeMarkers(source);

    expect(result.hasMarkers).toBe(true);
    expect(result.markerType).toBe("第X集");
    expect(result.episodes.map((episode) => episode.number)).toEqual([1, 2, 3]);
    expect(result.episodes.map((episode) => episode.content).join("")).toBe(source);
  });

  it("resolves AI markers into exact gap-free source slices", () => {
    const source = "序幕。第一段开始，事件发生，第一段结束。第二段开始，冲突升级，第二段结束。";
    const episodes = resolveAiEpisodeBoundaries(
      [
        {
          number: 1,
          title: "开端",
          summary: "事件发生",
          startMarker: "第一段开始",
          endMarker: "第一段结束",
        },
        {
          number: 2,
          title: "升级",
          summary: "冲突升级",
          startMarker: "第二段开始",
          endMarker: "第二段结束",
        },
      ],
      source,
    );

    expect(episodes).toHaveLength(2);
    expect(episodes.map((episode) => episode.content).join("")).toBe(source);
    expect(episodes[0].content).toContain("序幕");
    expect(episodes[1].content).toContain("第二段结束");
  });

  it("rejects an end marker that crosses into the next episode", () => {
    expect(() =>
      resolveAiEpisodeBoundaries(
        [
          {
            number: 1,
            title: "一",
            summary: "",
            startMarker: "A start",
            endMarker: "B end",
          },
          {
            number: 2,
            title: "二",
            summary: "",
            startMarker: "B start",
            endMarker: "B end",
          },
        ],
        "A start A end B start B end",
      ),
    ).toThrow("endMarker 不在本集范围内");
  });

  it("creates a factual local preview summary without using metadata headings", () => {
    expect(
      summarizeEpisodeContent(
        "第1章 初见\n作者：测试作者\n少年推开院门，看见多年未归的父亲站在雨中。",
      ),
    ).toBe("少年推开院门，看见多年未归的父亲站在雨中。");
  });
});
