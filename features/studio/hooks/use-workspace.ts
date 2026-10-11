"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createStudioEpisode, loadWorkspaceSnapshot, StudioApiError } from "../api";
import type { WorkspaceSnapshot } from "../types";
import { invalidateStudioCache, peekStudioCache, writeStudioCache } from "../request-cache";
import { getTaskOutputRevision, getAssetCatalogWorkflowRevision } from "../stage-state";

export function useWorkspace(projectId: string) {
  const cacheUrl = `/api/projects/${encodeURIComponent(projectId)}/data`;
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(() => peekStudioCache<WorkspaceSnapshot>(cacheUrl) ?? null);
  const latest = useRef(snapshot);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(() => !peekStudioCache(cacheUrl));
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
        else setIsLoading(!peekStudioCache(cacheUrl));
        setError(null);
        try {
          const result = await loadWorkspaceSnapshot(projectId, {
            signal: options?.signal,
            touch: !options?.background,
            fresh: options?.background,
          });
          if (!options?.signal?.aborted) {
            const previous = latest.current;
            if (previous?.project.id === projectId &&
              (getTaskOutputRevision(previous.tasks) !== getTaskOutputRevision(result.tasks) ||
                getAssetCatalogWorkflowRevision(previous.workflows) !== getAssetCatalogWorkflowRevision(result.workflows) ||
                previous.project.updatedAt !== result.project.updatedAt)) {
              invalidateStudioCache(`/api/projects/${encodeURIComponent(projectId)}`);
              writeStudioCache(cacheUrl, result);
            }
            latest.current = result;
            setSnapshot(result);
          }
          return result;
        } catch (requestError) {
          if (!options?.signal?.aborted) {
            if (requestError instanceof StudioApiError && [401, 403, 404].includes(requestError.status)) {
              latest.current = null;
              setSnapshot(null);
            }
            if (!latest.current || latest.current.project.id !== projectId) setError(
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
    [projectId, cacheUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    const cached = peekStudioCache<WorkspaceSnapshot>(cacheUrl) ?? null;
    latest.current = cached;
    setSnapshot(cached);
    setIsLoading(!cached);
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [load, cacheUrl]);

  const runtimeActive = snapshot ? hasActiveRuntime(snapshot) : false;
  useEffect(() => {
    if (runtimeActive) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void load({ background: true });
    };
    window.addEventListener("focus", onVisible);
    return () => window.removeEventListener("focus", onVisible);
  }, [load, runtimeActive]);
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

  const refresh = useCallback(() => {
    invalidateStudioCache(`/api/projects/${encodeURIComponent(projectId)}`);
    return load({ background: true });
  }, [load, projectId]);

  return {
    createEpisode,
    error,
    isLoading,
    isRefreshing,
    refresh,
    snapshot: snapshot?.project.id === projectId ? snapshot : null,
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
