import { describe, expect, it } from "vitest";

import { buildSequentialTimeline, parseTimelineSequence } from "./timeline";

describe("production timeline", () => {
  it("keeps panel order and recalculates sequential boundaries", () => {
    const timeline = buildSequentialTimeline([
      { id: "panel-2", shotIndex: 2, duration: 3 },
      { id: "panel-1", shotIndex: 1, duration: 1.5 },
    ]);

    expect(timeline).toEqual({
      version: 1,
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
      { id: "panel-1", duration: 2 },
      { id: "panel-2", duration: 30 },
    ]);
  });
});
