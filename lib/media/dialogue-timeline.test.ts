import { describe, expect, it } from "vitest";

import { planPanelDialogue } from "./dialogue-timeline";

describe("dialogue timeline planning", () => {
  it("expands a shot to fit dialogue without changing playback speed", () => {
    const plan = planPanelDialogue({
      lineDurations: [3.78, 9.32, 1.5],
      requestedDurationSeconds: 8,
    });

    expect(plan.durationSeconds).toBe(15);
    expect(plan.playbackRate).toBe(1);
    expect(plan.timings[2].endSeconds).toBeCloseTo(14.6);
  });

  it("uses a bounded speed adjustment when dialogue slightly exceeds 15 seconds", () => {
    const plan = planPanelDialogue({
      lineDurations: [5.45, 1.92, 2.83, 6.75],
      requestedDurationSeconds: 8,
    });

    expect(plan.durationSeconds).toBe(15);
    expect(plan.playbackRate).toBeCloseTo(1.13);
    expect(plan.timings[3].endSeconds).toBeCloseTo(15);
  });

  it("requires a shot split instead of making dialogue unnaturally fast", () => {
    expect(() =>
      planPanelDialogue({
        lineDurations: [10, 10],
        requestedDurationSeconds: 8,
      }),
    ).toThrow("DIALOGUE_REQUIRES_SHOT_SPLIT");
  });
});
