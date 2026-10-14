import { Queue } from "bullmq";

import { getRedisConnection } from "./connection";
import { releaseMediaQueuePriority, reserveMediaQueuePriority, type MediaQueuePriorityClass } from "./media-fairness";

export const MEDIA_QUEUE_NAME = "cyanyi-media";

export type MediaJob = {
  taskId: string;
  queueJobId?: string;
  userId: string;
  projectId?: string;
  episodeId?: string;
  channelId?: string;
  priorityClass?: MediaQueuePriorityClass;
  kind: "image" | "video" | "audio" | "lipsync" | "voicedesign";
  maxAttempts?: number;
};

let queue: Queue<MediaJob> | null = null;

export function getMediaQueue() {
  queue ??= new Queue<MediaJob>(MEDIA_QUEUE_NAME, {
    connection: getRedisConnection(),
  });
  return queue;
}

export async function enqueueMediaJob(job: MediaJob) {
  const queue = getMediaQueue();
  const jobId = job.queueJobId ?? job.taskId;
  const existing = await queue.getJob(jobId);
  if (existing) return existing;
  const priority = await reserveMediaQueuePriority({
    jobId,
    projectId: job.projectId,
    priorityClass: job.priorityClass,
  });
  try {
    return await queue.add(job.kind, job, {
      jobId,
      priority,
      attempts: Math.max(1, job.maxAttempts ?? 1),
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  } catch (error) {
    await releaseMediaQueuePriority({ jobId }).catch(() => false);
    throw error;
  }
}

export async function cancelMediaJob(taskId: string) {
  const job = await getMediaQueue().getJob(taskId);
  if (!job) return false;
  await job.remove();
  await releaseMediaQueuePriority({ jobId: job.id ?? taskId }).catch(() => false);
  return true;
}
