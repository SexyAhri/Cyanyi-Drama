"use client";

import { useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { billingActionLabel, billingUnitLabel } from "@/lib/billing/display";
import { formatUsageTime, type UsageRecord } from "@/lib/billing/usage-records";
import { useUsageRecords } from "./use-usage-records";

const copy = {
  "zh-CN": {
    title: "模型使用日志", search: "搜索模型使用日志", placeholder: "搜索项目、模型或动作", adminPlaceholder: "搜索用户、项目、模型或动作",
    type: "模型类型", all: "全部类型", query: "查询", refresh: "刷新", count: "匹配记录", cost: "累计费用",
    time: "时间（本地）", user: "用户名 / 项目", model: "模型名称", action: "动作", input: "输入 Token", output: "输出 Token",
    cache: "缓存读取 Token", cacheWrite: "缓存写入", quantity: "用量", fee: "费用", empty: "暂无匹配的模型使用记录",
    failed: "模型使用日志加载失败", independent: "独立对话", personal: "查看当前账户已结算的模型使用明细和实际扣费。", note: "输入 Token 包含缓存部分；— 表示未记录。费用为应用实际扣费。",
  },
  en: {
    title: "Model usage logs", search: "Search model usage logs", placeholder: "Search project, model or action", adminPlaceholder: "Search user, project, model or action",
    type: "Model type", all: "All types", query: "Search", refresh: "Refresh", count: "Matching records", cost: "Total cost",
    time: "Time (local)", user: "User / project", model: "Model name", action: "Action", input: "Input tokens", output: "Output tokens",
    cache: "Cache read tokens", cacheWrite: "Cache write", quantity: "Usage", fee: "Cost", empty: "No matching model usage records",
    failed: "Could not load model usage logs", independent: "Standalone chat", personal: "Review your account’s settled model usage and actual charges.", note: "Input tokens include cached tokens; — means not recorded. Costs are actual application charges.",
  },
};

export function UsageRecordsPanel({ admin = false, locale = "zh-CN" }: { admin?: boolean; locale?: "zh-CN" | "en" }) {
  const text = copy[locale];
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [apiType, setApiType] = useState("all");
  const usage = useUsageRecords(admin ? "/api/admin/usage" : "/api/user/usage", query, apiType);
  const payload = usage.data;

  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
    {!admin ? <header className="shrink-0"><h3 className="text-base font-semibold">{text.title}</h3><p className="mt-1 text-xs text-muted-foreground">{text.personal}</p></header> : null}
    <form className="flex shrink-0 flex-wrap gap-2" onSubmit={event => { event.preventDefault(); setQuery(draftQuery.trim()); }}>
      <div className="relative min-w-40 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label={text.search} className="pl-9" value={draftQuery} onChange={event => setDraftQuery(event.target.value)} placeholder={admin ? text.adminPlaceholder : text.placeholder} />
      </div>
      <Select value={apiType} onValueChange={value => value && setApiType(value)}>
        <SelectTrigger aria-label={text.type} className="w-36"><SelectValue>{apiType === "all" ? text.all : usageTypeLabel(apiType, locale)}</SelectValue></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{text.all}</SelectItem>
          {[...new Set([...(payload?.filters.apiTypes ?? []), ...(apiType !== "all" ? [apiType] : [])])].map(type => <SelectItem key={type} value={type}>{usageTypeLabel(type, locale)}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="submit">{text.query}</Button>
      <Button aria-label={text.refresh} title={text.refresh} disabled={usage.loading} type="button" variant="outline" size="icon" onClick={usage.refresh}><RefreshCw className={usage.loading ? "animate-spin" : undefined} /></Button>
    </form>
    <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-y py-2 text-xs text-muted-foreground">
      <p>{text.count} <strong className="ml-2 text-sm tabular-nums text-foreground">{payload?.summary.count ?? "—"}</strong></p>
      <p>{text.cost} <strong className="ml-2 text-sm tabular-nums text-foreground">{payload ? `¥ ${payload.summary.cost}` : "—"}</strong></p>
      <p className="text-[11px]">{text.note}</p>
    </div>
    {usage.error ? <Alert variant="destructive" className="shrink-0"><AlertDescription>{text.failed}：{usage.error}</AlertDescription></Alert> : null}
    <DataTable label={text.title} locale={locale} headers={[text.time, text.user, text.model, text.action, text.input, text.output, text.cache, text.fee]}
      empty={usage.error ? text.failed : text.empty} loading={usage.loading} className="min-w-[960px] [&_th]:text-xs [&_td]:text-xs" pagination={{
        page: payload?.page ?? usage.page, pageSize: usage.pageSize, total: payload?.summary.count ?? 0,
        onPageChange: usage.onPageChange, onPageSizeChange: usage.onPageSizeChange,
      }}>
      {payload?.costs.map(record => <UsageRecordRow key={record.id} record={record} locale={locale} />)}
    </DataTable>
  </div>;
}

export function UsageRecordRow({ record, locale = "zh-CN" }: { record: UsageRecord; locale?: "zh-CN" | "en" }) {
  const text = copy[locale];
  const token = (value: number | null) => value === null ? "—" : value.toLocaleString(locale);
  return <TableRow>
    <TableCell className="text-xs text-muted-foreground"><time dateTime={record.createdAt}>{formatUsageTime(record.createdAt, locale)}</time></TableCell>
    <TableCell><p className="max-w-36 truncate font-medium" title={record.user.displayName}>{record.user.displayName}</p><p className="max-w-36 truncate text-xs text-muted-foreground" title={record.project?.name}>{record.project?.name ?? text.independent}</p></TableCell>
    <TableCell><p className="max-w-32 truncate font-medium" title={record.model}>{record.model}</p><p className="text-xs text-muted-foreground">{usageTypeLabel(record.apiType, locale)}{record.unit !== "tokens" ? ` · ${record.quantity.toLocaleString(locale)} ${billingUnitLabel(record.unit, locale)}` : ""}</p></TableCell>
    <TableCell className="max-w-32 truncate" title={record.action}>{billingActionLabel(record.action, locale)}</TableCell>
    <TableCell className="font-mono tabular-nums">{token(record.tokens.input)}</TableCell>
    <TableCell className="font-mono tabular-nums">{token(record.tokens.output)}</TableCell>
    <TableCell className="font-mono tabular-nums">{token(record.tokens.cacheRead)}{record.tokens.cacheWrite !== null && record.tokens.cacheWrite > 0 ? <p className="mt-1 text-xs text-muted-foreground">{text.cacheWrite} {token(record.tokens.cacheWrite)}</p> : null}</TableCell>
    <TableCell className="min-w-16 font-mono tabular-nums">¥ {record.cost}</TableCell>
  </TableRow>;
}

function usageTypeLabel(value: string, locale: "zh-CN" | "en") {
  if (locale === "en") return ({ text: "Text", image: "Image", video: "Video", audio: "Audio", lipsync: "Lip sync", voicedesign: "Voice design" } as Record<string, string>)[value] ?? value;
  return ({ text: "文本", image: "图片", video: "视频", audio: "配音", lipsync: "口型同步", voicedesign: "音色设计" } as Record<string, string>)[value] ?? value;
}
