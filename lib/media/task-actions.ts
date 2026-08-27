import { settleMediaTaskCharge } from "@/lib/billing/service";
import { cancelMediaJob, enqueueMediaJob } from "@/lib/queue/media-queue";

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
    await cancelMediaJob(task.id).catch(() => undefined);
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
    return canceled;
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
  queued = { ...queued, queueJobId: undefined };
  await store.update(queued);
  const job = await enqueueMediaJob({
    taskId: task.id,
    userId: input.userId,
    projectId: task.projectId,
    episodeId: task.episodeId,
    kind: task.kind,
    maxAttempts: 1,
  });
  queued.queueJobId = job.id;
  await store.update(queued);
  return queued;
}
