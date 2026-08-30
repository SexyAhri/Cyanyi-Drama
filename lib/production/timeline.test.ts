import { describe, expect, it } from "vitest";

import {
  buildPanelSubtitleTimings,
  buildSequentialTimeline,
  buildTimelineSubtitles,
  parseTimelineSequence,
} from "./timeline";

describe("production timeline", () => {
  it("keeps panel order and recalculates sequential boundaries", () => {
    const timeline = buildSequentialTimeline([
      { id: "panel-2", shotIndex: 2, duration: 3 },
      { id: "panel-1", shotIndex: 1, duration: 1.5 },
    ]);

    expect(timeline).toEqual({
      version: 2,
      duration: 4.5,
      tracks: [
        expect.objectContaining({ id: "panel-2", start: 0, end: 3 }),
        expect.objectContaining({ id: "panel-1", start: 3, end: 4.5 }),
      ],
    });
  });

  it("limits durations to supported render bounds", () => {
    const timeline = buildSequentialTimeline([
      { id: "short", shotIndex: 0, duration: 0.1 },
      { id: "long", shotIndex: 1, duration: 90 },
      { id: "default", shotIndex: 2, duration: Number.NaN },
    ]);

    expect(timeline.tracks.map((track) => track.duration)).toEqual([
      0.5, 30, 5,
    ]);
  });

  it("filters malformed and duplicate saved tracks", () => {
    expect(
      parseTimelineSequence({
        tracks: [
          { id: " panel-1 ", duration: 2 },
          { id: "panel-1", duration: 8 },
          { id: "", duration: 4 },
          { duration: 6 },
          null,
          { id: "panel-2", duration: 40 },
        ],
      }),
    ).toEqual([
      {
        id: "panel-1",
        duration: 2,
        sourceStart: 0,
        transition: "cut",
        transitionDuration: 0.35,
        volume: 1,
      },
      {
        id: "panel-2",
        duration: 30,
        sourceStart: 0,
        transition: "cut",
        transitionDuration: 0.35,
        volume: 1,
      },
    ]);
  });

  it("preserves and bounds advanced edit settings from saved timelines", () => {
    expect(
      parseTimelineSequence({
        tracks: [
          {
            id: "panel-1",
            duration: 4,
            sourceStart: 3.5,
            volume: 4,
            transition: "fade",
            transitionDuration: 9,
          },
        ],
      }),
    ).toEqual([
      {
        id: "panel-1",
        duration: 4,
        sourceStart: 3.5,
        transition: "fade",
        transitionDuration: 2,
        volume: 2,
      },
    ]);
  });

  it("places dialogue lines sequentially inside the shot", () => {
    const timings = buildPanelSubtitleTimings({
      lineDurations: [5.45, 1.92, 2.83, 6.75],
      trackDuration: 15,
      trackStart: 19,
    });

    expect(timings[0].start).toBe(19);
    expect(timings[0].end).toBeCloseTo(23.82, 1);
    expect(timings[1].start).toBeCloseTo(timings[0].end);
    expect(timings[3].end).toBeCloseTo(34);
  });

  it("builds non-overlapping subtitles after timeline reordering", () => {
    const cues = buildTimelineSubtitles(
      [
        {
          id: "line-1",
          lineIndex: 0,
          speaker: "A",
          content: "First",
          matchedPanelId: "panel-1",
          durationSeconds: 1,
        },
        {
          id: "line-2",
          lineIndex: 1,
          speaker: "A",
          content: "Second",
          matchedPanelId: "panel-1",
          durationSeconds: 2,
        },
        {
          id: "line-3",
          lineIndex: 2,
          speaker: "B",
          content: "Earlier shot",
          matchedPanelId: "panel-2",
          durationSeconds: 2,
        },
      ],
      [
        { id: "panel-2", duration: 2 },
        { id: "panel-1", duration: 3 },
      ],
    );

    expect(cues.map((cue) => cue.id)).toEqual([
      "line-3",
      "line-1",
      "line-2",
    ]);
    expect(cues[0]).toMatchObject({ start: 0, end: 2 });
    expect(cues[1].start).toBe(2);
    expect(cues[1].end).toBeLessThan(cues[2].end);
    expect(cues[2].end).toBe(5);
  });
});
