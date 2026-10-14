import { describe, expect, it } from "vitest";
import { planConfiguredSpeechTiming } from "./configured-speech-timing";
describe("confirmed speech timing", () => {
  it("keeps explicit pauses and places off-screen speech at its confirmed time", () => {
    expect(planConfiguredSpeechTiming([{ durationSeconds: 2, startSeconds: 1, endSeconds: 3 }, { durationSeconds: 1, startSeconds: 4 }], 5).timings).toMatchObject([{ startSeconds: 1, endSeconds: 3, playbackRate: 1 }, { startSeconds: 4, endSeconds: 5, playbackRate: 1 }]);
  });
  it("rejects speech that cannot fit instead of truncating or silently changing timing", () => {
    expect(() => planConfiguredSpeechTiming([{ durationSeconds: 2, startSeconds: 4, endSeconds: 6 }], 5)).toThrow("TIMING_INVALID");
    expect(() => planConfiguredSpeechTiming([{ durationSeconds: 3, startSeconds: 1, endSeconds: 2 }], 5)).toThrow("TIMING_RATE");
  });
  it("preserves the existing sequential timing when no explicit times are supplied", () => {
    expect(planConfiguredSpeechTiming([{ durationSeconds: 1 }, { durationSeconds: 2 }], 5).timings).toMatchObject([{ startSeconds: 0, endSeconds: 1 }, { startSeconds: 1, endSeconds: 3 }]);
  });
});
