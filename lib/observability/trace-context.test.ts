import { describe, expect, it } from "vitest";

import {
  createMediaTaskTraceContext,
  createWorkflowStepTraceContext,
  createWorkflowTraceContext,
} from "./trace-context";

describe("execution trace context", () => {
  it("links workflow, step, and media task spans under one trace", () => {
    const run = createWorkflowTraceContext("run-1");
    const step = createWorkflowStepTraceContext({
      runId: "run-1",
      stepId: "step-1",
      parent: run,
    });
    const task = createMediaTaskTraceContext("task-1", step);

    expect(new Set([run.traceId, step.traceId, task.traceId]).size).toBe(1);
    expect(step.parentSpanId).toBe(run.spanId);
    expect(task.parentSpanId).toBe(step.spanId);
    expect(task).toMatchObject({
      workflowRunId: "run-1",
      workflowStepId: "step-1",
    });
  });

  it("keeps standalone media task trace ids stable across retries", () => {
    expect(createMediaTaskTraceContext("task-1")).toEqual(
      createMediaTaskTraceContext("task-1"),
    );
  });
});
