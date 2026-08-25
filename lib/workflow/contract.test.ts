import { describe, expect, it } from "vitest";

import {
  assertUniqueStepKeys,
  assertWorkflowAction,
  nextRunnableStep,
} from "./contract";

describe("workflow contract", () => {
  it("rejects duplicate step keys", () => {
    expect(() => assertUniqueStepKeys([
      { key: "parse", type: "parse" },
      { key: "parse", type: "render" },
    ])).toThrow("WORKFLOW_STEP_KEY_DUPLICATE:parse");
  });

  it("only allows resume from paused or blocked states", () => {
    expect(() => assertWorkflowAction("resume", "running")).toThrow("WORKFLOW_RESUME_INVALID_STATUS:running");
    expect(() => assertWorkflowAction("resume", "blocked")).not.toThrow();
  });

  it("does not skip an earlier unfinished step", () => {
    expect(nextRunnableStep([
      { stepIndex: 1, status: "pending" },
      { stepIndex: 0, status: "running" },
    ])).toBeNull();
    expect(nextRunnableStep([
      { stepIndex: 0, status: "succeeded" },
      { stepIndex: 1, status: "pending" },
    ])?.stepIndex).toBe(1);
  });
});
