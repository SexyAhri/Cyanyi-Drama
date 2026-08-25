export const WORKFLOW_RUN_STATUSES = [
  "queued",
  "running",
  "paused",
  "failed",
  "blocked",
  "succeeded",
  "canceled",
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_STEP_STATUSES = [
  "pending",
  "ready",
  "running",
  "paused",
  "failed",
  "blocked",
  "succeeded",
] as const;
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

export type WorkflowStepInput = {
  key: string;
  type: string;
  input?: Record<string, unknown>;
  maxAttempts?: number;
};

export type WorkflowRunDefinition = {
  id: string;
  userId: string;
  projectId: string;
  episodeId?: string;
  workflowType: string;
  input?: Record<string, unknown>;
  steps: WorkflowStepInput[];
  maxAttempts?: number;
};

export function assertUniqueStepKeys(steps: WorkflowStepInput[]) {
  const keys = new Set<string>();
  for (const step of steps) {
    const key = step.key.trim();
    if (!key) throw new Error("WORKFLOW_STEP_KEY_REQUIRED");
    if (keys.has(key)) throw new Error(`WORKFLOW_STEP_KEY_DUPLICATE:${key}`);
    keys.add(key);
  }
}

export function canPause(status: WorkflowRunStatus) {
  return status === "queued" || status === "running";
}

export function canResume(status: WorkflowRunStatus) {
  return status === "paused" || status === "failed" || status === "blocked";
}

export function canRetry(status: WorkflowRunStatus) {
  return status === "failed" || status === "blocked";
}

export function canCancel(status: WorkflowRunStatus) {
  return status === "queued" || status === "running" || status === "paused";
}

export function assertWorkflowAction(
  action: "pause" | "resume" | "retry" | "cancel",
  status: WorkflowRunStatus,
) {
  const allowed =
    action === "pause"
      ? canPause(status)
      : action === "resume"
        ? canResume(status)
        : action === "retry"
          ? canRetry(status)
          : canCancel(status);
  if (!allowed)
    throw new Error(
      `WORKFLOW_${action.toUpperCase()}_INVALID_STATUS:${status}`,
    );
}

export function nextRunnableStep(
  steps: Array<{ stepIndex: number; status: WorkflowStepStatus }>,
) {
  const ordered = [...steps].sort((a, b) => a.stepIndex - b.stepIndex);
  const firstIncomplete = ordered.find((step) => step.status !== "succeeded");
  if (
    !firstIncomplete ||
    ["running", "paused"].includes(firstIncomplete.status)
  )
    return null;
  return firstIncomplete.status === "pending" ||
    firstIncomplete.status === "ready" ||
    firstIncomplete.status === "failed"
    ? firstIncomplete
    : null;
}
