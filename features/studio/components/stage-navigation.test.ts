import { describe, expect, it } from "vitest";
import type { StudioStageState } from "../types";

import { getStageNavigationTarget, stageProgressLabel } from "./stage-navigation";

describe("stage navigation keyboard behavior", () => {
  it("labels server-derived stage totals and partial failures", () => {
    const stage = {
      id: "shots", status: "running", completedTasks: 18, failedTasks: 2, totalTasks: 24,
    } satisfies StudioStageState;
    expect(stageProgressLabel(stage, "zh-CN")).toBe("已完成 18/24 项，失败或阻塞 2 项");
    expect(stageProgressLabel(stage, "en")).toBe("18 of 24 complete, 2 failed or blocked");
    expect(stageProgressLabel({ ...stage, totalTasks: 0 }, "en")).toBeNull();
  });

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
