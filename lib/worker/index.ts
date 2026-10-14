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
import { settleMediaTaskCharge } from "@/lib/billing/service";
import { assertPromptCanaries } from "@/lib/prompts/canary";
import { isMediaFailureRetryable, preventNonRetryableMediaRetry } from "@/lib/queue/media-retry-policy";
import { mediaFailureStage } from "@/lib/queue/media-task-recovery";
import { isMediaTaskCancellation } from "@/lib/media/cancellation";
import { finalizeMediaTaskCancellation } from "@/lib/queue/media-task-cancellation";
import { notifyMediaTaskTerminal, notifyWorkflowTerminal } from "@/lib/notifications/execution-notifications";
import { releaseMediaQueuePriority } from "@/lib/queue/media-fairness";

assertPromptCanaries();
const stopWatchdog = startWorkWatchdog();

const worker = new Worker<MediaJob>(
  MEDIA_QUEUE_NAME,
  async (job) => {
    await releaseMediaQueuePriority({ jobId: job.id }).catch(() => false);
    const task = await prisma.mediaTask.findFirst({
      where: { id: job.data.taskId, userId: job.data.userId },
    });
    if (!task) throw new Error("MEDIA_TASK_NOT_FOUND");
    if (task.queueJobId && task.queueJobId !== job.id) return;
    const persistedError = task.error && typeof task.error === "object" && !Array.isArray(task.error)
      ? task.error as { retryable?: boolean }
      : undefined;
    const sameJobRetry = task.status === "failed" && (task.queueJobId ?? task.id) === job.id && job.attemptsMade > 0 && persistedError?.retryable === true;
    if (task.status === "canceled" || task.cancelRequestedAt) {
      await finalizeMediaTaskCancellation(task.id, task.userId);
      return;
    }
    if (task.status !== "queued" && !sameJobRetry) return;

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
      executionPhase: task.executionPhase,
      },
    });

    const stopHeartbeat = startMediaTaskHeartbeat(job.data.taskId);
    const cancellationController = new AbortController();
    const stopCancellationWatch = startMediaTaskCancellationWatch(
      job.data.taskId,
      job.data.userId,
      cancellationController,
    );
    try {
      let succeeded: boolean;
      try {
        succeeded = await processQueuedMediaTask(job.data.taskId, job.data.userId, cancellationController.signal);
      } catch (error) {
        if (isMediaTaskCancellation(error)) {
          await finalizeMediaTaskCancellation(job.data.taskId, job.data.userId);
          return;
        }
        preventNonRetryableMediaRetry(job, error);
        throw error;
      }
      if (!succeeded) {
        const current = await prisma.mediaTask.findFirst({ where: { id: job.data.taskId, userId: job.data.userId } });
        if (current?.status === "canceled" || current?.cancelRequestedAt) {
          await finalizeMediaTaskCancellation(job.data.taskId, job.data.userId);
          return;
        }
      }
      await settleChargeSafely(job.data.userId, job.data.taskId, succeeded);
      if (succeeded) await notifyMediaTaskTerminal({ userId: job.data.userId, taskId: job.data.taskId, status: "succeeded" });
    } finally {
      stopHeartbeat();
      stopCancellationWatch();
    }
  },
  {
    connection: getRedisConnection(),
    concurrency: Number(process.env.MEDIA_WORKER_CONCURRENCY || 2),
  },
);

