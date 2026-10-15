"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UsageRecordsPage } from "@/lib/billing/usage-records";

export function useUsageRecords(endpoint: string, query: string, apiType: string) {
  const [revision, setRevision] = useState(0);
  const filterKey = JSON.stringify([endpoint, query, apiType, revision]);
  const [pagination, setPagination] = useState({ key: filterKey, page: 1, pageSize: 10 });
  const page = pagination.key === filterKey ? pagination.page : 1;
  const pageSize = pagination.pageSize;
  const requestKey = JSON.stringify([filterKey, page, pageSize]);
  const snapshot = useRef<{ key: string; asOf: string } | null>(null);
  const [result, setResult] = useState<{ key: string; data?: UsageRecordsPage; error?: string }>({ key: "" });

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (query) params.set("query", query);
    if (apiType !== "all") params.set("apiType", apiType);
    if (snapshot.current?.key === filterKey) params.set("asOf", snapshot.current.asOf);
    void fetch(`${endpoint}?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok || !Array.isArray(payload.costs)) throw new Error(payload.message || `HTTP ${response.status}`);
        if (controller.signal.aborted) return;
        snapshot.current = { key: filterKey, asOf: payload.asOf };
        setResult({ key: requestKey, data: payload });
      })
      .catch(error => {
        if (!controller.signal.aborted) setResult({ key: requestKey, error: error instanceof Error ? error.message : "请求失败" });
      });
    return () => controller.abort();
  }, [apiType, endpoint, filterKey, page, pageSize, query, requestKey]);

  const onPageChange = useCallback((next: number) => setPagination(current => ({ ...current, key: filterKey, page: next })), [filterKey, setPagination]);
  const onPageSizeChange = useCallback((next: number) => setPagination(current => current.pageSize === next ? current : ({ key: filterKey, page: 1, pageSize: next })), [filterKey, setPagination]);
  const refresh = useCallback(() => setRevision(current => current + 1), []);
  const current = result.key === requestKey;
  return { data: current ? result.data : undefined, loading: !current, error: current ? result.error : undefined,
    page, pageSize, onPageChange, onPageSizeChange, refresh };
}
