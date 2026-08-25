import type {
  ChannelProtocol,
  ModelCapability,
} from "@/lib/agent/provider-types";

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
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  thumbnailUrl?: string;
  metadata?: Record<string, unknown>;
};

export type MediaTask = {
  id: string;
  projectId?: string;
  episodeId?: string;
  targetType?: string;
  targetId?: string;
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

export function createMediaTask(input: {
  id: string;
  projectId?: string;
  episodeId?: string;
  targetType?: string;
  targetId?: string;
  kind: MediaTaskKind;
  provider: string;
  protocol: ChannelProtocol;
  model: string;
  request: Record<string, unknown>;
  maxRetries?: number;
  providerTaskId?: string;
  now?: string;
}): MediaTask {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id,
    projectId: input.projectId,
    episodeId: input.episodeId,
    targetType: input.targetType,
    targetId: input.targetId,
    kind: input.kind,
    status: "queued",
    provider: input.provider,
    protocol: input.protocol,
    model: input.model,
    request: input.request,
    providerTaskId: input.providerTaskId,
    retryCount: 0,
    maxRetries: Math.max(0, input.maxRetries ?? 2),
    createdAt: now,
    updatedAt: now,
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
      startedAt: task.startedAt ?? at,
      updatedAt: at,
      error: undefined,
    };
  }

  if (event.type === "succeed") {
    assertStatus(task, ["running"], "succeed");
    return {
      ...task,
      status: "succeeded",
      output: event.output,
      error: undefined,
      completedAt: at,
      updatedAt: at,
    };
  }

  if (event.type === "fail") {
    assertStatus(task, ["running"], "fail");
    return {
      ...task,
      status: "failed",
      error: event.error,
      completedAt: at,
      updatedAt: at,
    };
  }

  if (event.type === "cancel") {
    assertStatus(task, ["queued", "running"], "cancel");
    return {
      ...task,
      status: "canceled",
      completedAt: at,
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
