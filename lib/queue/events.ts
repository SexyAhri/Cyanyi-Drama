import { QueueEvents } from "bullmq";

import { getRedisConnection } from "./connection";
import { MEDIA_QUEUE_NAME } from "./media-queue";

let events: QueueEvents | null = null;

export function getMediaQueueEvents() {
  events ??= new QueueEvents(MEDIA_QUEUE_NAME, { connection: getRedisConnection() });
  return events;
}
