import { enqueueMediaJob } from "@/lib/queue/media-queue";
import {
  BillingError,
  reserveMediaTaskCharge,
  settleMediaTaskCharge,
} from "@/lib/billing/service";
import { createDatabaseMediaTaskStore } from "./task-store";
import type { MediaTask } from "./task-contract";

/** Persists the queue id and turns enqueue failures into an actionable task failure. */
export async function enqueuePersistedMediaTask(
  userId: string,
  task: MediaTask,
) {
  const store = createDatabaseMediaTaskStore(userId);
  let chargeReserved = false;
  try {
    chargeReserved = !!(await reserveMediaTaskCharge(userId, task));
    const job = await enqueueMediaJob({
      taskId: task.id,
      userId,
      projectId: task.projectId,
      episodeId: task.episodeId,
      channelId: task.channelId,
      kind: task.kind,
      maxAttempts: task.maxRetries + 1,
    });
    const queued = { ...task, queueJobId: job.id };
    await store.update(queued);
    return queued;
  } catch (error) {
    if (chargeReserved)
      await settleMediaTaskCharge(userId, task.id, false).catch(() => null);
    const now = new Date().toISOString();
    const billingError = error instanceof BillingError;
    const failed: MediaTask = {
      ...task,
      status: "failed",
      error: {
        code: billingError
          ? error.message
          : "QUEUE_ENQUEUE_FAILED",
        message: error instanceof Error ? error.message : "Queue unavailable.",
        retryable: !billingError,
      },
      completedAt: now,
      updatedAt: now,
    };
    await store.update(failed);
    throw error;
  }
}
