import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import type { MediaTask } from "./task-contract";

export interface MediaTaskStore {
  create(task: MediaTask): Promise<MediaTask>;
  get(id: string): Promise<MediaTask | null>;
  update(task: MediaTask): Promise<MediaTask>;
  list(filter?: {
    status?: MediaTask["status"];
    limit?: number;
    projectId?: string;
    episodeId?: string;
  }): Promise<MediaTask[]>;
}

export function createDatabaseMediaTaskStore(userId: string): MediaTaskStore {
  return {
    async create(task) {
      await prisma.mediaTask.create({ data: toCreateData(userId, task) });
      return task;
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
      return task;
    },
    async list(filter) {
      const rows = await prisma.mediaTask.findMany({
        where: {
          userId,
          ...(filter?.status ? { status: filter.status } : {}),
          ...(filter?.projectId ? { projectId: filter.projectId } : {}),
          ...(filter?.episodeId ? { episodeId: filter.episodeId } : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: filter?.limit ?? 100,
      });
      return rows.map(fromRow);
    },
  };
}

function toCreateData(userId: string, task: MediaTask) {
  return {
    id: task.id,
    userId,
    projectId: task.projectId ?? null,
    episodeId: task.episodeId ?? null,
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
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
    startedAt: task.startedAt ? new Date(task.startedAt) : null,
    completedAt: task.completedAt ? new Date(task.completedAt) : null,
  };
}

function toUpdateData(task: MediaTask) {
  return {
    projectId: task.projectId ?? null,
    episodeId: task.episodeId ?? null,
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
    projectId: row.projectId ?? undefined,
    episodeId: row.episodeId ?? undefined,
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
  };
}
