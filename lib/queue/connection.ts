import IORedis from "ioredis";

let connection: IORedis | null = null;

export function getRedisConnection() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL must be configured.");
  connection ??= new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
  return connection;
}
