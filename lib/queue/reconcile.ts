import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/server/prisma";
import { reconcilePendingMediaCharges } from "@/lib/billing/service";
import { enqueueMediaJob, type MediaJob } from "./media-queue";
import { canResumeMediaProviderTask } from "./media-task-recovery";
import { enqueueWorkflowJob } from "./workflow-queue";
import { expiredMediaQueuePhase, mediaPhaseTimeoutMs } from "./media-phase-timeout";

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_LEASE_GRACE_MS = 30_000;
const DEFAULT_CANCEL_TIMEOUT_MS = 5 * 60_000;

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Marks worker jobs that stopped heartbeating as failed so they can be retried explicitly. */
export async function reconcileStaleWork() {
  const queueCutoff = new Date(
    Date.now() - mediaPhaseTimeoutMs("queued"),
  );
  const quotaCutoff = new Date(Date.now() - mediaPhaseTimeoutMs("waiting_quota"));
  const queuedTasks = await prisma.mediaTask.findMany({
    where: {
      status: "queued",
      OR: [
        { executionPhase: "queued", createdAt: { lt: queueCutoff } },
        { executionPhase: "waiting_quota", updatedAt: { lt: quotaCutoff } },
      ],
    },
    select: { id: true, userId: true, progress: true, createdAt: true, updatedAt: true, executionPhase: true },
    take: 200,
  });
  let queueTimedOutTasks = 0;
  for (const task of queuedTasks) {
    const now = new Date();
    const phase = expiredMediaQueuePhase({ ...task, now });
    if (!phase) continue;
    const timeoutMs = now.getTime() - (phase === "waiting_quota" ? task.updatedAt : task.createdAt).getTime();
    const error = {
      code: `MEDIA_PHASE_TIMEOUT:${phase}`,
      phase,
      message: phase === "waiting_quota"
        ? "媒体任务模型请求名额等待超时：渠道/模型并发或请求速率限制未释放，请检查限额和 worker 状态后重试。"
        : "媒体任务排队超时：队列未能在时限内开始处理，请检查 worker 和队列状态后重试。",
      retryable: true,
    };
    const updated = await prisma.mediaTask.updateMany({
      where: {
        id: task.id,
        userId: task.userId,
        status: "queued",
        executionPhase: task.executionPhase,
        ...(phase === "waiting_quota" ? { updatedAt: { lte: quotaCutoff } } : { createdAt: { lte: queueCutoff } }),
      },
      data: { status: "failed", executionPhase: "failed", error, completedAt: now, updatedAt: now, progressMessage: null },
    });
    if (!updated.count) continue;
    queueTimedOutTasks += 1;
    await prisma.mediaTaskEvent.create({
      data: {
        taskId: task.id,
        type: "failed",
        status: "failed",
        progress: task.progress,
        executionPhase: "failed",
        message: error.message,
        payload: { ...error, timeoutMs },
      },
    });
  }

  const cutoff = new Date(
    Date.now() - numberEnv("TASK_HEARTBEAT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
  );
  const staleTasks = await prisma.mediaTask.findMany({
    where: {
      status: "running",
      heartbeatAt: { lt: cutoff },
    },
    select: {
      id: true,
      userId: true,
      progress: true,
      providerTaskId: true,
      executionPhase: true,
      protocol: true,
      kind: true,
      projectId: true,
      episodeId: true,
      channelId: true,
      batchId: true,
    },
    take: 200,
  });
  let resumedMediaTasks = 0;
  for (const task of staleTasks) {
    const canResumeProviderTask = canResumeMediaProviderTask(task);
    if (canResumeProviderTask) {
      const now = new Date();
      const queueJobId = `${task.id}-resume-${now.getTime()}`;
      const queued = await prisma.mediaTask.updateMany({
        where: { id: task.id, status: "running", heartbeatAt: { lt: cutoff } },
        data: {
          status: "queued",
          executionPhase: "generating",
          error: Prisma.DbNull,
          completedAt: null,
          updatedAt: now,
          heartbeatAt: now,
          queueJobId,
          progressMessage: "Resuming provider task",
        },
      });
      if (!queued.count) continue;
      await prisma.mediaTaskEvent.create({
        data: {
          taskId: task.id,
          type: "queued",
          status: "queued",
          progress: task.progress,
          executionPhase: "generating",
          message: `Resuming provider task after worker heartbeat timeout (${task.executionPhase})`,
          payload: { resumedFromPhase: task.executionPhase, providerTaskId: task.providerTaskId },
        },
      });
      try {
        await enqueueMediaJob({
          taskId: task.id,
          queueJobId,
          userId: task.userId,
          projectId: task.projectId ?? undefined,
          episodeId: task.episodeId ?? undefined,
          channelId: task.channelId ?? undefined,
          priorityClass: task.batchId ? "batch" : "normal",
          kind: task.kind as MediaJob["kind"],
          maxAttempts: 1,
        });
        resumedMediaTasks += 1;
      } catch (error) {
        const failedAt = new Date();
        const failure = {
          code: "MEDIA_TASK_RECOVERY_ENQUEUE_FAILED",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        };
        await prisma.mediaTask.updateMany({
          where: { id: task.id, status: "queued", queueJobId },
          data: {
            status: "failed",
            executionPhase: "failed",
            error: failure,
            completedAt: failedAt,
            updatedAt: failedAt,
            progressMessage: null,
          },
        });
        await prisma.mediaTaskEvent.create({
          data: {
            taskId: task.id,
            type: "failed",
            status: "failed",
            progress: task.progress,
            executionPhase: "failed",
            message: failure.message,
            payload: failure,
          },
        });
      }
      continue;
    }
    const error = {
      code: "WORKER_HEARTBEAT_TIMEOUT",
      message: "媒体任务 worker 心跳超时，请重试任务。",
      retryable: true,
    };
    const updated = await prisma.mediaTask.updateMany({
      where: { id: task.id, status: "running", heartbeatAt: { lt: cutoff } },
      data: {
        status: "failed",
        executionPhase: "failed",
        error,
        completedAt: new Date(),
        updatedAt: new Date(),
        progressMessage: null,
      },
    });
    if (updated.count) {
      await prisma.mediaTaskEvent.create({
        data: {
          taskId: task.id,
          type: "failed",
          status: "failed",
          progress: task.progress,
          executionPhase: "failed",
          message: error.message,
          payload: error,
        },
      });
    }
  }

  const leaseCutoff = new Date(
    Date.now() -
      numberEnv("WORKFLOW_LEASE_RECOVERY_GRACE_MS", DEFAULT_LEASE_GRACE_MS),
  );
  const cancelCutoff = new Date(
    Date.now() -
      numberEnv("WORKFLOW_CANCEL_TIMEOUT_MS", DEFAULT_CANCEL_TIMEOUT_MS),
  );
  const staleRuns = await prisma.workflowRun.findMany({
    where: {
      OR: [
        {
          status: "running",
          leaseExpiresAt: { lt: leaseCutoff },
        },
        {
          status: "running",
          leaseExpiresAt: null,
          heartbeatAt: { lt: cutoff },
        },
        {
          status: "running",
          leaseExpiresAt: null,
          heartbeatAt: null,
          updatedAt: { lt: cutoff },
        },
        {
          status: "canceling",
          cancelRequestedAt: { lt: cancelCutoff },
        },
      ],
    },
    select: {
      id: true,
      userId: true,
      projectId: true,
      status: true,
    },
    take: 200,
  });
  let recoveredRuns = 0;
  let failedRuns = 0;
  for (const run of staleRuns) {
    const outcome =
      run.status === "canceling"
        ? await failTimedOutCancellation(run.id, cancelCutoff)
        : await recoverExpiredWorkflowRun(run.id, leaseCutoff, cutoff);
    if (outcome === "queued") {
      recoveredRuns += 1;
      try {
        await enqueueWorkflowJob({
          runId: run.id,
          userId: run.userId,
          projectId: run.projectId,
          maxAttempts: 1,
        });
      } catch {
        recoveredRuns -= 1;
        failedRuns += 1;
      }
    } else if (outcome === "failed") {
      failedRuns += 1;
    }
  }

  const orphanedQueuedRuns = await prisma.workflowRun.findMany({
    where: { status: "queued", updatedAt: { lt: cutoff } },
    select: { id: true, userId: true, projectId: true },
    take: 200,
  });
  let requeuedRuns = 0;
  for (const run of orphanedQueuedRuns) {
    const now = new Date();
    const claimed = await prisma.workflowRun.updateMany({
      where: { id: run.id, status: "queued", updatedAt: { lt: cutoff } },
      data: { heartbeatAt: now, updatedAt: now },
    });
    if (!claimed.count) continue;
    try {
      await enqueueWorkflowJob({
        runId: run.id,
        userId: run.userId,
        projectId: run.projectId,
        maxAttempts: 1,
      });
      requeuedRuns += 1;
    } catch {
      failedRuns += 1;
    }
  }

  const billing = await reconcilePendingMediaCharges();
  const { releaseExpiredModelRequestCharges } = await import("@/lib/billing/model-charge");
  await releaseExpiredModelRequestCharges();
  return {
    mediaTasks: staleTasks.length + queueTimedOutTasks,
    resumedMediaTasks,
    workflowRuns: recoveredRuns + failedRuns,
    recoveredRuns,
    failedRuns,
    requeuedRuns,
    billing,
  };
}

async function recoverExpiredWorkflowRun(
  runId: string,
  leaseCutoff: Date,
  heartbeatCutoff: Date,
) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.workflowRun.findUnique({
      where: { id: runId },
      include: { steps: { where: { status: "running" } } },
    });
    if (!run || run.status !== "running") return null;
    const exhausted = run.steps.some((step) => step.attempt >= step.maxAttempts);
    const now = new Date();
    const error = exhausted
      ? {
          code: "WORKFLOW_LEASE_EXPIRED",
          message: "工作流租约过期且步骤已达到重试上限。",
        }
      : {
          code: "WORKFLOW_LEASE_RECOVERED",
          message: "工作流租约过期，任务已重新排队。",
        };
    const updated = await tx.workflowRun.updateMany({
      where: {
        id: runId,
        status: "running",
        OR: [
          { leaseExpiresAt: { lt: leaseCutoff } },
          {
            leaseExpiresAt: null,
            heartbeatAt: { lt: heartbeatCutoff },
          },
          {
            leaseExpiresAt: null,
            heartbeatAt: null,
            updatedAt: { lt: heartbeatCutoff },
          },
        ],
      },
      data: exhausted
        ? {
            status: "failed",
            error,
            completedAt: now,
            activeDedupeKey: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: now,
            updatedAt: now,
          }
        : {
            status: "queued",
            error: Prisma.DbNull,
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: now,
            updatedAt: now,
          },
    });
    if (!updated.count) return null;
    const stepIds = run.steps.map((step) => step.id);
    if (stepIds.length) {
      await tx.workflowStep.updateMany({
        where: { id: { in: stepIds }, status: "running" },
        data: exhausted
          ? { status: "failed", error, completedAt: now, updatedAt: now }
          : {
              status: "pending",
              error: Prisma.DbNull,
              completedAt: null,
              updatedAt: now,
            },
      });
      await tx.workflowStepAttempt.updateMany({
        where: { stepId: { in: stepIds }, status: "running" },
        data: {
          status: "failed",
          errorCode: error.code,
          errorMessage: error.message,
          finishedAt: now,
          updatedAt: now,
        },
      });
    }
    await tx.workflowEvent.create({
      data: {
        runId,
        type: exhausted ? "failed" : "recovered",
        status: exhausted ? "failed" : "queued",
        message: error.message,
        payload: error,
      },
    });
    return exhausted ? "failed" : "queued";
  });
}

