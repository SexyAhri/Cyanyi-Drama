import { createHash, randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { getRedisConnection } from "./connection";
import { classifyProviderFailure } from "@/lib/providers/failure-classification";

const LEASE_MS = 2 * 60_000;
const RENEW_EVERY_MS = 30_000;
const REQUEST_WINDOW_MS = 60_000;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const RECOVERY_STEP_MS = 30_000;

const ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local leaseUntil = tonumber(ARGV[2])
local concurrencyLimit = tonumber(ARGV[3])
local requestLimit = tonumber(ARGV[4])
local windowMs = tonumber(ARGV[5])
local token = ARGV[6]
local countRequest = tonumber(ARGV[7]) == 1
local minimumConcurrency = tonumber(ARGV[8])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local adaptiveConcurrency = tonumber(redis.call('HGET', KEYS[3], 'current'))
if not adaptiveConcurrency then
  adaptiveConcurrency = concurrencyLimit
  redis.call('HSET', KEYS[3], 'current', adaptiveConcurrency, 'lastIncreaseAt', now, 'cooldownUntil', 0)
end
adaptiveConcurrency = math.max(minimumConcurrency, math.min(concurrencyLimit, adaptiveConcurrency))
local activeCount = redis.call('ZCARD', KEYS[1])
local requestCount = 0
if countRequest then
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - windowMs)
  requestCount = redis.call('ZCARD', KEYS[2])
end
if activeCount >= adaptiveConcurrency or requestCount >= requestLimit then
  local active = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local requests = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  local waitMs = 1000
  if activeCount >= adaptiveConcurrency and active[2] then
    waitMs = math.max(25, tonumber(active[2]) - now)
  end
  if requestCount >= requestLimit and requests[2] then
    waitMs = math.max(waitMs, tonumber(requests[2]) + windowMs - now)
  end
  return {0, waitMs}
end
redis.call('ZADD', KEYS[1], leaseUntil, token)
redis.call('PEXPIRE', KEYS[1], ${LEASE_MS * 2})
if countRequest then
  redis.call('ZADD', KEYS[2], now, token)
  redis.call('PEXPIRE', KEYS[2], windowMs * 2)
end
return {1, 0}
`;

const RATE_LIMIT_FEEDBACK_SCRIPT = `
local now = tonumber(ARGV[1])
local minimumConcurrency = tonumber(ARGV[2])
local maximumConcurrency = tonumber(ARGV[3])
local cooldownMs = tonumber(ARGV[4])
local current = tonumber(redis.call('HGET', KEYS[1], 'current')) or maximumConcurrency
current = math.max(minimumConcurrency, math.floor(current / 2))
redis.call('HSET', KEYS[1], 'current', current, 'lastIncreaseAt', now, 'cooldownUntil', now + cooldownMs)
return current
`;

const SUCCESS_FEEDBACK_SCRIPT = `
local now = tonumber(ARGV[1])
local minimumConcurrency = tonumber(ARGV[2])
local maximumConcurrency = tonumber(ARGV[3])
local cooldownMs = tonumber(ARGV[4])
local recoveryStepMs = tonumber(ARGV[5])
local current = tonumber(redis.call('HGET', KEYS[1], 'current')) or maximumConcurrency
local cooldownUntil = tonumber(redis.call('HGET', KEYS[1], 'cooldownUntil')) or 0
local lastIncreaseAt = tonumber(redis.call('HGET', KEYS[1], 'lastIncreaseAt')) or now
if now < cooldownUntil or now - lastIncreaseAt < recoveryStepMs then return current end
current = math.min(maximumConcurrency, math.max(minimumConcurrency, current + 1))
redis.call('HSET', KEYS[1], 'current', current, 'lastIncreaseAt', now, 'cooldownUntil', cooldownUntil)
return current
`;

const RENEW_SCRIPT = `
if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
  redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
  redis.call('PEXPIRE', KEYS[1], ${LEASE_MS * 2})
  return 1
