"use client";

import { useCallback, useEffect, useState } from "react";

import { createStudioProject, listStudioProjects } from "../api";
import type { ProjectListResponse } from "../types";

export function useProjects(search: string) {
  const [data, setData] = useState<ProjectListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);

  const reload = useCallback(() => {
    setRequestVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await listStudioProjects(search, controller.signal);
        setData(result);
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(
            requestError instanceof Error ? requestError.message : "请求失败",
          );
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [requestVersion, search]);

  const createProject = useCallback(
    async (input: { name: string; description?: string }) => {
      const result = await createStudioProject(input);
      reload();
      return result.project;
    },
    [reload],
  );

  return {
    createProject,
    data,
    error,
    isLoading,
    reload,
  };
}
