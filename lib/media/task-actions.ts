import { randomUUID } from "node:crypto";

import { BillingError, reserveMediaTaskCharge, settleMediaTaskCharge } from "@/lib/billing/service";
import { cancelMediaJob, enqueueMediaJob } from "@/lib/queue/media-queue";
import { mediaTaskCancellationPolicy } from "./cancellation";

import { transitionMediaTask, type MediaTask } from "./task-contract";
import { createDatabaseMediaTaskStore } from "./task-store";

export class MediaTaskActionError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export async function deleteMediaTask(input: {
  projectId?: string;
  taskId: string;
  userId: string;
}) {
  const store = createDatabaseMediaTaskStore(input.userId);
  const task = await store.get(input.taskId);
  if (!task) throw new MediaTaskActionError("Media task not found.", 404);
  if (input.projectId && task.projectId !== input.projectId)
    throw new MediaTaskActionError("Media task not found.", 404);
  if (!["canceled", "failed"].includes(task.status))
    throw new MediaTaskActionError(
      "Only failed or canceled media tasks can be deleted.",
    );

  const deleted = await store.removeTerminal(task.id);
  if (!deleted)
    throw new MediaTaskActionError(
      "Task state changed. Refresh and try again.",
    );
}

export async function controlMediaTask(input: {
  action: "cancel" | "retry";
  projectId?: string;
  taskId: string;
  userId: string;
}) {
  const store = createDatabaseMediaTaskStore(input.userId);
  const task = await store.get(input.taskId);
  if (!task) throw new MediaTaskActionError("Media task not found.", 404);
  if (input.projectId && task.projectId !== input.projectId)
    throw new MediaTaskActionError("Media task not found.", 404);

  if (input.action === "cancel") {
    const canceled = await store.requestCancel(task.id);
    if (!canceled)
      throw new MediaTaskActionError(
        "Task cannot be canceled in its current state.",
      );
    await cancelMediaJob(task.queueJobId ?? task.id).catch(() => undefined);
    const cancellationPolicy = mediaTaskCancellationPolicy(task);
    const cancellationNotice = cancellationPolicy.provider === "cancellation_unsupported"
      ? "Local execution is stopping. The provider does not support cancellation; late results will be discarded and provider charges may still apply."
      : "The task had not been submitted to the provider; local queue work was canceled.";
    await store.appendEvent({
      taskId: task.id,
      type: "progress",
      status: canceled.status,
      progress: canceled.progress,
      message: cancellationNotice,
      payload: { cancellationPolicy },
    });
    if (canceled.status === "canceled") {
      try {
        await settleMediaTaskCharge(input.userId, task.id, false);
      } catch (error) {
        await store.appendEvent({
          taskId: task.id,
          type: "billing_settlement_failed",
          status: "canceled",
          progress: canceled.progress,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      ...canceled,
      progressMessage: canceled.status === "running" ? cancellationNotice : canceled.progressMessage,
      cancellationPolicy,
    };
  }

  if (task.status !== "failed")
    throw new MediaTaskActionError("Only failed tasks can be retried.");

  let queued: MediaTask;
  try {
    queued = transitionMediaTask(task, { type: "retry" });
  } catch (error) {
    throw new MediaTaskActionError(
      error instanceof Error ? error.message : "Retry limit reached.",
    );
  }
  // BullMQ retains terminal jobs. Reusing the old ID returns that job without execution.
  queued = { ...queued, queueJobId: `${task.id}_retry_${randomUUID()}` };
  const claimed = await store.claimFailedTaskForRetry(queued, task.updatedAt);
  if (!claimed)
    throw new MediaTaskActionError(
      "Task state changed. Refresh and try again.",
    );
  let chargeReserved = false;
  try {
    const reusesSavedOutput = task.hasSavedProviderOutput === true
      || (Array.isArray(task.request.providerOutput) && task.request.providerOutput.length > 0);
    if (!reusesSavedOutput) chargeReserved = Boolean(await reserveMediaTaskCharge(input.userId, queued));
    await enqueueMediaJob({
      taskId: task.id,
      queueJobId: queued.queueJobId,
      userId: input.userId,
      projectId: task.projectId,
      episodeId: task.episodeId,
      priorityClass: "manual_retry",
      kind: task.kind,
      maxAttempts: 1,
    });
  } catch (error) {
    if (chargeReserved) await settleMediaTaskCharge(input.userId, task.id, false).catch(() => null);
    const now = new Date().toISOString();
    const billingError = error instanceof BillingError;
    await store.update({
      ...queued,
      status: "failed",
      error: {
        code: billingError ? error.message : "QUEUE_ENQUEUE_FAILED",
        message: error instanceof Error ? error.message : "Queue unavailable.",
        retryable: !billingError,
      },
      completedAt: now,
      updatedAt: now,
    });
    if (billingError) throw new MediaTaskActionError(error.message, error.status);
    throw error;
  }
  return queued;
}
