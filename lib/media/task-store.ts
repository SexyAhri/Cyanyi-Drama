import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { compactMediaTaskOutput, compactMediaTaskRequest } from "./public-media";
import { hasPersistedProviderOutput, mergePersistedMediaTaskPayload } from "./task-payload";
import type { MediaAsset, MediaTask } from "./task-contract";
import { transitionMediaTaskExecutionPhase, type MediaTaskEventRecord, type MediaTaskExecutionPhase, type MediaTaskStatus } from "./task-contract";
import { currentProductionConfiguration } from "@/lib/production-configuration/context";
import { resolveProductionRequestConfiguration } from "@/lib/production-configuration/execution";
import { configurationSnapshotSchema } from "@/lib/production-configuration/contract";
import { assertConfigurationScope, resolveProductionConfiguration } from "@/lib/production-configuration/store";
import { captureMediaTargetSourceRevision } from "./target-source-revision";

async function attachTaskConfiguration(userId: string, task: { projectId?: string | null; episodeId?: string | null; targetType?: string | null; targetId?: string | null }, request: Record<string, unknown>) {
  let projectId = task.projectId ?? undefined;
  const episodeId = task.episodeId ?? undefined;
  if (episodeId && !projectId) {
    const episode = await prisma.episode.findFirst({ where: { id: episodeId, project: { userId } }, select: { projectId: true } });
    if (!episode) throw new Error("MEDIA_TASK_EPISODE_NOT_FOUND");
    projectId = episode.projectId;
  }
  let panelId = task.targetType === "storyboard_panel" ? task.targetId ?? undefined : undefined;
  if (task.targetType === "voice_line" && task.targetId) {
    const line = await prisma.voiceLine.findFirst({ where: { id: task.targetId, episode: { projectId, project: { userId } } }, select: { matchedPanelId: true } });
    if (!line) throw new Error("MEDIA_TASK_VOICE_LINE_NOT_FOUND");
    panelId = line.matchedPanelId ?? undefined;
  }
  const parsed = configurationSnapshotSchema.safeParse(request.productionConfiguration);
  if (request.productionConfiguration !== undefined && !parsed.success) throw new Error("MEDIA_TASK_CONFIGURATION_INVALID");
  const current = currentProductionConfiguration();
  const snapshot = parsed.success ? parsed.data : current?.userId === userId ? current.snapshot : await resolveProductionRequestConfiguration(userId, { projectId, episodeId, panelId });
  const result: Record<string, unknown> = { ...request, productionConfiguration: snapshot };
  const sourceRevision = await captureMediaTargetSourceRevision({
    userId,
    projectId: projectId ?? null,
    episodeId: episodeId ?? null,
    targetType: task.targetType ?? null,
    targetId: task.targetId ?? null,
    revisionVersion: 2,
    request,
  });
  if (sourceRevision) result.sourceRevision = sourceRevision;
  if (episodeId && projectId && ["merge_episode_audio", "render_timeline"].includes(String(request.operation)) && !request.panelSoundConfigurations) {
    result.panelSoundConfigurations = await prisma.$transaction(async tx => {
      await assertConfigurationScope(userId, { projectId, episodeId }, tx);
      const panels = await tx.storyboardPanel.findMany({ where: { storyboard: { projectId, episodeId } }, select: { id: true } });
      return Object.fromEntries(await Promise.all(panels.map(async panel => [panel.id, current?.userId === userId ? snapshot : await resolveProductionConfiguration(userId, { projectId, episodeId, panelId: panel.id }, tx)])));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  return result;
}

/** Legacy tasks acquire their first snapshot with a compare-and-set; retries keep it. */
export async function fixMediaTaskConfiguration(task: { id: string; updatedAt: Date; projectId: string | null; episodeId: string | null; targetType: string | null; targetId: string | null; payload: unknown }, request: Record<string, unknown>, userId: string) {
  if (request.productionConfiguration !== undefined) {
    configurationSnapshotSchema.parse(request.productionConfiguration);
    return request;
  }
  const fixed = await attachTaskConfiguration(userId, task, request);
  const payload = task.payload && typeof task.payload === "object" && !Array.isArray(task.payload) ? task.payload : {};
  const updated = await prisma.mediaTask.updateMany({ where: { id: task.id, userId, updatedAt: task.updatedAt }, data: { payload: toJsonValue({ ...payload, request: compactMediaTaskRequest(fixed) }) } });
  if (updated.count) return fixed;
  const latest = await prisma.mediaTask.findFirst({ where: { id: task.id, userId }, select: { payload: true } });
  const savedRequest = (latest?.payload as { request?: Record<string, unknown> } | undefined)?.request;
  if (!savedRequest?.productionConfiguration) throw new Error("MEDIA_TASK_SNAPSHOT_CONFLICT: 请重试以固定任务配置");
  configurationSnapshotSchema.parse(savedRequest.productionConfiguration);
  return savedRequest;
}

export interface MediaTaskStore {
  create(task: MediaTask): Promise<MediaTask>;
  findByIdempotencyKey(key: string): Promise<MediaTask | null>;
  get(id: string): Promise<MediaTask | null>;
  removeTerminal(id: string): Promise<boolean>;
  update(task: MediaTask): Promise<MediaTask>;
  claimFailedTaskForRetry(task: MediaTask, expectedUpdatedAt: string): Promise<boolean>;
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
      task.request = await attachTaskConfiguration(userId, task, task.request);
      await prisma.mediaTask.create({ data: toCreateData(userId, task) });
      await this.appendEvent({
        taskId: task.id,
        type: "created",
        status: task.status,
        progress: task.progress,
        executionPhase: task.executionPhase ?? "queued",
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
    async removeTerminal(id) {
      const result = await prisma.mediaTask.deleteMany({
        where: { id, userId, status: { in: ["canceled", "failed"] } },
      });
      return result.count > 0;
    },
    async update(task) {
      const persisted = await prisma.mediaTask.findFirst({ where: { id: task.id, userId }, select: { payload: true } });
      const savedRequest = (persisted?.payload as { request?: Record<string, unknown> } | undefined)?.request;
      if (savedRequest?.productionConfiguration) task.request = { ...task.request, productionConfiguration: savedRequest.productionConfiguration, ...(savedRequest.panelSoundConfigurations ? { panelSoundConfigurations: savedRequest.panelSoundConfigurations } : {}) };
      await prisma.mediaTask.updateMany({
        where: { id: task.id, userId },
        data: toUpdateData(task, persisted?.payload),
      });
      await this.appendEvent({
        taskId: task.id,
        type: eventTypeForTask(task),
        status: task.status,
        progress: task.progress,
        executionPhase: task.executionPhase,
        message: task.progressMessage,
        payload: task.error ? { error: task.error } : undefined,
      });
      return task;
    },
    async claimFailedTaskForRetry(task, expectedUpdatedAt) {
      const persisted = await prisma.mediaTask.findFirst({
        where: { id: task.id, userId, status: "failed", updatedAt: new Date(expectedUpdatedAt) },
        select: { payload: true },
      });
      if (!persisted) return false;
      const result = await prisma.mediaTask.updateMany({
        where: {
          id: task.id,
          userId,
          status: "failed",
          updatedAt: new Date(expectedUpdatedAt),
        },
        data: toUpdateData(task, persisted.payload),
      });
      if (!result.count) return false;
      await this.appendEvent({
        taskId: task.id,
        type: "queued",
        status: "queued",
        progress: task.progress,
        executionPhase: "queued",
        message: "Manual retry claimed",
      });
      return true;
    },
    async requestCancel(id) {
      const current = await prisma.mediaTask.findFirst({ where: { id, userId } });
      if (!current || !["queued", "running"].includes(current.status)) return null;
      const now = new Date();
      const updated = await prisma.mediaTask.updateMany({
        where: { id, userId, status: current.status },
        data: current.status === "queued"
          ? { status: "canceled", executionPhase: "canceled", cancelRequestedAt: now, completedAt: now, updatedAt: now, progressMessage: null }
          : {
              cancelRequestedAt: now,
              updatedAt: now,
              progressMessage: "Cancellation requested. Local execution will stop; provider-side work may continue, late results are discarded, and provider charges may still apply.",
            },
      });
      if (!updated.count) return null;
      const task = await prisma.mediaTask.findFirst({ where: { id, userId } });
      if (!task) return null;
      await this.appendEvent({
        taskId: id,
        type: "cancel_requested",
        status: task.status as MediaTaskStatus,
        progress: task.progress,
        message: task.status === "running"
          ? "Local execution will stop; provider-side work may continue, late results are discarded, and provider charges may still apply."
          : "Task canceled before provider submission.",
      });
      if (task.status === "canceled") {
        await this.appendEvent({ taskId: id, type: "canceled", status: "canceled", progress: task.progress, executionPhase: "canceled" });
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
          executionPhase: event.executionPhase,
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
        executionPhase: row.executionPhase as MediaTaskExecutionPhase | undefined,
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
        executionPhase: row.executionPhase as MediaTaskExecutionPhase | undefined,
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
      request: compactMediaTaskRequest(task.request),
      output: task.output ? compactMediaTaskOutput(task.output) : null,
    }),
    error: toNullableJson(task.error),
    retryCount: task.retryCount,
    maxRetries: task.maxRetries,
    progress: task.progress,
    progressMessage: task.progressMessage ?? null,
    executionPhase: task.executionPhase ?? (task.status === "running" ? "connecting" : task.status),
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

function toUpdateData(task: MediaTask, currentPayload?: unknown) {
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
    payload: toJsonValue(mergePersistedMediaTaskPayload({ currentPayload, request: task.request, output: task.output })),
    error: toNullableJson(task.error),
    retryCount: task.retryCount,
    maxRetries: task.maxRetries,
    progress: task.progress,
    progressMessage: task.progressMessage ?? null,
    executionPhase: task.executionPhase ?? (task.status === "running" ? "connecting" : task.status),
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
    hasSavedProviderOutput: hasPersistedProviderOutput(row.payload),
    output: payload.output ?? undefined,
    error: row.error as MediaTask["error"] | undefined,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    progress: row.progress,
    progressMessage: row.progressMessage ?? undefined,
    executionPhase: (row.executionPhase || legacyExecutionPhase(row.status)) as MediaTaskExecutionPhase,
    queueJobId: row.queueJobId ?? undefined,
    cancelRequestedAt: row.cancelRequestedAt?.toISOString(),
    heartbeatAt: row.heartbeatAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
  };
}

function legacyExecutionPhase(status: string): MediaTaskExecutionPhase {
  if (["succeeded", "failed", "canceled"].includes(status))
    return status as MediaTaskExecutionPhase;
  return status === "running" ? "connecting" : "queued";
}

/** Persist a validated worker/provider phase and its event without changing the task's coarse status. */
export async function recordMediaTaskExecutionPhase(input: {
  userId: string;
  taskId: string;
  phase: MediaTaskExecutionPhase;
  message?: string;
  providerTaskId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.mediaTask.findFirst({
      where: { id: input.taskId, userId: input.userId },
    });
    if (!row) throw new Error("MEDIA_TASK_NOT_FOUND");
    const task = fromRow(row);
    const next = transitionMediaTaskExecutionPhase(
      task,
      input.phase,
      new Date().toISOString(),
      input.providerTaskId,
    );
    if (next.executionPhase === task.executionPhase && next.providerTaskId === task.providerTaskId)
      return task;
    const updated = await tx.mediaTask.updateMany({
      where: {
        id: input.taskId,
        userId: input.userId,
        status: row.status,
        executionPhase: row.executionPhase,
        updatedAt: row.updatedAt,
      },
      data: {
        executionPhase: next.executionPhase,
        ...(input.providerTaskId ? { providerTaskId: input.providerTaskId } : {}),
        ...(input.message ? { progressMessage: input.message } : {}),
        updatedAt: new Date(next.updatedAt),
        heartbeatAt: new Date(next.heartbeatAt ?? next.updatedAt),
      },
    });
    if (!updated.count) {
      const raced = await tx.mediaTask.findFirst({
        where: { id: input.taskId, userId: input.userId },
      });
      if (
        raced?.executionPhase === input.phase &&
        (!input.providerTaskId || raced.providerTaskId === input.providerTaskId)
      )
        return fromRow(raced);
      throw new Error("MEDIA_TASK_PHASE_CONFLICT");
    }
    if (next.executionPhase !== task.executionPhase)
      await tx.mediaTaskEvent.create({
        data: {
          taskId: input.taskId,
          type: "phase_changed",
          status: row.status,
          progress: row.progress,
          executionPhase: next.executionPhase,
          message: input.message,
          payload: input.providerTaskId ? toJsonValue({ providerTaskId: input.providerTaskId }) : undefined,
        },
      });
    const fresh = await tx.mediaTask.findFirst({
      where: { id: input.taskId, userId: input.userId },
    });
    if (!fresh) throw new Error("MEDIA_TASK_NOT_FOUND");
    return fromRow(fresh);
  });
}

/** Persist provider output before attempting to download or save it so those
 * delivery steps can be retried without issuing another paid generation call. */
export async function persistMediaTaskProviderOutput(input: {
  userId: string;
  taskId: string;
  output: MediaAsset[];
}) {
  if (!input.output.length) throw new Error("MEDIA_PROVIDER_OUTPUT_EMPTY");
  return prisma.$transaction(async (tx) => {
    const row = await tx.mediaTask.findFirst({
      where: { id: input.taskId, userId: input.userId },
    });
    if (!row) throw new Error("MEDIA_TASK_NOT_FOUND");
    if (row.status !== "running") throw new Error("MEDIA_TASK_NOT_RUNNING");
    const task = fromRow(row);
    const now = new Date().toISOString();
    const next = transitionMediaTaskExecutionPhase(task, "downloading", now);
    const existingPayload =
      row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};
    const updated = await tx.mediaTask.updateMany({
      where: {
        id: input.taskId,
        userId: input.userId,
        status: "running",
        executionPhase: row.executionPhase,
        updatedAt: row.updatedAt,
      },
      data: {
        payload: toJsonValue({ ...existingPayload, providerOutput: input.output }),
        executionPhase: "downloading",
        progressMessage: "Provider result received; saving output",
        updatedAt: new Date(now),
        heartbeatAt: new Date(now),
      },
    });
    if (!updated.count) throw new Error("MEDIA_TASK_PHASE_CONFLICT");
    if (next.executionPhase !== task.executionPhase)
      await tx.mediaTaskEvent.create({
        data: {
          taskId: input.taskId,
          type: "phase_changed",
          status: "running",
          progress: row.progress,
          executionPhase: "downloading",
          message: "Provider result received; saving output",
          payload: toJsonValue({ outputCount: input.output.length }),
        },
      });
    return { ...task, executionPhase: "downloading" as const, updatedAt: now };
  });
}
