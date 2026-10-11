"use client";
import { useSyncExternalStore } from "react";
import { studioCacheRevision, subscribeStudioCache } from "../request-cache";
const serverRevision = () => 0;
export function useStudioCacheRevision() {
  return useSyncExternalStore(subscribeStudioCache, studioCacheRevision, serverRevision);
}
