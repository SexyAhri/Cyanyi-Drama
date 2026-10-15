"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";

import { AdminPage } from "@/components/admin/admin-page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";

type TopupOrder = {
  id: string;
  tradeNo: string;
  providerTradeNo: string | null;
  provider: string;
  paymentMethod: string;
  amount: string;
  creditAmount: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
  user: { id: string; displayName: string; email: string | null };
};

type TopupsPayload = {
  orders: TopupOrder[];
  summary: { count: number; amount: string; creditAmount: string };
};

const statuses = ["all", "pending", "paid", "failed", "expired"];

export function TopupsPage() {
  const [payload, setPayload] = useState<TopupsPayload | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (appliedQuery) params.set("query", appliedQuery);
      if (status !== "all") params.set("status", status);
      const response = await fetch(`/api/admin/topups?${params}`, {
        cache: "no-store",
      });
      const next = (await response.json().catch(() => ({}))) as
        | TopupsPayload
        | { message?: string };
      if (!response.ok || !("orders" in next)) {
        throw new Error(
          ("message" in next && next.message) || "充值订单加载失败",
        );
      }
      setPayload(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "充值订单加载失败");
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, status]);

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
      description="查看易支付订单、到账额度、支付状态和第三方交易号。订单状态由支付回调更新。"
      title="充值订单"
    >
      <form
        className="flex shrink-0 flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedQuery(query.trim());
        }}
      >
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="搜索充值订单"
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索用户、站内订单号或第三方交易号"
            value={query}
          />
        </div>
        <Select onValueChange={(value) => value && setStatus(value)} value={status}>
          <SelectTrigger aria-label="充值订单状态" className="w-36"><SelectValue>{statusLabel(status)}</SelectValue></SelectTrigger>
          <SelectContent>
            {statuses.map((item) => (
              <SelectItem key={item} value={item}>{statusLabel(item)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit">查询</Button>
      </form>

      <div className="grid shrink-0 grid-cols-3 border-y">
        <Metric label="订单数" value={String(payload?.summary.count ?? 0)} />
        <Metric label="支付金额" value={`¥ ${payload?.summary.amount ?? "0"}`} />
        <Metric label="到账额度" value={`¥ ${payload?.summary.creditAmount ?? "0"}`} />
      </div>

      {error ? (
        <Alert className="shrink-0" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      ) : null}

      <DataTable label="充值订单" loading={loading} totalCount={payload?.summary.count} headers={["创建时间", "用户", "订单号", "方式", "状态", "支付 / 到账", "支付时间"]} empty="暂无匹配的充值订单" className="min-w-[1000px]">
              {payload?.orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="text-muted-foreground">{formatDate(order.createdAt)}</TableCell>
                  <TableCell>
                    <p className="font-medium">{order.user.displayName}</p>
                    <p className="max-w-48 truncate text-xs text-muted-foreground">{order.user.email || order.user.id}</p>
                  </TableCell>
                  <TableCell>
                    <p className="font-mono text-xs">{order.tradeNo}</p>
                    {order.providerTradeNo ? <p className="mt-1 font-mono text-xs text-muted-foreground">{order.providerTradeNo}</p> : null}
                  </TableCell>
                  <TableCell>{paymentLabel(order.paymentMethod)}</TableCell>
                  <TableCell><StatusBadge status={order.status} /></TableCell>
                  <TableCell className="font-mono">¥ {order.amount} / ¥ {order.creditAmount}</TableCell>
                  <TableCell className="text-muted-foreground">{order.paidAt ? formatDate(order.paidAt) : "-"}</TableCell>
                </TableRow>
              ))}
      </DataTable>
    </AdminPage>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-r px-3 py-2 first:pl-1 last:border-r-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === "paid" ? "secondary" : status === "failed" ? "destructive" : "outline";
  return <Badge variant={variant}>{statusLabel(status)}</Badge>;
}

function statusLabel(status: string) {
  return ({ all: "全部状态", pending: "待支付", paid: "已到账", failed: "失败", expired: "已过期" } as Record<string, string>)[status] ?? status;
}

function paymentLabel(method: string) {
  return ({ alipay: "支付宝", wxpay: "微信支付", qqpay: "QQ 钱包" } as Record<string, string>)[method] ?? method;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
