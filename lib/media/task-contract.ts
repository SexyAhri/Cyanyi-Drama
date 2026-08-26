import type {
  ChannelProtocol,
  ModelCapability,
} from "@/lib/agent/provider-types";
import {
  createMediaTaskTraceContext,
  type TraceContext,
} from "@/lib/observability/trace-context";

export type MediaTaskKind = Exclude<ModelCapability, "text">;

export type MediaTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export type MediaTaskError = {
  code?: string;
  message: string;
  retryable: boolean;
  providerStatus?: number | string;
};

export type MediaAsset = {
  id: string;
  kind: MediaTaskKind;
  url: string;
  storageKey?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  thumbnailUrl?: string;
  metadata?: Record<string, unknown>;
};

export type MediaTask = {
  id: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  workflowRunId?: string;
  workflowStepId?: string;
  projectId?: string;
  episodeId?: string;
  batchId?: string;
  channelId?: string;
  targetType?: string;
  targetId?: string;
  idempotencyKey?: string;
  kind: MediaTaskKind;
  status: MediaTaskStatus;
  provider: string;
  protocol: ChannelProtocol;
  model: string;
  request: Record<string, unknown>;
  output?: MediaAsset[];
  error?: MediaTaskError;
  providerTaskId?: string;
  retryCount: number;
  maxRetries: number;
  progress: number;
  progressMessage?: string;
  queueJobId?: string;
  cancelRequestedAt?: string;
  heartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type MediaTaskEvent =
  | { type: "start"; at?: string }
  | { type: "succeed"; output: MediaAsset[]; at?: string }
  | { type: "fail"; error: MediaTaskError; at?: string }
  | { type: "cancel"; at?: string }
  | { type: "retry"; at?: string };

export type MediaTaskEventRecord = {
  id: string;
  taskId: string;
  type:
    | "created"
    | "queued"
    | "running"
    | "progress"
    | "heartbeat"
    | "retry_scheduled"
    | "succeeded"
    | "failed"
    | "billing_settlement_failed"
    | "cancel_requested"
    | "canceled";
  status?: MediaTaskStatus;
  progress?: number;
  message?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export function createMediaTask(input: {
  id: string;
  projectId?: string;
  episodeId?: string;
  batchId?: string;
  channelId?: string;
  targetType?: string;
  targetId?: string;
  idempotencyKey?: string;
  kind: MediaTaskKind;
  provider: string;
  protocol: ChannelProtocol;
  model: string;
  request: Record<string, unknown>;
  maxRetries?: number;
  providerTaskId?: string;
  traceParent?: TraceContext;
  now?: string;
}): MediaTask {
  const now = input.now ?? new Date().toISOString();
  const trace = createMediaTaskTraceContext(input.id, input.traceParent);
  return {
    id: input.id,
    traceId: trace.traceId,
    spanId: trace.spanId,
    parentSpanId: trace.parentSpanId,
    workflowRunId: trace.workflowRunId,
    workflowStepId: trace.workflowStepId,
    projectId: input.projectId,
    episodeId: input.episodeId,
    batchId: input.batchId,
    channelId: input.channelId,
    targetType: input.targetType,
    targetId: input.targetId,
    idempotencyKey: input.idempotencyKey,
    kind: input.kind,
    status: "queued",
    provider: input.provider,
    protocol: input.protocol,
    model: input.model,
    request: input.request,
    providerTaskId: input.providerTaskId,
    retryCount: 0,
    maxRetries: Math.max(0, input.maxRetries ?? 2),
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateMediaTaskProgress(
  task: MediaTask,
  progress: number,
  message?: string,
  at = new Date().toISOString(),
): MediaTask {
  if (!["queued", "running"].includes(task.status)) {
    throw new Error(`MEDIA_TASK_PROGRESS_INVALID_STATUS:${task.status}`);
  }

  return {
    ...task,
    progress: Math.min(100, Math.max(0, Math.round(progress))),
    progressMessage: message,
    heartbeatAt: at,
    updatedAt: at,
  };
}

export function requestMediaTaskCancel(
  task: MediaTask,
  at = new Date().toISOString(),
): MediaTask {
  if (!["queued", "running"].includes(task.status)) {
    throw new Error(`MEDIA_TASK_CANCEL_INVALID_STATUS:${task.status}`);
  }

  return {
    ...task,
    cancelRequestedAt: at,
    updatedAt: at,
  };
}

export function transitionMediaTask(
  task: MediaTask,
  event: MediaTaskEvent,
): MediaTask {
  const at = event.at ?? new Date().toISOString();

  if (event.type === "start") {
    assertStatus(task, ["queued", "failed"], "start");
    return {
      ...task,
      status: "running",
      progress: Math.max(task.progress, 1),
      startedAt: task.startedAt ?? at,
      heartbeatAt: at,
      cancelRequestedAt: undefined,
      updatedAt: at,
      error: undefined,
    };
  }

  if (event.type === "succeed") {
    assertStatus(task, ["running"], "succeed");
    return {
      ...task,
      status: "succeeded",
      progress: 100,
      progressMessage: undefined,
      output: event.output,
      error: undefined,
      completedAt: at,
      heartbeatAt: at,
      updatedAt: at,
    };
  }

  if (event.type === "fail") {
    assertStatus(task, ["queued", "running"], "fail");
    return {
      ...task,
      status: "failed",
      error: event.error,
      completedAt: at,
      heartbeatAt: at,
      updatedAt: at,
    };
  }

  if (event.type === "cancel") {
    assertStatus(task, ["queued", "running"], "cancel");
    return {
      ...task,
      status: "canceled",
      progressMessage: undefined,
      completedAt: at,
      heartbeatAt: at,
      updatedAt: at,
    };
  }

  assertStatus(task, ["failed"], "retry");
  if (task.retryCount >= task.maxRetries) {
    throw new Error("MEDIA_TASK_RETRY_LIMIT_REACHED");
  }
  return {
    ...task,
    status: "queued",
    progressMessage: undefined,
    cancelRequestedAt: undefined,
    retryCount: task.retryCount + 1,
    updatedAt: at,
    completedAt: undefined,
    error: undefined,
  };
}

function assertStatus(
  task: MediaTask,
  allowed: MediaTaskStatus[],
  event: MediaTaskEvent["type"],
) {
  if (allowed.includes(task.status)) {
    return;
  }
  throw new Error(`MEDIA_TASK_INVALID_TRANSITION:${task.status}->${event}`);
}
