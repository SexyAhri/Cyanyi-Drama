import type {
  StudioLocale,
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

export function isOperationDeletable(item: OperationItem) {
  if (item.kind === "task")
    return ["canceled", "failed"].includes(item.task.status);
  if (
    !["blocked", "canceled", "failed", "succeeded"].includes(
      item.workflow.status,
    )
  )
    return false;
  const preferredStep =
    item.workflow.steps.find((step) =>
      ["blocked", "failed"].includes(step.status),
    ) ??
    [...item.workflow.steps]
      .reverse()
      .find((step) => step.status !== "pending");
  return preferredStep?.id === item.step.id;
}

export function workflowAttemptLabel(
  step: WorkflowStepSummary,
  locale: StudioLocale,
) {
  const exhausted =
    ["blocked", "failed"].includes(step.status) &&
    step.attempt >= step.maxAttempts;
  if (locale === "zh-CN")
    return exhausted
      ? `已用尽 ${step.attempt}/${step.maxAttempts} 次尝试`
      : `尝试 ${step.attempt}/${step.maxAttempts}`;
  return exhausted
    ? `Attempts exhausted ${step.attempt}/${step.maxAttempts}`
    : `Attempt ${step.attempt}/${step.maxAttempts}`;
}

export function operationErrorMessage(
  error: Record<string, unknown> | undefined,
  locale: StudioLocale,
) {
  const message =
    typeof error?.message === "string" ? error.message.trim() : "";
  if (!message) return "";
  const transport = message.match(
    /STRUCTURED_PROVIDER_TRANSPORT_FAILED:stage=([^;]+);attempts=(\d+);timeoutMs=(\d+);elapsedMs=(\d+);reason=([^;]+);causeCode=([^;]+)/,
  );
  if (transport) {
    const stage = providerStageLabel(transport[1], locale);
    const elapsedSeconds = Math.max(1, Math.round(Number(transport[4]) / 1_000));
    const timeoutSeconds = Math.round(Number(transport[3]) / 1_000);
    const detail = [transport[5], transport[6]]
      .filter((value) => value && value !== "unknown")
      .join(" / ");
    return locale === "zh-CN"
      ? `模型已连接，但${stage}被上游提前关闭；内部重连 ${transport[2]} 次仍失败。本次约 ${elapsedSeconds} 秒，应用超时上限 ${timeoutSeconds} 秒，因此不是应用超时。${detail ? `底层原因：${detail}` : ""}`
      : `The model connected, but the upstream closed the ${stage}. ${transport[2]} internal reconnects failed after about ${elapsedSeconds}s; the app timeout is ${timeoutSeconds}s, so this was not an app timeout.${detail ? ` Cause: ${detail}` : ""}`;
  }
  const timeout = message.match(
    /STRUCTURED_PROVIDER_TIMEOUT:(?:stage=([^;]+);)?timeoutMs=(\d+)(?:;elapsedMs=(\d+))?(?:;reason=([^;]+))?/,
  );
  if (timeout) {
    const stage = providerStageLabel(timeout[1] ?? "request", locale);
    const seconds = Math.round(Number(timeout[2]) / 1_000);
    const elapsed = timeout[3]
      ? Math.round(Number(timeout[3]) / 1_000)
      : seconds;
    return locale === "zh-CN"
      ? `模型${stage}超时：已等待 ${elapsed} 秒，达到应用配置上限 ${seconds} 秒。${timeout[4] ? `底层原因：${timeout[4]}` : ""}`
      : `Model ${stage} timed out after ${elapsed}s, reaching the configured ${seconds}s app limit.${timeout[4] ? ` Cause: ${timeout[4]}` : ""}`;
  }
  const legacyTimeout = message.match(/^STRUCTURED_PROVIDER_TIMEOUT:(\d+)$/);
  if (legacyTimeout) {
    const seconds = Math.round(Number(legacyTimeout[1]) / 1_000);
    return locale === "zh-CN"
      ? `模型响应超时（应用上限 ${seconds} 秒）`
      : `Model response timed out (app limit ${seconds}s)`;
  }
  if (/aborted due to timeout|timed out/i.test(message))
    return locale === "zh-CN" ? "模型响应超时" : "Model response timed out";
  return message;
}

function providerStageLabel(stage: string, locale: StudioLocale) {
  if (locale === "zh-CN")
    return stage === "response_body" ? "响应流" : "请求连接";
  return stage === "response_body" ? "response stream" : "request connection";
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
