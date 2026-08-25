import { prisma } from "@/lib/server/prisma";

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Marks worker jobs that stopped heartbeating as failed so they can be retried explicitly. */
export async function reconcileStaleWork() {
  const cutoff = new Date(
    Date.now() - numberEnv("TASK_HEARTBEAT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
  );
  const staleTasks = await prisma.mediaTask.findMany({
    where: {
      status: "running",
      heartbeatAt: { lt: cutoff },
    },
    select: { id: true, userId: true, progress: true },
    take: 200,
  });
  for (const task of staleTasks) {
    const error = {
      code: "WORKER_HEARTBEAT_TIMEOUT",
      message: "媒体任务 worker 心跳超时，请重试任务。",
      retryable: true,
    };
    const updated = await prisma.mediaTask.updateMany({
      where: { id: task.id, status: "running", heartbeatAt: { lt: cutoff } },
      data: {
        status: "failed",
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
          message: error.message,
          payload: error,
        },
      });
    }
  }

  const staleRuns = await prisma.workflowRun.findMany({
    where: {
      status: "running",
      heartbeatAt: { lt: cutoff },
    },
    select: { id: true },
    take: 200,
  });
  for (const run of staleRuns) {
    const error = {
      code: "WORKFLOW_HEARTBEAT_TIMEOUT",
      message: "工作流 worker 心跳超时，请重试工作流。",
    };
    const updated = await prisma.workflowRun.updateMany({
      where: { id: run.id, status: "running", heartbeatAt: { lt: cutoff } },
      data: {
        status: "failed",
        error,
        completedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    if (updated.count) {
      await prisma.workflowEvent.create({
        data: {
          runId: run.id,
          type: "failed",
          status: "failed",
          message: error.message,
          payload: error,
        },
      });
    }
  }

  return { mediaTasks: staleTasks.length, workflowRuns: staleRuns.length };
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
