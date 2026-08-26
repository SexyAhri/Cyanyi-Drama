import { createHash } from "node:crypto";

export type TraceContext = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  workflowRunId?: string;
  workflowStepId?: string;
};

export function createWorkflowTraceContext(runId: string): TraceContext {
  return {
    traceId: stableTraceId("workflow", runId),
    spanId: stableSpanId("workflow", runId),
    workflowRunId: runId,
  };
}

export function createWorkflowStepTraceContext(input: {
  runId: string;
  stepId: string;
  parent: TraceContext;
}): TraceContext {
  if (input.parent.workflowRunId !== input.runId)
    throw new Error("TRACE_WORKFLOW_PARENT_MISMATCH");
  return {
    traceId: input.parent.traceId,
    spanId: stableSpanId("workflow-step", input.stepId),
    parentSpanId: input.parent.spanId,
    workflowRunId: input.runId,
    workflowStepId: input.stepId,
  };
}

export function createMediaTaskTraceContext(
  taskId: string,
  parent?: TraceContext,
): TraceContext {
  if (parent) assertTraceContext(parent);
  return {
    traceId: parent?.traceId ?? stableTraceId("media-task", taskId),
    spanId: stableSpanId("media-task", taskId),
    parentSpanId: parent?.spanId,
    workflowRunId: parent?.workflowRunId,
    workflowStepId: parent?.workflowStepId,
  };
}

export function assertTraceContext(context: TraceContext) {
  for (const [key, value] of Object.entries({
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: context.parentSpanId,
  })) {
    if (value !== undefined && (!value || value.length > 64))
      throw new Error(`TRACE_${key.replace(/([A-Z])/g, "_$1").toUpperCase()}_INVALID`);
  }
  if (context.workflowStepId && !context.workflowRunId)
    throw new Error("TRACE_STEP_WITHOUT_RUN");
  if (context.workflowStepId && !context.parentSpanId)
    throw new Error("TRACE_LINK_PARENT_REQUIRED");
}

export function stableTraceId(kind: string, id: string) {
  return hash(`trace:${kind}:${requiredId(id)}`);
}

export function stableSpanId(kind: string, id: string) {
  return hash(`span:${kind}:${requiredId(id)}`);
}

function requiredId(value: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error("TRACE_SOURCE_ID_REQUIRED");
  return normalized;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
