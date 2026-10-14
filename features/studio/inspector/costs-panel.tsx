"use client";

import { BarChart3, LoaderCircle, ReceiptText, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { billingUnitLabel, billingActionLabel } from "@/lib/billing/display";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { loadStudioBilling, loadStudioCostPage } from "../api";
import { formatStudioDate } from "../i18n";
import type { StudioBalance, StudioLocale, StudioProjectModelMetrics, StudioUsageCost, StudioUsageCostSummary } from "../types";

const PAGE_SIZE = 20;
const copy = {
  "zh-CN": {
    available: "可用余额", empty: "当前项目还没有费用记录", frozen: "冻结", loadFailed: "费用数据载入失败", loading: "正在载入费用数据",
    projectCost: "项目累计费用", modelStats: "模型运行统计", modelStatsDescription: "按最近 {days} 天的真实任务和执行记录汇总。",
    model: "模型 / 渠道", executionKind: "类型", successTable: "成功率", durationTable: "平均耗时 · 样本", rateLimitTable: "限流", canceledTable: "取消", costTable: "记录费用", cacheTable: "缓存复用",
    metricAttempts: "请求次数", metricSuccess: "成功率", metricCanceled: "已取消", metricDuration: "平均耗时", metricRateLimit: "限流",
    metricMediaCost: "已记录费用", metricCache: "缓存复用", conversation: "对话 / Agent", media: "媒体", workflow: "工作流", sampled: "仅汇总最近 5,000 条执行记录；成功率分母排除取消请求。",
    recordedCostHelp: "新请求按后台模型价格和实际计量扣余额；旧估算记录保留并标注，不补扣历史余额。",
    noSavings: "缓存节省金额未估算，因为没有可靠的反事实价格。", noStats: "此时间范围内没有模型请求记录", retry: "重试", units: "计费用量",
    ledger: "计费记录", recordCount: "共 {count} 条", loadMore: "加载更多", loadingMore: "正在加载…", allLoaded: "已显示全部记录", statsUnavailable: "统计暂不可用",
  },
  en: {
    available: "Available balance", empty: "No usage costs for this project", frozen: "Frozen", loadFailed: "Unable to load billing data", loading: "Loading billing data",
    projectCost: "Project total", modelStats: "Model usage statistics", modelStatsDescription: "Summarized from real tasks and execution records in the last {days} days.",
    model: "Model / channel", executionKind: "Type", successTable: "Success rate", durationTable: "Avg duration · samples", rateLimitTable: "Rate limited", canceledTable: "Canceled", costTable: "Recorded cost", cacheTable: "Cache reuse",
    metricAttempts: "Requests", metricSuccess: "Success rate", metricCanceled: "Canceled", metricDuration: "Average duration", metricRateLimit: "Rate limited",
    metricMediaCost: "Recorded cost", metricCache: "Cache reuse", conversation: "Chat / Agent", media: "Media", workflow: "Workflow", sampled: "Summarizes the latest 5,000 execution records; canceled requests are excluded from the success-rate denominator.",
    recordedCostHelp: "New requests charge the balance using configured model prices and measured usage. Historical estimates remain labeled and are not charged retroactively.",
    noSavings: "Cache savings are not estimated because no reliable counterfactual price is available.", noStats: "No model requests in this time range", retry: "Retry", units: "Billable units",
    ledger: "Billing records", recordCount: "{count} records", loadMore: "Load more", loadingMore: "Loading…", allLoaded: "All records shown", statsUnavailable: "Statistics unavailable",
  },
} as const;

export function CostsPanel({ locale, projectId }: { locale: StudioLocale; projectId: string }) {
  const text = copy[locale];
  const [balance, setBalance] = useState<StudioBalance | null>(null);
  const [costs, setCosts] = useState<StudioUsageCost[]>([]);
  const [summary, setSummary] = useState<StudioUsageCostSummary>({ total: "0", quantity: 0, count: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<StudioProjectModelMetrics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    setLoading(true);
    try {
      const result = await loadStudioBilling(projectId, signal, { limit: PAGE_SIZE });
      if (!signal?.aborted) {
        setBalance(result.balance);
        setCosts(result.costs);
        setSummary(result.costSummary);
        setNextCursor(result.nextCursor);
        setMetrics(result.metrics);
      }
    } catch (requestError) {
      if (!signal?.aborted) setError(requestError instanceof Error ? requestError.message : text.loadFailed);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [projectId, text.loadFailed]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await loadStudioCostPage(projectId, { limit: PAGE_SIZE, cursor: nextCursor });
      setCosts((current) => {
        const ids = new Set(current.map((item) => item.id));
        return [...current, ...page.costs.filter((item) => !ids.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : text.loadFailed);
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading && !balance) return <div className="flex h-full items-center justify-center text-muted-foreground" role="status"><LoaderCircle aria-hidden="true" className="size-5 animate-spin" /><span className="sr-only">{text.loading}</span></div>;
  if (error && !balance) return <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"><p className="text-sm text-destructive" role="alert">{error}</p><Button onClick={() => void load()} size="sm" variant="outline"><RotateCcw className="size-4" />{text.retry}</Button></div>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-3 border-b text-center">
        <Metric label={text.available} value={formatAmount(balance?.available)} />
        <Metric label={text.frozen} value={formatAmount(balance?.frozenAmount)} />
        <Metric label={text.projectCost} value={formatAmount(summary.total)} />
      </div>
      <div className="flex h-10 shrink-0 items-center border-b px-3 text-xs text-muted-foreground"><span>{text.units}</span><span className="ml-auto font-mono">{summary.quantity.toLocaleString()}</span></div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2.5">
        <div className="min-w-0"><h3 className="text-xs font-semibold">{text.ledger}</h3><p className="mt-0.5 text-[10px] text-muted-foreground">{text.recordCount.replace("{count}", summary.count.toLocaleString())}</p></div>
        <ModelMetricsDialog locale={locale} metrics={metrics} />
      </div>
      {error ? <p className="shrink-0 px-3 py-2 text-xs text-destructive" role="alert">{error}</p> : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {costs.length ? <div className="divide-y">{costs.map((cost) => (
          <div className="px-3 py-3" key={cost.id}>
            <div className="flex items-start gap-3"><span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/30"><ReceiptText className="size-3.5" /></span>
              <div className="min-w-0 flex-1"><div className="flex items-start gap-2"><p className="min-w-0 flex-1 truncate text-xs font-medium" title={usageCostActionLabel(cost.action, locale)}>{usageCostActionLabel(cost.action, locale)}</p><span className="shrink-0 font-mono text-xs font-semibold">{formatAmount(cost.cost)}</span></div>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">{cost.model} · {cost.quantity} {billingUnitLabel(cost.unit, locale)}</p><p className="mt-1 text-[10px] text-muted-foreground/75">{formatStudioDate(locale, cost.createdAt)}</p>
              </div>
            </div>
          </div>
        ))}</div> : <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground"><ReceiptText className="size-5" /><p>{text.empty}</p></div>}
        <div className="flex flex-col items-center gap-2 p-3">
          {nextCursor ? <Button className="w-full" disabled={loadingMore} onClick={() => void loadMore()} size="sm" variant="outline">{loadingMore ? <><LoaderCircle className="size-4 animate-spin" />{text.loadingMore}</> : text.loadMore}</Button> : costs.length ? <p className="py-1 text-[10px] text-muted-foreground">{text.allLoaded}</p> : null}
        </div>
      </div>
    </div>
  );
}

function ModelMetricsDialog({ locale, metrics }: { locale: StudioLocale; metrics: StudioProjectModelMetrics | null }) {
  const text = copy[locale];
  const rows = metrics?.rows ?? [];
  return (
    <Dialog>
      <DialogTrigger render={<Button className="shrink-0" size="sm" variant="outline" />}><BarChart3 className="size-3.5" />{text.modelStats}</DialogTrigger>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-[1100px]">
        <DialogHeader><DialogTitle>{text.modelStats}</DialogTitle><DialogDescription>{text.modelStatsDescription.replace("{days}", String(metrics?.windowDays ?? 30))}</DialogDescription></DialogHeader>
        {metrics?.sampled ? <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">{text.sampled}</p> : null}
        {rows.length ? <ModelMetricsTable locale={locale} rows={rows} /> : <p className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">{text.noStats}</p>}
        <p className="text-xs text-muted-foreground">{text.noSavings}</p>
        <p className="text-xs text-muted-foreground">{text.recordedCostHelp}</p>
      </DialogContent>
    </Dialog>
  );
}

export function ModelMetricsTable({ locale, rows }: { locale: StudioLocale; rows: StudioProjectModelMetrics["rows"] }) {
  const text = copy[locale];
  return <div className="max-w-full overflow-x-auto rounded-lg border">
    <table className="w-full min-w-[1050px] border-collapse text-left text-xs">
      <thead className="sticky top-0 bg-muted/80 text-muted-foreground backdrop-blur"><tr>
        <th className="px-3 py-3 font-medium">{text.model}</th><th className="px-3 py-3 font-medium">{text.executionKind}</th>
        <th className="px-3 py-3 text-right font-medium">{text.metricAttempts}</th><th className="px-3 py-3 text-right font-medium">{text.successTable}</th>
        <th className="px-3 py-3 text-right font-medium">{text.durationTable}</th><th className="px-3 py-3 text-right font-medium">{text.rateLimitTable}</th>
        <th className="px-3 py-3 text-right font-medium">{text.canceledTable}</th><th className="px-3 py-3 text-right font-medium">{text.costTable}</th>
        <th className="px-3 py-3 text-right font-medium">{text.cacheTable}</th>
      </tr></thead>
      <tbody className="divide-y">{rows.map((row) => <tr className="hover:bg-muted/30" key={`${row.executionKind}:${row.channelId ?? "unknown"}:${row.model}`}>
        <th scope="row" className="max-w-56 px-3 py-3 font-medium"><span className="block break-all text-foreground">{row.model}</span><span className="mt-1 block break-all font-normal text-muted-foreground">{row.channel}</span></th>
        <td className="px-3 py-3 text-muted-foreground">{row.executionKind === "media" ? text.media : row.executionKind === "conversation" ? text.conversation : text.workflow}</td>
        <td className="px-3 py-3 text-right font-mono tabular-nums">{row.attempts.toLocaleString()}</td>
        <td className="px-3 py-3 text-right font-mono tabular-nums">{row.successRate === null ? "—" : `${(row.successRate * 100).toFixed(1)}% (${row.succeeded}/${row.succeeded + row.failed})`}</td>
        <td className="px-3 py-3 text-right font-mono tabular-nums">{formatDuration(row.averageDurationMs)} · {row.durationSamples}</td>
        <td className="px-3 py-3 text-right font-mono tabular-nums">{row.rateLimited}</td><td className="px-3 py-3 text-right font-mono tabular-nums">{row.canceled}</td>
        <td className="px-3 py-3 text-right font-mono tabular-nums">{row.recordedCost ?? "—"}</td><td className="px-3 py-3 text-right font-mono tabular-nums">{row.cachedRequestsReused}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function formatDuration(value: number | null) { if (value === null) return "—"; if (value < 1_000) return `${value} ms`; return `${(value / 1_000).toFixed(1)} s`; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="min-w-0 border-r px-2 py-3 last:border-r-0"><p className="truncate font-mono text-sm font-semibold">{value}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{label}</p></div>; }
function formatAmount(value: number | string | undefined) { const amount = Number(value ?? 0); if (!Number.isFinite(amount)) return "0"; return amount.toFixed(6).replace(/\.?0+$/, ""); }

export function usageCostActionLabel(action: string, locale: StudioLocale) {
  return billingActionLabel(action, locale);
}