end
return 0
`;

const RELEASE_SCRIPT = `return redis.call('ZREM', KEYS[1], ARGV[1])`;

export type ProviderCapacityPolicy = {
  concurrency: number;
  minimumConcurrency: number;
  requestsPerMinute: number;
};

type RedisEval = Pick<Redis, "eval">;

export type ProviderCapacityInput = {
  channelId: string;
  model: string;
  providerKey?: string;
  protocol?: string;
  countRequest?: boolean;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  redis?: RedisEval;
  now?: () => number;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  onWaiting?: () => Promise<void> | void;
};

export function resolveProviderCapacityPolicy(input: {
  channelId: string;
  model: string;
  env?: Record<string, string | undefined>;
}): ProviderCapacityPolicy {
  const env = input.env ?? process.env;
  const maximumConcurrency = boundedInteger(env.MEDIA_PROVIDER_DEFAULT_CONCURRENCY, 1, 1, 32);
  const fallback = {
    concurrency: maximumConcurrency,
    minimumConcurrency: Math.min(maximumConcurrency, boundedInteger(env.MEDIA_PROVIDER_MIN_CONCURRENCY, 1, 1, 32)),
    requestsPerMinute: boundedInteger(env.MEDIA_PROVIDER_DEFAULT_REQUESTS_PER_MINUTE, 30, 1, 10_000),
  };
  const configText = env.MEDIA_PROVIDER_LIMITS_JSON;
  if (!configText) return fallback;
  try {
    const config = JSON.parse(configText) as Record<string, unknown>;
    const modelPolicy = config[providerModelKey(input.channelId, input.model)];
    if (!modelPolicy || typeof modelPolicy !== "object" || Array.isArray(modelPolicy)) return fallback;
    const value = modelPolicy as Record<string, unknown>;
    const configuredMaximum = boundedInteger(value.maxConcurrency ?? value.concurrency, fallback.concurrency, 1, 32);
    return {
      concurrency: configuredMaximum,
      minimumConcurrency: Math.min(configuredMaximum, boundedInteger(value.minConcurrency ?? fallback.minimumConcurrency, fallback.minimumConcurrency, 1, 32)),
      requestsPerMinute: boundedInteger(value.requestsPerMinute, fallback.requestsPerMinute, 1, 10_000),
    };
  } catch {
    return fallback;
  }
}

export function providerCapacityKey(input: {
  channelId: string;
  model: string;
  providerKey?: string;
  protocol?: string;
}) {
  const identity = [input.channelId, input.model, input.providerKey ?? "", input.protocol ?? ""].join("\u0000");
  return createHash("sha256").update(identity).digest("hex");
}

/** Distributed per-channel/model admission shared by every media worker process. */
export async function withProviderCapacity<T>(
  input: ProviderCapacityInput,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const redis = input.redis ?? getRedisConnection();
  const now = input.now ?? Date.now;
  const wait = input.wait ?? delay;
  const policy = resolveProviderCapacityPolicy(input);
  const key = providerCapacityKey(input);
  const activeKey = `media-provider-capacity:${key}:active`;
  const requestKey = `media-provider-capacity:${key}:requests`;
  const adaptiveKey = `media-provider-capacity:${key}:adaptive`;
  const token = randomUUID();
  let waitingNotified = false;

  while (true) {
    throwIfAborted(input.signal);
    const current = now();
    const [acquired, waitMs] = await redis.eval(
      ACQUIRE_SCRIPT,
      3,
      activeKey,
      requestKey,
      adaptiveKey,
      String(current),
      String(current + LEASE_MS),
      String(policy.concurrency),
      String(input.countRequest === false ? 10_000 : policy.requestsPerMinute),
      String(REQUEST_WINDOW_MS),
      token,
      String(input.countRequest === false ? 0 : 1),
      String(policy.minimumConcurrency),
    ) as [number | string, number | string];
    if (Number(acquired) === 1) break;
    if (!waitingNotified) {
      waitingNotified = true;
      await input.onWaiting?.();
    }
    await wait(Math.min(1000, Math.max(25, Number(waitMs) || 1000)), input.signal);
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) onAbort();
  else input.signal?.addEventListener("abort", onAbort, { once: true });
  let renewalFailed = false;
  const heartbeat = setInterval(() => {
    void redis.eval(RENEW_SCRIPT, 1, activeKey, token, String(now() + LEASE_MS))
      .then((renewed) => {
        if (Number(renewed) !== 1) {
          renewalFailed = true;
          controller.abort(new Error("MEDIA_PROVIDER_CAPACITY_LEASE_LOST"));
        }
      })
      .catch(() => {
        renewalFailed = true;
        controller.abort(new Error("MEDIA_PROVIDER_CAPACITY_RENEWAL_FAILED"));
      });
  }, RENEW_EVERY_MS);
  heartbeat.unref?.();

  try {
    const result = await operation(controller.signal);
    await redis.eval(
      SUCCESS_FEEDBACK_SCRIPT,
      1,
      adaptiveKey,
      String(now()),
      String(policy.minimumConcurrency),
      String(policy.concurrency),
      String(RATE_LIMIT_COOLDOWN_MS),
      String(RECOVERY_STEP_MS),
    ).catch(() => undefined);
    if (renewalFailed) throw controller.signal.reason ?? new Error("MEDIA_PROVIDER_CAPACITY_LEASE_LOST");
    throwIfAborted(input.signal);
    return result;
  } catch (error) {
    if (classifyProviderFailure(error instanceof Error ? error.message : String(error)) === "rate_limit") {
      await redis.eval(
        RATE_LIMIT_FEEDBACK_SCRIPT,
        1,
        adaptiveKey,
        String(now()),
        String(policy.minimumConcurrency),
        String(policy.concurrency),
        String(RATE_LIMIT_COOLDOWN_MS),
      ).catch(() => undefined);
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    input.signal?.removeEventListener("abort", onAbort);
    await redis.eval(RELEASE_SCRIPT, 1, activeKey, token).catch(() => 0);
  }
}

export function providerModelKey(channelId: string, model: string) {
  return `${channelId}/${model}`;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted)
    throw signal.reason instanceof Error ? signal.reason : new Error("MEDIA_TASK_CANCEL_REQUESTED");
}

function delay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("MEDIA_TASK_CANCEL_REQUESTED"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
