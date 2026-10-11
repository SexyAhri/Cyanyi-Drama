import { createHmac } from "node:crypto";
import IORedis from "ioredis";

import { getAppSecret } from "./app-secret";

const WINDOW_SECONDS = 15 * 60;
const EMAIL_LIMIT = 10;
const IP_LIMIT = 60;

const consumeAttemptScript = `
local emailCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local ipCount = tonumber(redis.call('GET', KEYS[2]) or '0')
if emailCount >= tonumber(ARGV[1]) or ipCount >= tonumber(ARGV[2]) then
  local emailTtl = redis.call('TTL', KEYS[1])
  local ipTtl = redis.call('TTL', KEYS[2])
  return {0, math.max(emailTtl, ipTtl, 1)}
end
ipCount = redis.call('INCR', KEYS[2])
if ipCount == 1 then redis.call('EXPIRE', KEYS[2], ARGV[3]) end
return {1, 0}
`;

const recordFailureScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count
`;

let redis: IORedis | null = null;

export class LoginRateLimitUnavailableError extends Error {
  constructor() {
    super("LOGIN_RATE_LIMIT_UNAVAILABLE");
  }
}

export async function consumeLoginAttempt(email: string, headers: Headers) {
  try {
    const connection = getConnection();
    const emailKey = emailFailureKey(email);
    const ip = clientIp(headers);
    const ipKey = `auth:login:ip:${digest(ip)}`;
    const result = (await connection.eval(
      consumeAttemptScript,
      2,
      emailKey,
      ipKey,
      EMAIL_LIMIT,
      IP_LIMIT,
      WINDOW_SECONDS,
    )) as [number, number];
    return {
      allowed: Number(result[0]) === 1,
      retryAfterSeconds: Number(result[1]) || WINDOW_SECONDS,
    };
  } catch {
    throw new LoginRateLimitUnavailableError();
  }
}

export async function recordFailedLogin(email: string) {
  try {
    await getConnection().eval(
      recordFailureScript,
      1,
      emailFailureKey(email),
      WINDOW_SECONDS,
    );
  } catch {
    throw new LoginRateLimitUnavailableError();
  }
}

export async function clearLoginFailures(email: string) {
  try {
    await getConnection().del(emailFailureKey(email));
  } catch {
    throw new LoginRateLimitUnavailableError();
  }
}

function getConnection() {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new LoginRateLimitUnavailableError();
  redis = new IORedis(url, {
    connectTimeout: 1_500,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  return redis;
}

function digest(value: string) {
  return createHmac("sha256", getAppSecret()).update(value).digest("hex");
}

function emailFailureKey(email: string) {
  return `auth:login:email:${digest(email.trim().toLowerCase())}`;
}

function clientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const realIp = headers.get("x-real-ip")?.trim();
  return (forwarded || realIp || "unknown").slice(0, 255);
}
