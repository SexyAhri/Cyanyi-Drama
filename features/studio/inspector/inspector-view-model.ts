import type {
  StudioMediaTask,
  StudioExecutionSpan,
  StudioUsageCost,
  WorkflowRunSummary,
  WorkflowStepSummary,
  WorkspaceSnapshot,
} from "../types";

export type OperationItem =
  | {
      id: string;
      kind: "workflow-step";
      updatedAt: string;
      workflow: WorkflowRunSummary;
      step: WorkflowStepSummary;
    }
  | { id: string; kind: "task"; updatedAt: string; task: StudioMediaTask };

export function buildOperationItems(
  snapshot: WorkspaceSnapshot,
  episodeId?: string,
): OperationItem[] {
  return [
    ...snapshot.workflows
      .filter((workflow) => !episodeId || workflow.episodeId === episodeId)
      .flatMap((workflow) =>
        workflow.steps.map(
          (step): OperationItem => ({
            id: step.id,
            kind: "workflow-step",
            updatedAt:
              step.completedAt ?? step.startedAt ?? workflow.updatedAt,
            workflow,
            step,
          }),
        ),
      ),
    ...snapshot.tasks
      .filter((task) => !episodeId || task.episodeId === episodeId)
      .map(
        (task): OperationItem => ({
          id: task.id,
          kind: "task",
          updatedAt: task.updatedAt,
          task,
        }),
      ),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function isOperationRetryable(item: OperationItem) {
  if (item.kind === "task")
    return (
      item.task.status === "failed" &&
      item.task.retryCount < item.task.maxRetries
    );
  return (
    ["blocked", "failed"].includes(item.step.status) &&
    item.step.retryable &&
    item.step.attempt < item.step.maxAttempts
  );
}

export function summarizeUsageCosts(costs: StudioUsageCost[]) {
  return costs.reduce(
    (summary, item) => {
      const cost = Number(item.cost);
      summary.total += Number.isFinite(cost) ? cost : 0;
      summary.quantity += item.quantity;
      return summary;
    },
    { quantity: 0, total: 0 },
  );
}

export function buildTraceRows(spans: StudioExecutionSpan[]) {
  const byParent = new Map<string | undefined, StudioExecutionSpan[]>();
  for (const span of spans) {
    const siblings = byParent.get(span.parentSpanId) ?? [];
    siblings.push(span);
    byParent.set(span.parentSpanId, siblings);
  }
  const spanIds = new Set(spans.map((span) => span.spanId));
  const roots = spans.filter(
    (span) => !span.parentSpanId || !spanIds.has(span.parentSpanId),
  );
  const rows: Array<{ depth: number; span: StudioExecutionSpan }> = [];
  const visit = (span: StudioExecutionSpan, depth: number) => {
    rows.push({ depth, span });
    for (const child of byParent.get(span.spanId) ?? [])
      visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  return rows;
}
