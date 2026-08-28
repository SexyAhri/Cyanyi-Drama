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

const traceNameCopy: Record<StudioLocale, Record<string, string>> = {
  "zh-CN": {
    "story-to-script": "小说转剧本",
    "script-to-storyboard": "剧本转分镜",
    analyze_novel: "小说分析",
    parse: "小说分析",
    parse_novel: "小说分析",
    split: "剧情分片",
    split_clips: "剧情分片",
    screenplay: "剧本生成",
    convert_screenplay: "剧本生成",
    storyboard: "分镜生成",
    build_storyboard: "分镜生成",
    voice: "配音分析",
    voice_analyze: "配音分析",
    story_character_analysis: "角色分析",
    story_location_prop_analysis: "场景与道具分析",
    story_clip_segmentation: "剧情分片",
    story_screenplay_conversion: "剧本转换",
    story_screenplay_revision: "剧本修订",
    story_storyboard_planning: "分镜规划",
    story_cinematography: "摄影设计",
    story_acting_direction: "表演设计",
    story_storyboard_refinement: "分镜细化",
    story_voice_analysis: "配音分析",
    story_continuity_review: "连续性检查",
  },
  en: {
    "story-to-script": "Story to screenplay",
    "script-to-storyboard": "Screenplay to storyboard",
    analyze_novel: "Novel analysis",
    parse: "Novel analysis",
    parse_novel: "Novel analysis",
    split: "Story segmentation",
    split_clips: "Story segmentation",
    screenplay: "Screenplay generation",
    convert_screenplay: "Screenplay generation",
    storyboard: "Storyboard generation",
    build_storyboard: "Storyboard generation",
    voice: "Voice analysis",
    voice_analyze: "Voice analysis",
    story_character_analysis: "Character analysis",
    story_location_prop_analysis: "Location and prop analysis",
    story_clip_segmentation: "Story segmentation",
    story_screenplay_conversion: "Screenplay conversion",
    story_screenplay_revision: "Screenplay revision",
    story_storyboard_planning: "Storyboard planning",
    story_cinematography: "Cinematography design",
    story_acting_direction: "Acting direction",
    story_storyboard_refinement: "Storyboard refinement",
    story_voice_analysis: "Voice analysis",
    story_continuity_review: "Continuity review",
  },
};

const artifactNameCopy: Record<StudioLocale, Record<string, string>> = {
  "zh-CN": {
    "screenplay.clip": "剧本片段",
    "storyboard.clip.fallback": "分镜片段（降级结果）",
    "storyboard.clip.phase1": "分镜规划",
    "storyboard.clip.phase2.cine": "摄影设计",
    "storyboard.clip.phase2.acting": "表演设计",
    "storyboard.clip.phase3": "分镜细化",
    "storyboard.clip.continuity": "连续性检查",
  },
  en: {
    "screenplay.clip": "Screenplay clip",
    "storyboard.clip.fallback": "Storyboard clip (fallback)",
    "storyboard.clip.phase1": "Storyboard planning",
    "storyboard.clip.phase2.cine": "Cinematography design",
    "storyboard.clip.phase2.acting": "Acting direction",
    "storyboard.clip.phase3": "Storyboard refinement",
    "storyboard.clip.continuity": "Continuity review",
  },
};

export function traceSpanLabel(
  span: StudioExecutionSpan,
  locale: StudioLocale,
) {
  if (span.kind === "workflow_attempt") {
    const attempt = span.name.match(/attempt-(\d+)/)?.[1] ?? span.name;
    return locale === "zh-CN" ? `第 ${attempt} 次尝试` : `Attempt ${attempt}`;
  }
  if (span.kind === "workflow_artifact") {
    const artifactType = stringAttribute(span.attributes.artifactType);
    const label = artifactNameCopy[locale][artifactType] ?? artifactType ?? span.name;
    const clipIndex = numberAttribute(span.attributes.clipIndex);
    return clipIndex === undefined
      ? label
      : locale === "zh-CN"
        ? `${label} ${clipIndex + 1}`
        : `${label} ${clipIndex + 1}`;
  }
  return traceNameCopy[locale][span.name] ?? humanizeIdentifier(span.name);
}

