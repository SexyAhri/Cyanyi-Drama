import { Queue } from "bullmq";

import { getRedisConnection } from "./connection";

export const MEDIA_QUEUE_NAME = "cyanyi-media";

export type MediaJob = {
  taskId: string;
  userId: string;
  projectId?: string;
  episodeId?: string;
  channelId?: string;
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
  return getMediaQueue().add(job.kind, job, {
    jobId: job.taskId,
    attempts: Math.max(1, job.maxAttempts ?? 1),
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
}

export async function cancelMediaJob(taskId: string) {
  const job = await getMediaQueue().getJob(taskId);
  if (!job) return false;
  await job.remove();
  return true;
}
