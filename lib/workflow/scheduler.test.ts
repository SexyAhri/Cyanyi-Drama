import { describe, expect, it } from "vitest";
import {
  resolveFailedDependencyBlockers,
  runWorkflowStepWave,
  scheduleRunnableWorkflowSteps,
} from "./scheduler";

describe("workflow dependency scheduler", () => {
  it("selects independent ready steps together up to the configured concurrency", () => {
    const steps = [
      step("third", 2, ["first"], "pending"),
      step("second", 1, [], "pending"),
      step("first", 0, [], "succeeded"),
      step("fourth", 3, [], "pending"),
    ];

    const result = scheduleRunnableWorkflowSteps(steps, 2);

    expect(result.runnable.map((item) => item.stepKey)).toEqual(["second", "third"]);
    expect(result.pendingCount).toBe(3);
    expect(result.blocked).toEqual([]);
  });

  it("reports the exact unfinished prerequisites and does not dispatch dependents", () => {
    const result = scheduleRunnableWorkflowSteps([
      step("assets", 0, [], "running"),
      step("storyboard", 1, ["assets"], "pending"),
      step("render", 2, ["storyboard", "assets"], "pending"),
    ], 4);

    expect(result.runnable).toEqual([]);
    expect(result.blocked).toEqual([
      { stepKey: "storyboard", waitingOn: [{ stepKey: "assets", status: "running" }] },
      { stepKey: "render", waitingOn: [
        { stepKey: "storyboard", status: "pending" },
        { stepKey: "assets", status: "running" },
      ] },
    ]);
  });

  it("reports missing prerequisites rather than silently dispatching", () => {
    const result = scheduleRunnableWorkflowSteps([step("child", 0, ["missing"], "pending")], 1);
    expect(result.runnable).toEqual([]);
    expect(result.blocked).toEqual([{ stepKey: "child", waitingOn: [{ stepKey: "missing", status: "missing" }] }]);
  });

  it("blocks transitive dependents after an upstream step fails", () => {
    const blockers = resolveFailedDependencyBlockers([
      step("source", 0, [], "failed"),
      step("parse", 1, ["source"], "pending"),
      step("review", 2, ["parse"], "ready"),
      step("independent", 3, [], "pending"),
    ]);

    expect(blockers).toEqual([
      { stepKey: "parse", waitingOn: [{ stepKey: "source", status: "failed" }] },
      { stepKey: "review", waitingOn: [{ stepKey: "parse", status: "blocked" }] },
    ]);
  });

  it("starts selected independent step executions in parallel and waits for the full wave", async () => {
    const steps = [step("a", 0, [], "pending"), step("b", 1, [], "pending"), step("c", 2, [], "pending")];
    const started: string[] = [];
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const wave = runWorkflowStepWave(steps, 2, async (item) => {
      started.push(item.stepKey);
      if (started.length === 2) release();
      await barrier;
      return item.stepKey;
    });

    const result = await wave;
    expect(started).toEqual(["a", "b"]);
    expect(result.results).toEqual(["a", "b"]);
    expect(result.pendingCount).toBe(3);
  });

  it("waits for every independent step to settle before propagating a failure", async () => {
    const steps = [step("failed", 0, [], "pending"), step("still-running", 1, [], "pending")];
    let siblingFinished = false;
    let rejectFailure!: (reason: Error) => void;
    const failed = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
    const wave = runWorkflowStepWave(steps, 2, async (item) => {
      if (item.stepKey === "failed") return failed;
      await new Promise((resolve) => setTimeout(resolve, 5));
      siblingFinished = true;
      return "done";
    });
    rejectFailure(new Error("step failed"));

    await expect(wave).rejects.toThrow("step failed");
    expect(siblingFinished).toBe(true);
  });
});

function step(stepKey: string, stepIndex: number, dependsOn: string[], status: string) {
  return { stepKey, stepIndex, dependsOn, status };
}
