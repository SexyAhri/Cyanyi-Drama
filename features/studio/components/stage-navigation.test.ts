import { describe, expect, it } from "vitest";

import { getStageNavigationTarget } from "./stage-navigation";

describe("stage navigation keyboard behavior", () => {
  it("moves between adjacent stages and wraps at either edge", () => {
    expect(getStageNavigationTarget(2, "ArrowLeft", 6)).toBe(1);
    expect(getStageNavigationTarget(2, "ArrowRight", 6)).toBe(3);
    expect(getStageNavigationTarget(0, "ArrowLeft", 6)).toBe(5);
    expect(getStageNavigationTarget(5, "ArrowRight", 6)).toBe(0);
  });

  it("moves directly to the first or last stage", () => {
    expect(getStageNavigationTarget(3, "Home", 6)).toBe(0);
    expect(getStageNavigationTarget(3, "End", 6)).toBe(5);
  });

  it("keeps the current target for unrelated keys", () => {
    expect(getStageNavigationTarget(3, "Enter", 6)).toBe(3);
  });
});
