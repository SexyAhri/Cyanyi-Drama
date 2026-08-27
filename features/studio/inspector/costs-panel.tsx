"use client";

import { LoaderCircle, ReceiptText, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { loadStudioBilling } from "../api";
import { formatStudioDate } from "../i18n";
import type { StudioBalance, StudioLocale, StudioUsageCost } from "../types";
import { summarizeUsageCosts } from "./inspector-view-model";

const copy = {
  "zh-CN": {
    available: "可用余额",
    empty: "当前项目还没有费用记录",
    frozen: "冻结",
    loadFailed: "费用数据载入失败",
    loading: "正在载入费用数据",
    projectCost: "项目费用",
    retry: "重试",
    units: "计费用量",
  },
  en: {
    available: "Available",
    empty: "No usage costs for this project",
    frozen: "Frozen",
    loadFailed: "Unable to load billing data",
    loading: "Loading billing data",
    projectCost: "Project cost",
    retry: "Retry",
    units: "Billable units",
  },
} as const;

export function CostsPanel({
  locale,
  projectId,
}: {
  locale: StudioLocale;
  projectId: string;
}) {
  const text = copy[locale];
  const [balance, setBalance] = useState<StudioBalance | null>(null);
  const [costs, setCosts] = useState<StudioUsageCost[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError("");
      setLoading(true);
      try {
        const result = await loadStudioBilling(projectId, signal);
        if (!signal?.aborted) {
          setBalance(result.balance);
          setCosts(result.costs);
        }
      } catch (requestError) {
        if (!signal?.aborted)
          setError(
            requestError instanceof Error
              ? requestError.message
              : text.loadFailed,
          );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [projectId, text.loadFailed],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loading && !balance)
    return (
      <div
        className="flex h-full items-center justify-center text-muted-foreground"
        role="status"
      >
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
        <span className="sr-only">{text.loading}</span>
      </div>
    );
  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
        <Button onClick={() => void load()} size="sm" variant="outline">
          <RotateCcw className="size-4" />
          {text.retry}
        </Button>
      </div>
    );

  const summary = summarizeUsageCosts(costs);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-3 border-b text-center">
        <Metric
          label={text.available}
          value={formatAmount(balance?.available)}
        />
        <Metric
          label={text.frozen}
          value={formatAmount(balance?.frozenAmount)}
        />
        <Metric label={text.projectCost} value={formatAmount(summary.total)} />
      </div>
      <div className="flex h-10 shrink-0 items-center border-b px-3 text-xs text-muted-foreground">
        <span>{text.units}</span>
        <span className="ml-auto font-mono">{summary.quantity}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {costs.length ? (
          <div className="divide-y">
            {costs.map((cost) => (
              <div className="px-3 py-3" key={cost.id}>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/30">
                    <ReceiptText className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 truncate text-xs font-medium">
                        {cost.action}
                      </p>
                      <span className="font-mono text-xs font-semibold">
                        {formatAmount(cost.cost)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {cost.model} · {cost.quantity} {cost.unit}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground/75">
                      {formatStudioDate(locale, cost.createdAt)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <ReceiptText className="size-5" />
            <p>{text.empty}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-r px-2 py-3 last:border-r-0">
      <p className="truncate font-mono text-sm font-semibold">{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function formatAmount(value: number | string | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "0";
  return amount.toFixed(6).replace(/\.?0+$/, "");
}
