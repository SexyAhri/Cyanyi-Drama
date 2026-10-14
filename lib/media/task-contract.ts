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

export type MediaTaskExecutionPhase =
  | "queued"
  | "waiting_quota"
  | "connecting"
  | "request_sent"
  | "submitted"
  | "generating"
  | "downloading"
  | "saving"
  | "succeeded"
  | "failed"
  | "canceled";

export type MediaTaskError = {
  code?: string;
  failureStage?: "generation" | "result_storage";
  message: string;
  retryable: boolean;
  providerStatus?: number | string;
};

export type MediaTaskCancellationPolicy = {
  provider: "not_submitted" | "cancellation_unsupported";
  lateResult: "none" | "discard";
  providerMayStillCharge: boolean;
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
  hasSavedProviderOutput?: boolean;
  output?: MediaAsset[];
  error?: MediaTaskError;
  providerTaskId?: string;
  retryCount: number;
  maxRetries: number;
  progress: number;
  progressMessage?: string;
  executionPhase?: MediaTaskExecutionPhase;
  queueJobId?: string;
  cancelRequestedAt?: string;
  heartbeatAt?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancellationPolicy?: MediaTaskCancellationPolicy;
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
    | "canceled"
    | "phase_changed";
  executionPhase?: MediaTaskExecutionPhase;
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
    maxRetries: Math.max(0, input.maxRetries ?? 0),
    progress: 0,
    executionPhase: "queued",
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

const allowedExecutionPhaseTransitions: Record<
  MediaTaskExecutionPhase,
  MediaTaskExecutionPhase[]
> = {
  queued: ["waiting_quota", "connecting", "canceled", "failed"],
  waiting_quota: ["queued", "connecting", "request_sent", "submitted", "generating", "downloading", "saving", "canceled", "failed"],
  connecting: ["waiting_quota", "request_sent", "downloading", "saving", "failed", "canceled"],
  request_sent: ["waiting_quota", "submitted", "generating", "downloading", "saving", "failed", "canceled"],
  submitted: ["waiting_quota", "generating", "downloading", "saving", "failed", "canceled"],
  generating: ["waiting_quota", "downloading", "saving", "failed", "canceled"],
  downloading: ["waiting_quota", "saving", "failed", "canceled"],
  saving: ["waiting_quota", "downloading", "succeeded", "failed", "canceled"],
  succeeded: [],
  failed: ["queued"],
  canceled: [],
};

export function transitionMediaTaskExecutionPhase(
  task: MediaTask,
  executionPhase: MediaTaskExecutionPhase,
  at = new Date().toISOString(),
  providerTaskId?: string,
): MediaTask {
  const currentPhase = task.executionPhase ?? "queued";
  if (executionPhase === currentPhase) {
    return {
      ...task,
      ...(providerTaskId ? { providerTaskId } : {}),
    };
  }
  if (!allowedExecutionPhaseTransitions[currentPhase].includes(executionPhase))
    throw new Error(
      `MEDIA_TASK_INVALID_PHASE_TRANSITION:${currentPhase}->${executionPhase}`,
    );
  if (
    !["queued", "running", "failed"].includes(task.status) &&
    executionPhase !== "canceled"
  )
    throw new Error(`MEDIA_TASK_PHASE_INVALID_STATUS:${task.status}`);
  return {
    ...task,
    executionPhase,
    ...(providerTaskId ? { providerTaskId } : {}),
    updatedAt: at,
    heartbeatAt: at,
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
      executionPhase: (task.executionPhase ?? "queued") === "queued" ? "connecting" : task.executionPhase,
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
      executionPhase: "succeeded",
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
      executionPhase: "failed",
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
      executionPhase: "canceled",
      progressMessage: undefined,
      completedAt: at,
      heartbeatAt: at,
      updatedAt: at,
    };
  }

  assertStatus(task, ["failed"], "retry");
  return {
    ...task,
    status: "queued",
    executionPhase: "queued",
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
