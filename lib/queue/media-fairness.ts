import { createHash } from "node:crypto";
import type Redis from "ioredis";
import { getRedisConnection } from "./connection";

export type MediaQueuePriorityClass = "manual_retry" | "interactive" | "normal" | "batch";

const TICKET_TTL_MS = 7 * 24 * 60 * 60_000;
const RESERVE_SCRIPT = `
local existing = redis.call('HGET', KEYS[1], 'priority')
if existing then return {0, tonumber(existing)} end
local pending = redis.call('INCR', KEYS[2])
local priorityClass = ARGV[2]
local priority = tonumber(ARGV[1])
if priorityClass == 'batch' or priorityClass == 'normal' then
  priority = priority + math.min(pending, 1000)
end
redis.call('HSET', KEYS[1], 'projectKey', KEYS[2], 'priority', priority)
redis.call('PEXPIRE', KEYS[1], ${TICKET_TTL_MS})
redis.call('PEXPIRE', KEYS[2], ${TICKET_TTL_MS})
return {1, priority}
`;

const RELEASE_SCRIPT = `
local projectKey = redis.call('HGET', KEYS[1], 'projectKey')
if not projectKey then return 0 end
redis.call('DEL', KEYS[1])
local remaining = redis.call('DECR', projectKey)
if remaining <= 0 then redis.call('DEL', projectKey) end
return 1
`;

export function mediaQueuePriorityBase(priorityClass: MediaQueuePriorityClass) {
  if (priorityClass === "manual_retry") return 1;
  if (priorityClass === "interactive") return 2;
  return priorityClass === "batch" ? 100 : 200;
}

export async function reserveMediaQueuePriority(input: {
  jobId: string;
  projectId?: string;
  priorityClass?: MediaQueuePriorityClass;
  redis?: Pick<Redis, "eval">;
}) {
  const priorityClass = input.priorityClass ?? "normal";
  const base = mediaQueuePriorityBase(priorityClass);
  if (!input.projectId || priorityClass === "manual_retry" || priorityClass === "interactive") return base;
  const redis = input.redis ?? getRedisConnection();
  const ticketKey = `media-queue-project-ticket:${hash(input.jobId)}`;
  const projectKey = `media-queue-project-pending:${hash(input.projectId)}`;
  const result = await redis.eval(RESERVE_SCRIPT, 2, ticketKey, projectKey, String(base), priorityClass) as [number | string, number | string];
  return Number(result[1]);
}

export async function releaseMediaQueuePriority(input: {
  jobId?: string | null;
  redis?: Pick<Redis, "eval">;
}) {
  if (!input.jobId) return false;
  const redis = input.redis ?? getRedisConnection();
  const ticketKey = `media-queue-project-ticket:${hash(input.jobId)}`;
  return Number(await redis.eval(RELEASE_SCRIPT, 1, ticketKey)) === 1;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
