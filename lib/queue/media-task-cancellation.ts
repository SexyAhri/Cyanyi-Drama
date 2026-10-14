import { settleMediaTaskCharge } from "@/lib/billing/service";
import { mediaTaskCancellationPolicy } from "@/lib/media/cancellation";
import { prisma } from "@/lib/server/prisma";

export async function finalizeMediaTaskCancellation(taskId: string, userId: string) {
  const task = await prisma.mediaTask.findFirst({
    where: { id: taskId, userId },
    select: { status: true, progress: true, cancelRequestedAt: true, providerTaskId: true, executionPhase: true },
  });
  if (!task || (task.status !== "canceled" && !task.cancelRequestedAt)) return false;

  const now = new Date();
  const updated = await prisma.mediaTask.updateMany({
    where: {
      id: taskId,
      userId,
      status: { in: ["queued", "running"] },
      cancelRequestedAt: { not: null },
    },
    data: {
      status: "canceled",
      executionPhase: "canceled",
      completedAt: now,
      updatedAt: now,
      progressMessage: null,
    },
  });
  if (updated.count) {
    const cancellationPolicy = mediaTaskCancellationPolicy(task);
    await prisma.mediaTaskEvent.create({
      data: {
        taskId,
        type: "canceled",
        status: "canceled",
        progress: task.progress,
        executionPhase: "canceled",
        message: cancellationPolicy.provider === "cancellation_unsupported"
          ? "Local task canceled. The provider job may continue; late results are discarded and provider charges may still apply."
          : "Task canceled before submission to the provider.",
        payload: { cancellationPolicy },
      },
    });
  }
  try {
    await settleMediaTaskCharge(userId, taskId, false);
  } catch (error) {
    await prisma.mediaTaskEvent.create({
      data: {
        taskId,
        type: "billing_settlement_failed",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
  return true;
}