function startMediaTaskHeartbeat(taskId: string) {
  const timer = setInterval(() => {
    void prisma.mediaTask
      .updateMany({
        where: { id: taskId, status: "running" },
        data: { heartbeatAt: new Date() },
      })
      .catch(() => undefined);
  }, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}

function startMediaTaskCancellationWatch(
  taskId: string,
  userId: string,
  controller: AbortController,
) {
  let checking = false;
  const timer = setInterval(() => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    void prisma.mediaTask.findFirst({
      where: { id: taskId, userId, status: "running" },
      select: { cancelRequestedAt: true },
    }).then((task) => {
      if (task?.cancelRequestedAt)
        controller.abort(new Error("MEDIA_TASK_CANCEL_REQUESTED"));
    }).catch(() => undefined).finally(() => { checking = false; });
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}

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
  const updated = await prisma.workflowRun.updateMany({
    where: {
      id: job.data.runId,
      userId: job.data.userId,
      status: { in: ["queued", "running"] },
      OR: [
        { leaseOwner: null },
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      status: "failed",
      error: { code: "WORKFLOW_WORKER_FAILED", message: error.message },
      completedAt: now,
      heartbeatAt: now,
      activeDedupeKey: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    },
  });
  if (updated.count) {
    await prisma.workflowEvent.create({
      data: {
        runId: job.data.runId,
        type: "failed",
        status: "failed",
        message: error.message,
        payload: { attemptsMade: job.attemptsMade },
      },
    });
    await notifyWorkflowTerminal({ userId: job.data.userId, runId: job.data.runId, status: "failed" });
  }
});

worker.on("failed", async (job, error) => {
  if (!job) return;
  const retryable = isMediaFailureRetryable(error.message, job.attemptsMade, job.opts.attempts ?? 1);
  const now = new Date();
  const current = await prisma.mediaTask.findFirst({
    where: { id: job.data.taskId, userId: job.data.userId },
    select: { executionPhase: true, providerTaskId: true, payload: true },
  });
  const payload = current?.payload && typeof current.payload === "object" && !Array.isArray(current.payload)
    ? current.payload as { providerOutput?: unknown }
    : undefined;
  const hasProviderOutput = Array.isArray(payload?.providerOutput) && payload.providerOutput.length > 0;
  const failureStage = mediaFailureStage({ executionPhase: current?.executionPhase, hasProviderOutput });
  const timedOutPhase = error.message.match(/MEDIA_PHASE_TIMEOUT:([a-z_]+)/i)?.[1];
  const executionPhase = retryable
    ? hasProviderOutput
      ? current?.executionPhase ?? "downloading"
      : current?.providerTaskId
      ? "generating"
      : "queued"
    : "failed";
  const updated = await prisma.mediaTask.updateMany({
    where: {
      id: job.data.taskId,
      userId: job.data.userId,
      status: { not: "canceled" },
      OR: [{ queueJobId: job.id }, { queueJobId: null }],
    },
    data: {
      status: "failed",
      executionPhase,
      retryCount: job.attemptsMade,
      error: {
        code: timedOutPhase ? `MEDIA_PHASE_TIMEOUT:${timedOutPhase}` : failureStage === "result_storage" ? "MEDIA_RESULT_DELIVERY_FAILED" : "MEDIA_GENERATION_FAILED",
        failureStage,
        message: error.message,
        retryable,
      },
      completedAt: retryable ? null : now,
      updatedAt: now,
      progressMessage: retryable ? "Retrying task" : null,
    },
  });
  if (!updated.count) return;
  await prisma.mediaTaskEvent.create({
    data: {
      taskId: job.data.taskId,
      type: retryable ? "retry_scheduled" : "failed",
      status: "failed",
      executionPhase,
      message: error.message,
      payload: { retryable, attemptsMade: job.attemptsMade, failureStage, hasProviderOutput },
    },
  });
  if (!retryable)
    await notifyMediaTaskTerminal({ userId: job.data.userId, taskId: job.data.taskId, status: "failed", retryCount: job.attemptsMade });
  if (!retryable)
    await settleChargeSafely(job.data.userId, job.data.taskId, false);
});

async function settleChargeSafely(
  userId: string,
  taskId: string,
  succeeded: boolean,
) {
  try {
    await settleMediaTaskCharge(userId, taskId, succeeded);
  } catch (error) {
    await prisma.mediaTaskEvent.create({
      data: {
        taskId,
        type: "billing_settlement_failed",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

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
