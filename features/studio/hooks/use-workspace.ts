"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createStudioEpisode, loadWorkspaceSnapshot } from "../api";
import type { WorkspaceSnapshot } from "../types";

export function useWorkspace(projectId: string) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlightRef = useRef<{
    projectId: string;
    promise: Promise<WorkspaceSnapshot | null>;
    signal?: AbortSignal;
  } | null>(null);

  const load = useCallback(
    (options?: { background?: boolean; signal?: AbortSignal }) => {
      const currentRequest = inFlightRef.current;
      if (currentRequest && canReuseWorkspaceRequest(currentRequest, projectId))
        return currentRequest.promise;

      const promise = (async () => {
        if (options?.background) setIsRefreshing(true);
        else setIsLoading(true);
        setError(null);
        try {
          const result = await loadWorkspaceSnapshot(projectId, {
            signal: options?.signal,
            touch: !options?.background,
          });
          if (!options?.signal?.aborted) setSnapshot(result);
          return result;
        } catch (requestError) {
          if (!options?.signal?.aborted) {
            setError(
              requestError instanceof Error ? requestError.message : "请求失败",
            );
          }
          return null;
        } finally {
          if (!options?.signal?.aborted) {
            setIsLoading(false);
            setIsRefreshing(false);
          }
        }
      })();
      inFlightRef.current = { projectId, promise, signal: options?.signal };
      void promise.finally(() => {
        if (inFlightRef.current?.promise === promise) inFlightRef.current = null;
      });
      return promise;
    },
    [projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  const runtimeActive = snapshot ? hasActiveRuntime(snapshot) : false;
  useEffect(() => {
    if (!runtimeActive) return;
    let disposed = false;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (disposed) return;
        if (document.visibilityState === "visible")
          await load({ background: true });
        if (!disposed) schedule();
      }, 5_000);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible")
        void load({ background: true });
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [load, runtimeActive]);

  const createEpisode = useCallback(
    async (input: { name: string; novelText?: string }) => {
      const result = await createStudioEpisode(projectId, input);
      await load({ background: true });
      return result.episode;
    },
    [load, projectId],
  );

  return {
    createEpisode,
    error,
    isLoading,
    isRefreshing,
    refresh: () => load({ background: true }),
    snapshot,
  };
}

export function canReuseWorkspaceRequest(
  current: { projectId: string; signal?: AbortSignal } | null,
  projectId: string,
) {
  return current?.projectId === projectId && !current.signal?.aborted;
}

function hasActiveRuntime(snapshot: WorkspaceSnapshot) {
  return (
    snapshot.workflows.some((workflow) =>
      ["queued", "running", "canceling"].includes(workflow.status),
    ) ||
    snapshot.tasks.some((task) =>
      ["queued", "running"].includes(task.status),
    )
  );
}
