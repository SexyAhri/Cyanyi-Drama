import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import type { MediaTask } from "./task-contract";
import type { MediaTaskEventRecord, MediaTaskStatus } from "./task-contract";

export interface MediaTaskStore {
  create(task: MediaTask): Promise<MediaTask>;
  findByIdempotencyKey(key: string): Promise<MediaTask | null>;
  get(id: string): Promise<MediaTask | null>;
  update(task: MediaTask): Promise<MediaTask>;
  requestCancel(id: string): Promise<MediaTask | null>;
  appendEvent(
    event: Omit<MediaTaskEventRecord, "id" | "createdAt">,
  ): Promise<MediaTaskEventRecord>;
  listEvents(taskId: string, limit?: number): Promise<MediaTaskEventRecord[]>;
  list(filter?: {
    status?: MediaTask["status"];
    limit?: number;
    projectId?: string;
    episodeId?: string;
    batchId?: string;
  }): Promise<MediaTask[]>;
}

export async function appendMediaTaskEvent(
  userId: string,
  event: Omit<MediaTaskEventRecord, "id" | "createdAt">,
) {
  return createDatabaseMediaTaskStore(userId).appendEvent(event);
}

export function createDatabaseMediaTaskStore(userId: string): MediaTaskStore {
  return {
    async create(task) {
      await prisma.mediaTask.create({ data: toCreateData(userId, task) });
      await this.appendEvent({
        taskId: task.id,
        type: "created",
        status: task.status,
        progress: task.progress,
      });
      return task;
    },
    async findByIdempotencyKey(key) {
      const task = await prisma.mediaTask.findFirst({
        where: { userId, idempotencyKey: key },
      });
      return task ? fromRow(task) : null;
    },
    async get(id) {
      const task = await prisma.mediaTask.findFirst({ where: { id, userId } });
      return task ? fromRow(task) : null;
    },
    async update(task) {
      await prisma.mediaTask.updateMany({
        where: { id: task.id, userId },
        data: toUpdateData(task),
      });
      await this.appendEvent({
        taskId: task.id,
        type: eventTypeForTask(task),
        status: task.status,
        progress: task.progress,
        message: task.progressMessage,
        payload: task.error ? { error: task.error } : undefined,
      });
      return task;
    },
    async requestCancel(id) {
      const current = await prisma.mediaTask.findFirst({ where: { id, userId } });
      if (!current || !["queued", "running"].includes(current.status)) return null;
      const now = new Date();
      const updated = await prisma.mediaTask.updateMany({
        where: { id, userId, status: current.status },
        data: current.status === "queued"
          ? { status: "canceled", cancelRequestedAt: now, completedAt: now, updatedAt: now, progressMessage: null }
          : { cancelRequestedAt: now, updatedAt: now, progressMessage: "Cancellation requested" },
      });
      if (!updated.count) return null;
      const task = await prisma.mediaTask.findFirst({ where: { id, userId } });
      if (!task) return null;
      await this.appendEvent({
        taskId: id,
        type: "cancel_requested",
        status: task.status as MediaTaskStatus,
        progress: task.progress,
      });
      if (task.status === "canceled") {
        await this.appendEvent({ taskId: id, type: "canceled", status: "canceled", progress: task.progress });
      }
      return fromRow(task);
    },
    async appendEvent(event) {
      const row = await prisma.mediaTaskEvent.create({
        data: {
          taskId: event.taskId,
          type: event.type,
          status: event.status,
          progress: event.progress,
          message: event.message,
          payload: event.payload ? toJsonValue(event.payload) : undefined,
        },
      });
      return {
        id: row.id,
        taskId: row.taskId,
        type: row.type as MediaTaskEventRecord["type"],
        status: row.status as MediaTaskStatus | undefined,
        progress: row.progress ?? undefined,
        message: row.message ?? undefined,
        payload: row.payload as Record<string, unknown> | undefined,
        createdAt: row.createdAt.toISOString(),
      };
    },
    async listEvents(taskId, limit = 100) {
      const rows = await prisma.mediaTaskEvent.findMany({
        where: { taskId, task: { userId } },
        orderBy: { createdAt: "asc" },
        take: Math.min(Math.max(limit, 1), 500),
      });
      return rows.map((row) => ({
        id: row.id,
        taskId: row.taskId,
        type: row.type as MediaTaskEventRecord["type"],
        status: row.status as MediaTaskStatus | undefined,
        progress: row.progress ?? undefined,
        message: row.message ?? undefined,
        payload: row.payload as Record<string, unknown> | undefined,
        createdAt: row.createdAt.toISOString(),
      }));
    },
    async list(filter) {
      const rows = await prisma.mediaTask.findMany({
        where: {
          userId,
          ...(filter?.status ? { status: filter.status } : {}),
          ...(filter?.projectId ? { projectId: filter.projectId } : {}),
          ...(filter?.episodeId ? { episodeId: filter.episodeId } : {}),
          ...(filter?.batchId ? { batchId: filter.batchId } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: filter?.limit ?? 100,
      });
      return rows.map(fromRow);
    },
  };
}

function eventTypeForTask(task: MediaTask): MediaTaskEventRecord["type"] {
  if (task.status === "succeeded") return "succeeded";
  if (task.status === "failed") return "failed";
  if (task.status === "canceled") return "canceled";
  if (task.status === "running" && task.progress <= 1) return "running";
  if (task.status === "queued") return "queued";
  return "progress";
}

function toCreateData(userId: string, task: MediaTask) {
  return {
    id: task.id,
    userId,
    traceId: task.traceId,
    spanId: task.spanId,
    parentSpanId: task.parentSpanId ?? null,
    workflowRunId: task.workflowRunId ?? null,
    workflowStepId: task.workflowStepId ?? null,
    idempotencyKey: task.idempotencyKey ?? null,
    projectId: task.projectId ?? null,
    episodeId: task.episodeId ?? null,
    batchId: task.batchId ?? null,
    channelId: task.channelId ?? null,
    targetType: task.targetType ?? null,
    targetId: task.targetId ?? null,
    status: task.status,
    kind: task.kind,
    provider: task.provider,
    protocol: task.protocol,
    model: task.model,
    providerTaskId: task.providerTaskId ?? null,
    payload: toJsonValue({
      request: task.request,
      output: task.output ?? null,
    }),
    error: toNullableJson(task.error),
    retryCount: task.retryCount,
    maxRetries: task.maxRetries,
    progress: task.progress,
    progressMessage: task.progressMessage ?? null,
    queueJobId: task.queueJobId ?? null,
    cancelRequestedAt: task.cancelRequestedAt
      ? new Date(task.cancelRequestedAt)
      : null,
    heartbeatAt: task.heartbeatAt ? new Date(task.heartbeatAt) : null,
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
    startedAt: task.startedAt ? new Date(task.startedAt) : null,
    completedAt: task.completedAt ? new Date(task.completedAt) : null,
  };
}

function toUpdateData(task: MediaTask) {
  return {
    idempotencyKey: task.idempotencyKey ?? null,
    projectId: task.projectId ?? null,
    episodeId: task.episodeId ?? null,
    batchId: task.batchId ?? null,
    channelId: task.channelId ?? null,
    targetType: task.targetType ?? null,
    targetId: task.targetId ?? null,
    status: task.status,
    providerTaskId: task.providerTaskId ?? null,
    payload: toJsonValue({
      request: task.request,
      output: task.output ?? null,
    }),
    error: toNullableJson(task.error),
    retryCount: task.retryCount,
    maxRetries: task.maxRetries,
    progress: task.progress,
    progressMessage: task.progressMessage ?? null,
    queueJobId: task.queueJobId ?? null,
    cancelRequestedAt: task.cancelRequestedAt
      ? new Date(task.cancelRequestedAt)
      : null,
    heartbeatAt: task.heartbeatAt ? new Date(task.heartbeatAt) : null,
    updatedAt: new Date(task.updatedAt),
    startedAt: task.startedAt ? new Date(task.startedAt) : null,
    completedAt: task.completedAt ? new Date(task.completedAt) : null,
  };
}

function toJsonValue(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toNullableJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null || value === undefined) return Prisma.DbNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

type MediaTaskRow = Prisma.MediaTaskGetPayload<Record<string, never>>;

function fromRow(row: MediaTaskRow): MediaTask {
  const payload = row.payload as {
    request?: Record<string, unknown>;
    output?: MediaTask["output"];
  };
  return {
    id: row.id,
    traceId: row.traceId,
    spanId: row.spanId,
    parentSpanId: row.parentSpanId ?? undefined,
    workflowRunId: row.workflowRunId ?? undefined,
    workflowStepId: row.workflowStepId ?? undefined,
    idempotencyKey: row.idempotencyKey ?? undefined,
    projectId: row.projectId ?? undefined,
    episodeId: row.episodeId ?? undefined,
    batchId: row.batchId ?? undefined,
    channelId: row.channelId ?? undefined,
    targetType: row.targetType ?? undefined,
    targetId: row.targetId ?? undefined,
    status: row.status as MediaTask["status"],
    kind: row.kind as MediaTask["kind"],
    provider: row.provider,
    protocol: row.protocol as MediaTask["protocol"],
    model: row.model,
    providerTaskId: row.providerTaskId ?? undefined,
    request: payload.request ?? {},
    output: payload.output ?? undefined,
    error: row.error as MediaTask["error"] | undefined,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    progress: row.progress,
    progressMessage: row.progressMessage ?? undefined,
    queueJobId: row.queueJobId ?? undefined,
    cancelRequestedAt: row.cancelRequestedAt?.toISOString(),
    heartbeatAt: row.heartbeatAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
  };
}
