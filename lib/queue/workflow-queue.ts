import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

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
export function enqueueWorkflowJob(job: WorkflowJob) {
  return getWorkflowQueue().add("workflow", job, {
    jobId: job.runId,
    attempts: Math.max(1, job.maxAttempts ?? 1),
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
}
