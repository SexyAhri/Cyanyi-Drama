"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

import { billingActionLabel } from "@/lib/billing/display";
import { AdminPage } from "@/components/admin/admin-page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type UsageCost = {
  id: string;
  apiType: string;
  model: string;
  action: string;
  quantity: number;
  unit: string;
  cost: string;
  createdAt: string;
  project: { id: string; name: string } | null;
  user: { id: string; displayName: string; email: string | null };
};

type UsagePayload = {
  costs: UsageCost[];
  filters: { apiTypes: string[] };
  summary: { count: number; cost: string };
};

export function UsagePage() {
  const [payload, setPayload] = useState<UsagePayload | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [apiType, setApiType] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "300" });
      if (appliedQuery) params.set("query", appliedQuery);
      if (apiType !== "all") params.set("apiType", apiType);
      const response = await fetch(`/api/admin/usage?${params}`, {
        cache: "no-store",
      });
      const next = (await response.json().catch(() => ({}))) as
        | UsagePayload
        | { message?: string };
      if (!response.ok || !("costs" in next)) {
        throw new Error("message" in next ? next.message : "使用日志加载失败");
      }
      setPayload(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "使用日志加载失败");
    } finally {
      setLoading(false);
    }
  }, [apiType, appliedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminPage
      actions={
        <Button disabled={loading} onClick={() => void load()} variant="outline">
          <RefreshCw className={loading ? "animate-spin" : undefined} />
          刷新
        </Button>
      }
      description="查看全站模型调用的项目、模型、动作、计量单位和实际扣费记录。"
      title="使用日志"
    >
      <form
        className="flex flex-col gap-3 border-b pb-4 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedQuery(query.trim());
        }}
      >
        <div className="relative max-w-lg flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="搜索使用日志"
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索用户、项目、模型或动作"
            value={query}
          />
        </div>
        <Select onValueChange={(value) => value && setApiType(value)} value={apiType}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {(payload?.filters.apiTypes ?? []).map((item) => (
              <SelectItem key={item} value={item}>{typeLabel(item)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit">查询</Button>
      </form>

      <div className="mt-5 grid border-y sm:grid-cols-2">
        <Metric label="匹配记录" value={String(payload?.summary.count ?? 0)} />
        <Metric label="累计扣费" value={`¥ ${payload?.summary.cost ?? "0"}`} />
      </div>

      {error ? (
        <Alert className="mt-5" variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-5 overflow-hidden border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>用户 / 项目</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>模型</TableHead>
              <TableHead>动作</TableHead>
              <TableHead>用量</TableHead>
              <TableHead className="text-right">费用</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !payload ? (
              <TableRow><TableCell className="h-32 text-center text-muted-foreground" colSpan={7}>正在加载使用日志...</TableCell></TableRow>
            ) : payload?.costs.length ? (
              payload.costs.map((cost) => (
                <TableRow key={cost.id}>
                  <TableCell className="text-muted-foreground">{formatDate(cost.createdAt)}</TableCell>
                  <TableCell>
                    <p className="font-medium">{cost.user.displayName}</p>
                    <p className="max-w-56 truncate text-xs text-muted-foreground" title={(cost.project?.name ?? "独立对话")}>{(cost.project?.name ?? "独立对话")}</p>
                  </TableCell>
                  <TableCell><Badge variant="outline">{typeLabel(cost.apiType)}</Badge></TableCell>
                  <TableCell className="max-w-64 truncate" title={cost.model}>{cost.model}</TableCell>
                  <TableCell>{billingActionLabel(cost.action)}</TableCell>
                  <TableCell>{cost.quantity} {unitLabel(cost.unit)}</TableCell>
                  <TableCell className="text-right font-mono">¥ {cost.cost}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow><TableCell className="h-32 text-center text-muted-foreground" colSpan={7}>暂无匹配的使用记录</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </AdminPage>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b px-1 py-4 last:border-b-0 sm:border-r sm:border-b-0 sm:px-4 sm:first:pl-1 sm:last:border-r-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function typeLabel(value: string) { return ({ text: "文本对话", image: "图片", video: "视频", audio: "配音", lipsync: "口型同步", voicedesign: "音色设计" } as Record<string, string>)[value] ?? "其他"; }
function unitLabel(value: string) { return ({ request: "次", image: "张", second: "秒", minute: "分钟", character: "字符", "1k_character": "千字符", task: "任务", mixed: "组合用量", tokens: "令牌" } as Record<string, string>)[value] ?? "用量"; }
