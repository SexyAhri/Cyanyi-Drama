import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";
import { prisma } from "@/lib/server/prisma";

export const WORKFLOW_QUEUE_NAME = "cyanyi-workflow";
export type WorkflowJob = {
  runId: string;
  userId: string;
  projectId: string;
  maxAttempts?: number;
};
let queue: Queue<WorkflowJob> | null = null;
export function getWorkflowQueue() {
  queue ??= new Queue<WorkflowJob>(WORKFLOW_QUEUE_NAME, {
    connection: getRedisConnection(),
  });
  return queue;
}
export async function enqueueWorkflowJob(job: WorkflowJob) {
  try {
    return await getWorkflowQueue().add("workflow", job, {
      jobId: job.runId,
      attempts: Math.max(1, job.maxAttempts ?? 1),
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Queue unavailable.";
    const now = new Date();
    const updated = await prisma.workflowRun.updateMany({
      where: {
        id: job.runId,
        userId: job.userId,
        status: { in: ["queued", "running"] },
      },
      data: {
        status: "failed",
        error: { code: "QUEUE_ENQUEUE_FAILED", message },
        completedAt: now,
        updatedAt: now,
      },
    });
    if (updated.count) {
      await prisma.workflowEvent.create({
        data: {
          runId: job.runId,
          type: "failed",
          status: "failed",
          message,
          payload: { code: "QUEUE_ENQUEUE_FAILED" },
        },
      });
    }
    throw error;
  }
}
