import { describe, expect, it } from "vitest";
import { inspectSubtitleTimings, parseSavedSubtitles, planSilentSubtitles, subtitleReadingSeconds } from "./subtitle-timing";
import { buildTimelineSubtitles } from "./timeline";

describe("silent subtitle editorial timing", () => {
  it("weights reading length and leaves visible action pauses without changing shot duration", () => {
    const texts = ["这是我妈留下的那把旧伞。", "嗯。"];
    const plan = planSilentSubtitles(texts, 15);
    expect(plan[0].end - plan[0].start).toBeGreaterThan(plan[1].end - plan[1].start);
    expect(plan[0].start).toBeGreaterThan(0);
    expect(plan[1].start).toBeGreaterThan(plan[0].end);
    expect(plan[1].end).toBeLessThan(15);
    expect(plan[1].end - plan[1].start).toBeLessThan(2);
  });
  it("uses word reading for English and refuses unreadable packed shots", () => {
    expect(subtitleReadingSeconds("A long sentence with several words")).toBeGreaterThan(subtitleReadingSeconds("Yes."));
    expect(() => planSilentSubtitles(["一段需要阅读的很长台词", "另一段很长的台词"], 1)).toThrow("SUBTITLE_READING_TIME_INSUFFICIENT");
  });
  it("preserves explicit cue timing and measured audio lengths", () => {
    const cues = buildTimelineSubtitles([
      { id: "1", lineIndex: 0, speaker: "A", content: "一句话", matchedPanelId: "p", durationSeconds: 2, startSeconds: 3, endSeconds: 5 },
      { id: "2", lineIndex: 1, speaker: "B", content: "嗯", matchedPanelId: "p", durationSeconds: 1, startSeconds: 6, endSeconds: 7 },
    ], [{ id: "p", duration: 15 }]);
    expect(cues.map(cue => [cue.start, cue.end])).toEqual([[3, 5], [6, 7]]);
    expect(parseSavedSubtitles(cues)).toEqual(cues);
  });
  it("checks every boundary for overlap, order, range, identity and readability", () => {
    const cue = (id: string, start: number, end: number) => ({ id, index: 0, start, end, speaker: "A", text: "测试" });
    expect(inspectSubtitleTimings([cue("a", 0, 2), cue("b", 1, 3)], 4).map(issue => issue.code)).toContain("overlap");
    expect(inspectSubtitleTimings([cue("a", 2, 3), cue("b", 0, 1)], 4).map(issue => issue.code)).toContain("order");
    expect(inspectSubtitleTimings([cue("a", -1, 8)], 4).map(issue => issue.code)).toContain("invalid");
    expect(inspectSubtitleTimings([cue("a", 0, 0.1)], 4).map(issue => issue.code)).toContain("too_short");
    expect(inspectSubtitleTimings([cue("a", 0, 1), cue("a", 1, 2)], 4).map(issue => issue.code)).toContain("duplicate");
    expect(inspectSubtitleTimings([cue("a", 0, 1), cue("b", 1, 2)], 2)).toEqual([]);
  });
  it("checks silent and unmatched cues independently when another line has real audio", () => {
    const cues = ["audio", "silent", "unknown", "empty-audio"].map((id, index) => ({ id, index, start: index, end: index + 0.2, speaker: "A", text: "嗯" }));
    const issues = inspectSubtitleTimings(cues, 4, [
      { id: "audio", audioAssetId: "audio-asset" },
      { id: "silent", audioAssetId: null },
      { id: "empty-audio", audioAssetId: " " },
    ]);
    expect(issues.map(issue => ({ id: issue.id, code: issue.code }))).toEqual([
      { id: "silent", code: "too_short" },
      { id: "unknown", code: "too_short" },
      { id: "empty-audio", code: "too_short" },
    ]);
  });
});
