import { config } from "dotenv";

config({ path: ".env.local" });

import { Worker } from "bullmq";

import { getRedisConnection } from "@/lib/queue/connection";
import { MEDIA_QUEUE_NAME, type MediaJob } from "@/lib/queue/media-queue";
import {
  WORKFLOW_QUEUE_NAME,
  type WorkflowJob,
} from "@/lib/queue/workflow-queue";
import { prisma } from "@/lib/server/prisma";
import { processQueuedMediaTask } from "@/lib/queue/media-runtime";
import { processWorkflowJob } from "@/lib/workflow/runtime";
import { startWorkWatchdog } from "@/lib/queue/reconcile";

const stopWatchdog = startWorkWatchdog();

const worker = new Worker<MediaJob>(
  MEDIA_QUEUE_NAME,
  async (job) => {
    const task = await prisma.mediaTask.findFirst({
      where: { id: job.data.taskId, userId: job.data.userId },
    });
    if (!task) throw new Error("MEDIA_TASK_NOT_FOUND");
    if (task.status === "canceled" || task.cancelRequestedAt) {
      await prisma.mediaTask.update({
        where: { id: task.id },
        data: {
          status: "canceled",
          completedAt: new Date(),
          updatedAt: new Date(),
          progressMessage: null,
        },
      });
      await prisma.mediaTaskEvent.create({
        data: {
          taskId: task.id,
          type: "canceled",
          status: "canceled",
          progress: task.progress,
        },
      });
      return;
    }

    const now = new Date();
    await prisma.mediaTask.update({
      where: { id: task.id },
      data: {
        status: "running",
        startedAt: task.startedAt ?? now,
        heartbeatAt: now,
        updatedAt: now,
        progress: Math.max(1, task.progress),
      },
    });
    await prisma.mediaTaskEvent.create({
      data: {
        taskId: task.id,
        type: "running",
        status: "running",
        progress: Math.max(1, task.progress),
      },
    });

    await processQueuedMediaTask(job.data.taskId, job.data.userId);
  },
  {
    connection: getRedisConnection(),
    concurrency: Number(process.env.MEDIA_WORKER_CONCURRENCY || 2),
  },
);

const workflowWorker = new Worker<WorkflowJob>(
  WORKFLOW_QUEUE_NAME,
  async (job) => {
    await processWorkflowJob(job.data.runId, job.data.userId);
  },
  {
    connection: getRedisConnection(),
    concurrency: Number(process.env.WORKFLOW_WORKER_CONCURRENCY || 2),
  },
);

workflowWorker.on("failed", async (job, error) => {
  if (!job) return;
  const now = new Date();
  await prisma.workflowRun.updateMany({
    where: {
      id: job.data.runId,
      userId: job.data.userId,
      status: { notIn: ["canceled", "succeeded"] },
    },
    data: {
      status: "failed",
      error: { code: "WORKFLOW_WORKER_FAILED", message: error.message },
      completedAt: now,
      heartbeatAt: now,
      updatedAt: now,
    },
  });
  await prisma.workflowEvent.create({
    data: {
      runId: job.data.runId,
      type: "failed",
      status: "failed",
      message: error.message,
      payload: { attemptsMade: job.attemptsMade },
    },
  });
});

worker.on("failed", async (job, error) => {
  if (!job) return;
  const retryable = job.attemptsMade < (job.opts.attempts ?? 1);
  const now = new Date();
  await prisma.mediaTask.updateMany({
    where: {
      id: job.data.taskId,
      userId: job.data.userId,
      status: { not: "canceled" },
    },
    data: {
      status: "failed",
      retryCount: job.attemptsMade,
      error: { message: error.message, retryable },
      completedAt: retryable ? null : now,
      updatedAt: now,
      progressMessage: retryable ? "Retrying task" : null,
    },
  });
  await prisma.mediaTaskEvent.create({
    data: {
      taskId: job.data.taskId,
      type: retryable ? "retry_scheduled" : "failed",
      status: "failed",
      message: error.message,
      payload: { retryable, attemptsMade: job.attemptsMade },
    },
  });
});

process.once("SIGTERM", async () => {
  stopWatchdog();
  await worker.close();
  await workflowWorker.close();
  process.exit(0);
});
process.once("SIGINT", async () => {
  stopWatchdog();
  await worker.close();
  await workflowWorker.close();
  process.exit(0);
});
