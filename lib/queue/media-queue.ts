import { Queue } from "bullmq";

import { getRedisConnection } from "./connection";

export const MEDIA_QUEUE_NAME = "cyanyi-media";

export type MediaJob = {
  taskId: string;
  userId: string;
  projectId?: string;
  episodeId?: string;
  kind: "image" | "video" | "audio" | "lipsync" | "voicedesign";
};

let queue: Queue<MediaJob> | null = null;

export function getMediaQueue() {
  queue ??= new Queue<MediaJob>(MEDIA_QUEUE_NAME, { connection: getRedisConnection() });
  return queue;
}

export async function enqueueMediaJob(job: MediaJob) {
  return getMediaQueue().add(job.kind, job, { jobId: job.taskId, removeOnComplete: 1000, removeOnFail: 1000 });
}
