"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { loadStudioModels } from "../api";
import type { StudioModelOption } from "../types";

export function useStudioModels() {
  const [models, setModels] = useState<StudioModelOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await loadStudioModels();
      if (!signal?.aborted) setModels(result);
    } catch (requestError) {
      if (!signal?.aborted) {
        setError(
          requestError instanceof Error ? requestError.message : "请求失败",
        );
      }
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const analysisModels = useMemo(
    () => models.filter((model) => model.type === "llm" || model.type === "text"),
    [models],
  );
  const imageModels = useMemo(
    () =>
      models.filter(
        (model) => model.type === "image" || model.modalities.includes("image"),
      ),
    [models],
  );

  return {
    analysisModels,
    error,
    imageModels,
    isLoading,
    models,
    refresh: () => load(),
  };
}
