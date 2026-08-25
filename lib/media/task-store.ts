import type { MediaTask } from "./task-contract";
import {
  getDatabase,
  persistDatabase,
  queryRows,
  runSql,
} from "@/lib/server/database";

export interface MediaTaskStore {
  create(task: MediaTask): Promise<MediaTask>;
  get(id: string): Promise<MediaTask | null>;
  update(task: MediaTask): Promise<MediaTask>;
  list(filter?: {
    status?: MediaTask["status"];
    limit?: number;
  }): Promise<MediaTask[]>;
}

/**
 * Development-only store. Replace this implementation with a database-backed
 * store before running multiple instances or deploying serverless workers.
 */
export function createMemoryMediaTaskStore(): MediaTaskStore {
  const tasks = new Map<string, MediaTask>();

  return {
    async create(task) {
      if (tasks.has(task.id)) {
        throw new Error("MEDIA_TASK_ALREADY_EXISTS");
      }
      tasks.set(task.id, task);
      return task;
    },
    async get(id) {
      return tasks.get(id) ?? null;
    },
    async update(task) {
      if (!tasks.has(task.id)) {
        throw new Error("MEDIA_TASK_NOT_FOUND");
      }
      tasks.set(task.id, task);
      return task;
    },
    async list(filter) {
      const values = [...tasks.values()]
        .filter((task) => !filter?.status || task.status === filter.status)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return filter?.limit ? values.slice(0, filter.limit) : values;
    },
  };
}

export const mediaTaskStore = createMemoryMediaTaskStore();

export function createDatabaseMediaTaskStore(userId: string): MediaTaskStore {
  return {
    async create(task) {
      const database = await getDatabase();
      runSql(
        database,
        `INSERT INTO media_tasks (id, user_id, status, kind, provider, protocol, model, provider_task_id, payload_json, error_json, retry_count, max_retries, created_at, updated_at, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          task.id,
          userId,
          task.status,
          task.kind,
          task.provider,
          task.protocol,
          task.model,
          task.providerTaskId ?? null,
          JSON.stringify({ request: task.request, output: task.output }),
          task.error ? JSON.stringify(task.error) : null,
          task.retryCount,
          task.maxRetries,
          task.createdAt,
          task.updatedAt,
          task.startedAt ?? null,
          task.completedAt ?? null,
        ],
      );
      await persistDatabase();
      return task;
    },
    async get(id) {
      const database = await getDatabase();
      const rows = queryRows<DatabaseTaskRow>(
        database,
        "SELECT * FROM media_tasks WHERE id = ? AND user_id = ? LIMIT 1",
        [id, userId],
      );
      return rows[0] ? fromRow(rows[0]) : null;
    },
    async update(task) {
      const database = await getDatabase();
      runSql(
        database,
        `UPDATE media_tasks SET status = ?, provider_task_id = ?, payload_json = ?, error_json = ?, retry_count = ?, max_retries = ?, updated_at = ?, started_at = ?, completed_at = ? WHERE id = ? AND user_id = ?`,
        [
          task.status,
          task.providerTaskId ?? null,
          JSON.stringify({ request: task.request, output: task.output }),
          task.error ? JSON.stringify(task.error) : null,
          task.retryCount,
          task.maxRetries,
          task.updatedAt,
          task.startedAt ?? null,
          task.completedAt ?? null,
          task.id,
          userId,
        ],
      );
      await persistDatabase();
      return task;
    },
    async list(filter) {
      const database = await getDatabase();
      const rows = queryRows<DatabaseTaskRow>(
        database,
        "SELECT * FROM media_tasks WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?",
        [userId, filter?.limit ?? 100],
      );
      return rows
        .map(fromRow)
        .filter((task) => !filter?.status || task.status === filter.status);
    },
  };
}

type DatabaseTaskRow = {
  id: string;
  status: MediaTask["status"];
  kind: MediaTask["kind"];
  provider: string;
  protocol: MediaTask["protocol"];
  model: string;
  provider_task_id: string | null;
  payload_json: string;
  error_json: string | null;
  retry_count: number;
  max_retries: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

function fromRow(row: DatabaseTaskRow): MediaTask {
  const payload = JSON.parse(row.payload_json) as {
    request?: Record<string, unknown>;
    output?: MediaTask["output"];
  };
  return {
    id: row.id,
    status: row.status,
    kind: row.kind,
    provider: row.provider,
    protocol: row.protocol,
    model: row.model,
    providerTaskId: row.provider_task_id ?? undefined,
    request: payload.request ?? {},
    output: payload.output,
    error: row.error_json ? JSON.parse(row.error_json) : undefined,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
  };
}
