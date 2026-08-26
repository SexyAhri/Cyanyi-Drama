"use client";

import { useCallback, useEffect, useState } from "react";

import { createStudioEpisode, loadWorkspaceSnapshot } from "../api";
import type { WorkspaceSnapshot } from "../types";

export function useWorkspace(projectId: string) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(
    async (options?: { background?: boolean; signal?: AbortSignal }) => {
      if (options?.background) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      try {
        const result = await loadWorkspaceSnapshot(projectId, options?.signal);
        setSnapshot(result);
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
    },
    [projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

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
