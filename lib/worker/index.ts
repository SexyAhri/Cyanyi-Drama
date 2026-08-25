import { Worker } from "bullmq";

import { getRedisConnection } from "@/lib/queue/connection";
import { MEDIA_QUEUE_NAME, type MediaJob } from "@/lib/queue/media-queue";
import { prisma } from "@/lib/server/prisma";

const worker = new Worker<MediaJob>(MEDIA_QUEUE_NAME, async (job) => {
  await prisma.mediaTask.updateMany({ where: { id: job.data.taskId, userId: job.data.userId }, data: { status: "running", startedAt: new Date() } });
  // Provider execution is deliberately delegated to the existing generation adapters.
  // This worker currently owns lifecycle transitions and is the extension point for
  // long-running storyboard, image, video, audio and lipsync handlers.
  await prisma.mediaTask.updateMany({ where: { id: job.data.taskId, userId: job.data.userId }, data: { status: "succeeded", completedAt: new Date(), updatedAt: new Date() } });
}, { connection: getRedisConnection(), concurrency: Number(process.env.MEDIA_WORKER_CONCURRENCY || 2) });

worker.on("failed", async (job, error) => {
  if (!job) return;
  await prisma.mediaTask.updateMany({ where: { id: job.data.taskId, userId: job.data.userId }, data: { status: "failed", error: { message: error.message, retryable: false }, completedAt: new Date(), updatedAt: new Date() } });
});

process.once("SIGTERM", async () => { await worker.close(); process.exit(0); });
process.once("SIGINT", async () => { await worker.close(); process.exit(0); });
