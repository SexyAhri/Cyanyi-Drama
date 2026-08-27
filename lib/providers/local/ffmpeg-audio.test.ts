import { describe, expect, it } from "vitest";

import { buildAudioTimelineFilter } from "./ffmpeg-audio";

describe("audio timeline filter", () => {
  it("concatenates explicit silence and dialogue segments", () => {
    const filters = buildAudioTimelineFilter(
      [
        { startSeconds: 19, durationSeconds: 4.82, playbackRate: 1.13 },
        { startSeconds: 23.82, durationSeconds: 1.7, playbackRate: 1.13 },
        { startSeconds: 34, durationSeconds: 9.36 },
      ],
      66,
    );

    expect(filters).toContain("anullsrc=r=44100:cl=mono:d=19.000000[silence0]");
    expect(filters.join(";")).toContain("atempo=1.130000");
    expect(filters.join(";")).not.toContain("amix");
    expect(filters.at(-1)).toContain("concat=n=6:v=0:a=1");
  });

  it("rejects overlapping dialogue clips", () => {
    expect(() =>
      buildAudioTimelineFilter(
        [
          { startSeconds: 1, durationSeconds: 2 },
          { startSeconds: 2, durationSeconds: 1 },
        ],
        5,
      ),
    ).toThrow("AUDIO_TIMELINE_CLIP_OVERLAP");
  });
});
