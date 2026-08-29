"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, LoaderCircle, RefreshCw, WalletCards } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

import type { ShellUser } from "./chat-shell-types";

export const ACCOUNT_SETTINGS_FORM_ID = "agent-account-settings-form";

export type AccountSettingsPanelStatus = {
  loading: boolean;
  submitting: boolean;
};

type AccountSettingsPanelProps = {
  formId: string;
  onStatusChange: (status: AccountSettingsPanelStatus) => void;
  user?: ShellUser | null;
};

type Balance = {
  balance: string;
  frozenAmount: string;
  available: string;
  totalSpent: string;
};

type TopupConfig = {
  enabled: boolean;
  methods: string[];
  minimumAmount: string;
  creditRate: string;
};

type PaymentOrder = {
  tradeNo: string;
  amount: string;
  creditAmount: string;
  paymentMethod: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
};

const EMPTY_BALANCE: Balance = {
  balance: "0",
  frozenAmount: "0",
  available: "0",
  totalSpent: "0",
};

const EMPTY_CONFIG: TopupConfig = {
  enabled: false,
  methods: [],
  minimumAmount: "0",
  creditRate: "0",
};

const METHOD_LABELS: Record<string, string> = {
  alipay: "支付宝",
  wxpay: "微信支付",
  qqpay: "QQ 钱包",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待支付",
  paid: "已到账",
  canceled: "已取消",
  expired: "已过期",
  failed: "失败",
};

export function AccountSettingsPanel({
  formId,
  onStatusChange,
  user,
}: AccountSettingsPanelProps) {
  const [balance, setBalance] = useState(EMPTY_BALANCE);
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadAccount = useCallback(async () => {
    setLoading(true);
    try {
      const [balancePayload, topupPayload] = await Promise.all([
        fetch("/api/user/balance", { cache: "no-store" }).then(readJson),
        fetch("/api/billing/topup?limit=20", { cache: "no-store" }).then(readJson),
      ]);
      const nextConfig = (topupPayload.config as TopupConfig) ?? EMPTY_CONFIG;
      setBalance((balancePayload.balance as Balance) ?? EMPTY_BALANCE);
      setConfig(nextConfig);
      setOrders((topupPayload.orders as PaymentOrder[]) ?? []);
      setAmount((current) => current || nextConfig.minimumAmount || "");
      setPaymentMethod((current) =>
        nextConfig.methods.includes(current)
          ? current
          : nextConfig.methods[0] || "",
      );
    } catch (error) {
      toast.error(readableError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  useEffect(() => {
    onStatusChange({ loading, submitting });
  }, [loading, onStatusChange, submitting]);

  const expectedCredit = useMemo(() => {
    const value = Number(amount);
    const rate = Number(config.creditRate);
    return Number.isFinite(value) && Number.isFinite(rate) && value > 0
      ? formatAmount(value * rate)
      : "0.00";
  }, [amount, config.creditRate]);

  async function createOrder() {
    setSubmitting(true);
    try {
      const payload = await readJson(
        await fetch("/api/billing/topup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount, paymentMethod }),
        }),
      );
      const paymentUrl =
        typeof payload.paymentUrl === "string" ? payload.paymentUrl : "";
      if (!paymentUrl) throw new Error("支付地址生成失败");
      window.location.assign(paymentUrl);
    } catch (error) {
      toast.error(readableError(error));
      setSubmitting(false);
    }
  }

  return (
    <form
      className="grid gap-8"
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        void createOrder();
      }}
    >
      <section className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">账户余额</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {user?.email || user?.name || "当前账户"}
            </p>
          </div>
          <Button
            aria-label="刷新账户余额"
            disabled={loading}
            onClick={() => void loadAccount()}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
        </div>

        <div className="grid overflow-hidden rounded-md border sm:grid-cols-3 sm:divide-x">
          <BalanceItem label="可用余额" value={balance.available} />
          <BalanceItem label="任务冻结" value={balance.frozenAmount} />
          <BalanceItem label="累计消费" value={balance.totalSpent} />
        </div>
      </section>

      <section className="grid gap-4 border-t pt-6">
        <div>
          <h3 className="text-base font-semibold">在线充值</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            充值订单由系统生成并验签，支付平台通知到账后余额会自动更新。
          </p>
        </div>

        {config.enabled ? (
          <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="grid gap-1.5">
              <Label className="text-xs" htmlFor="topup-amount">
                充值金额
              </Label>
              <Input
                id="topup-amount"
                min={config.minimumAmount}
                onChange={(event) => setAmount(event.target.value)}
                step="0.01"
                type="number"
                value={amount}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">支付方式</Label>
              <Select
                onValueChange={(value) => value && setPaymentMethod(value)}
                value={paymentMethod}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {config.methods.map((method) => (
                    <SelectItem key={method} value={method}>
                      {METHOD_LABELS[method] || method}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={loading || submitting || !paymentMethod}
              type="submit"
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <CreditCard />
              )}
              去支付
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
            <WalletCards className="size-4 shrink-0" />
            管理员尚未启用在线充值。
          </div>
        )}

        {config.enabled ? (
          <p className="text-xs text-muted-foreground">
            最低充值 {formatAmount(config.minimumAmount)} 元，预计到账{" "}
            {expectedCredit} 额度
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 border-t pt-6">
        <div>
          <h3 className="text-base font-semibold">充值记录</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            最近 20 笔在线充值订单。
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>方式</TableHead>
              <TableHead>金额</TableHead>
              <TableHead>到账额度</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length ? (
              orders.map((order) => (
                <TableRow key={order.tradeNo}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(order.createdAt)}
                  </TableCell>
                  <TableCell>
                    {METHOD_LABELS[order.paymentMethod] || order.paymentMethod}
                  </TableCell>
                  <TableCell>{formatAmount(order.amount)}</TableCell>
                  <TableCell>{formatAmount(order.creditAmount)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={order.status === "paid" ? "default" : "outline"}
                    >
                      {STATUS_LABELS[order.status] || order.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  className="py-8 text-center text-muted-foreground"
                  colSpan={5}
                >
                  {loading ? "正在加载充值记录..." : "暂无充值记录"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </form>
  );
}

function BalanceItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <strong className="text-xl font-semibold tabular-nums">
        {formatAmount(value)}
      </strong>
    </div>
  );
}

function formatAmount(value: string | number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("zh-CN", {
        maximumFractionDigits: 6,
        minimumFractionDigits: 2,
      }).format(number)
    : "0.00";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

async function readJson(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new Error(
      typeof payload.message === "string" ? payload.message : "请求失败",
    );
  }
  return payload;
}

function readableError(error: unknown) {
  const code = error instanceof Error ? error.message : "请求失败";
  return (
    {
      TOPUP_AMOUNT_INVALID: "请输入有效的充值金额",
      TOPUP_AMOUNT_OUT_OF_RANGE: "充值金额不在允许范围内",
      TOPUP_METHOD_INVALID: "请选择可用的支付方式",
      EPAY_CONFIGURATION_REQUIRED: "在线充值服务尚未配置完成",
    } as Record<string, string>
  )[code] ?? code;
}