export function traceSpanKindLabel(
  kind: StudioExecutionSpan["kind"],
  locale: StudioLocale,
) {
  const labels = {
    "zh-CN": {
      workflow_run: "工作流",
      workflow_step: "工作流步骤",
      workflow_attempt: "执行尝试",
      workflow_artifact: "中间结果",
      prompt: "模型调用",
      media_task: "媒体任务",
    },
    en: {
      workflow_run: "Workflow",
      workflow_step: "Workflow step",
      workflow_attempt: "Execution attempt",
      workflow_artifact: "Intermediate result",
      prompt: "Model call",
      media_task: "Media task",
    },
  } as const;
  return labels[locale][kind];
}

export function traceEventLabel(type: string, locale: StudioLocale) {
  const labels: Record<StudioLocale, Record<string, string>> = {
    "zh-CN": {
      created: "工作流已创建",
      running: "工作流已开始",
      step_running: "步骤已开始",
      artifact_committed: "中间结果已保存",
      step_succeeded: "步骤已完成",
      succeeded: "工作流已完成",
      failed: "执行失败",
      blocked: "等待人工确认",
      manual_gate: "进入人工确认",
      cancel_requested: "已请求取消",
      canceled: "已取消",
      retry_requested: "已请求重试工作流",
      step_retry_requested: "已请求重试步骤",
    },
    en: {
      created: "Workflow created",
      running: "Workflow started",
      step_running: "Step started",
      artifact_committed: "Intermediate result saved",
      step_succeeded: "Step completed",
      succeeded: "Workflow completed",
      failed: "Execution failed",
      blocked: "Awaiting approval",
      manual_gate: "Approval requested",
      cancel_requested: "Cancellation requested",
      canceled: "Canceled",
      retry_requested: "Workflow retry requested",
      step_retry_requested: "Step retry requested",
    },
  };
  return labels[locale][type] ?? humanizeIdentifier(type);
}

export function traceEventSourceLabel(
  source: "media_task" | "workflow",
  locale: StudioLocale,
) {
  if (locale === "zh-CN") return source === "workflow" ? "工作流" : "媒体任务";
  return source === "workflow" ? "Workflow" : "Media task";
}

export function localizedTraceAttributes(
  attributes: Record<string, unknown>,
  locale: StudioLocale,
) {
  if (locale !== "zh-CN") return attributes;
  const labels: Record<string, string> = {
    runId: "运行 ID",
    projectId: "项目 ID",
    episodeId: "剧集 ID",
    targetType: "目标类型",
    targetId: "目标 ID",
    workflowVersion: "工作流版本",
    stepId: "步骤 ID",
    stepType: "步骤类型",
    stepIndex: "步骤序号",
    attempt: "当前尝试",
    maxAttempts: "最大尝试次数",
    attemptId: "尝试 ID",
    provider: "模型渠道",
    model: "模型",
    inputHash: "输入摘要",
    usage: "Token 用量",
    errorCode: "错误代码",
    errorMessage: "错误详情",
    artifactId: "结果 ID",
    artifactType: "结果类型",
    refId: "关联对象 ID",
    clipId: "片段 ID",
    clipIndex: "片段序号",
    sceneCount: "场景数",
    reused: "复用已有结果",
    degraded: "使用降级结果",
    success: "是否成功",
    error: "错误详情",
    fallbackReason: "降级原因",
    promptId: "提示词 ID",
    agentId: "Agent ID",
    promptVersion: "提示词版本",
    promptVersionHash: "提示词版本摘要",
    systemHash: "系统提示词摘要",
    structuredOutputMode: "结构化输出模式",
    repaired: "JSON 已修复",
    correctionAttempts: "纠正次数",
    tokenUsage: "Token 用量",
    outputHash: "输出摘要",
  };
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [labels[key] ?? key, value]),
  );
}

function humanizeIdentifier(value: string) {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : value;
}

function stringAttribute(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberAttribute(value: unknown) {
  return typeof value === "number" ? value : undefined;
}