async function failTimedOutCancellation(runId: string, cancelCutoff: Date) {
  const now = new Date();
  const error = {
    code: "WORKFLOW_CANCEL_TIMEOUT",
    message: "工作流取消请求超时。",
  };
  return prisma.$transaction(async (tx) => {
    const updated = await tx.workflowRun.updateMany({
      where: {
        id: runId,
        status: "canceling",
        cancelRequestedAt: { lt: cancelCutoff },
      },
      data: {
        status: "failed",
        error,
        completedAt: now,
        activeDedupeKey: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: now,
        updatedAt: now,
      },
    });
    if (!updated.count) return null;
    await tx.workflowStep.updateMany({
      where: { runId, status: "running" },
      data: { status: "failed", error, completedAt: now, updatedAt: now },
    });
    await tx.workflowStepAttempt.updateMany({
      where: { runId, status: "running" },
      data: {
        status: "failed",
        errorCode: error.code,
        errorMessage: error.message,
        finishedAt: now,
        updatedAt: now,
      },
    });
    await tx.workflowEvent.create({
      data: {
        runId,
        type: "failed",
        status: "failed",
        message: error.message,
        payload: error,
      },
    });
    return "failed";
  });
}

export function startWorkWatchdog() {
  const intervalMs = numberEnv(
    "TASK_WATCHDOG_INTERVAL_MS",
    DEFAULT_INTERVAL_MS,
  );
  const timer = setInterval(() => {
    void reconcileStaleWork().catch((error) => {
      console.error("[watchdog] reconcile failed", error);
    });
  }, intervalMs);
  timer.unref?.();
  void reconcileStaleWork().catch((error) => {
    console.error("[watchdog] initial reconcile failed", error);
  });
  return () => clearInterval(timer);
}
