"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { AdminPage } from "@/components/admin/admin-page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { ModelPricePanel } from "./model-price-panel";
import { billingBreakdownLines } from "@/lib/billing/display";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type User = { id: string; displayName: string; email: string | null };
type Price = {
  id: string;
  provider: string;
  model: string;
  capability: string;
  unit: string;
  unitPrice: string;
  active: boolean;
};
type Channel = {
  id: string;
  name: string;
  providerKey: string;
  models?: Array<{ id: string; modelId?: string; name: string; type?: string; selected?: boolean }>;
};
type Balance = {
  id: string;
  balance: string;
  frozenAmount: string;
  totalSpent: string;
  updatedAt: string;
  user: User;
};
type Transaction = {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  description: string | null;
  taskType: string | null;
  billingMeta?: string | null;
  createdAt: string;
  user: User;
};

export function BillingPage() {
  const [prices, setPrices] = useState<Price[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditSaving, setCreditSaving] = useState(false);
  const [creditDraft, setCreditDraft] = useState({ userId: "", amount: "", description: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [billing, pricePayload, channelPayload] = await Promise.all([
        readJson(await fetch("/api/admin/billing", { cache: "no-store" })),
        readJson(await fetch("/api/billing/prices", { cache: "no-store" })),
        readJson(await fetch("/api/channels", { cache: "no-store" })),
      ]);
      setBalances((billing.balances as Balance[]) ?? []);
      setTransactions((billing.transactions as Transaction[]) ?? []);
      setUsers((billing.users as User[]) ?? []);
      setPrices((pricePayload.prices as Price[]) ?? []);
      setChannels((channelPayload.channels as Channel[]) ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "扣费数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function creditBalance() {
    if (!creditDraft.userId || !creditDraft.amount) return;
    setCreditSaving(true);
    try {
      await readJson(
        await fetch("/api/user/balance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(creditDraft),
        }),
      );
      toast.success("余额已入账");
      setCreditOpen(false);
      setCreditDraft({ userId: "", amount: "", description: "" });
      await load();
    } catch (creditError) {
      toast.error(creditError instanceof Error ? creditError.message : "余额入账失败");
    } finally {
      setCreditSaving(false);
    }
  }

  return (
    <AdminPage
      actions={
        <div className="flex gap-2">
          <Button onClick={() => setCreditOpen(true)}><Plus />手动入账</Button>
          <Button disabled={loading} onClick={() => void load()} size="icon" title="刷新" variant="outline">
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
        </div>
      }
      description="配置模型计费单价，检查用户余额、冻结金额和每一笔扣费流水。"
      title="扣费系统"
    >
      {error ? <Alert className="mb-5" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      <Tabs defaultValue="prices">
        <TabsList variant="line">
          <TabsTrigger value="prices">模型价格</TabsTrigger>
          <TabsTrigger value="balances">用户余额</TabsTrigger>
          <TabsTrigger value="transactions">扣费流水</TabsTrigger>
        </TabsList>

        <TabsContent className="mt-5 min-w-0" value="prices">
          {loading ? <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" />正在加载模型价格…</div> : error ? null : <ModelPricePanel channels={channels} prices={prices} onChange={setPrices} />}
        </TabsContent>

        <TabsContent className="mt-5" value="balances">
          <DataTable empty="暂无用户余额" headers={["用户", "可用余额", "冻结", "累计消费", "更新时间"]}>
            {balances.map((item) => (
              <TableRow key={item.id}>
                <TableCell><UserCell user={item.user} /></TableCell>
                <TableCell className="font-mono">¥ {item.balance}</TableCell>
                <TableCell className="font-mono">¥ {item.frozenAmount}</TableCell>
                <TableCell className="font-mono">¥ {item.totalSpent}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(item.updatedAt)}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </TabsContent>

        <TabsContent className="mt-5" value="transactions">
          <DataTable empty="暂无扣费流水" headers={["时间", "用户", "类型", "任务", "金额", "余额", "说明"]}>
            {transactions.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="text-muted-foreground">{formatDate(item.createdAt)}</TableCell>
                <TableCell><UserCell user={item.user} /></TableCell>
                <TableCell><Badge variant={item.type === "charge" ? "secondary" : "outline"}>{transactionLabel(item.type)}</Badge></TableCell>
                <TableCell>{item.taskType || "-"}</TableCell>
                <TableCell className="font-mono">¥ {item.amount}</TableCell>
                <TableCell className="font-mono">¥ {item.balanceAfter}</TableCell>
                <TableCell><p className="max-w-72 truncate" title={item.description || ""}>{item.description || "-"}</p>{billingBreakdownLines(item.billingMeta).map((line, index) => <p className="mt-1 whitespace-normal text-xs text-muted-foreground" key={index}>{line}</p>)}</TableCell>
              </TableRow>
            ))}
          </DataTable>
        </TabsContent>
      </Tabs>

      <Dialog onOpenChange={setCreditOpen} open={creditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>手动入账</DialogTitle>
            <DialogDescription>给指定用户增加余额，并记录一笔可追踪的入账流水。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <SelectField label="用户" onChange={(value) => setCreditDraft((current) => ({ ...current, userId: value }))} options={users.map((user) => ({ label: `${user.displayName} · ${user.email || user.id}`, value: user.id }))} placeholder="选择用户" value={creditDraft.userId} />
            <Field label="入账金额" onChange={(value) => setCreditDraft((current) => ({ ...current, amount: value }))} type="number" value={creditDraft.amount} />
            <Field label="说明" onChange={(value) => setCreditDraft((current) => ({ ...current, description: value }))} value={creditDraft.description} />
          </div>
          <DialogFooter>
            <Button disabled={creditSaving} onClick={() => setCreditOpen(false)} variant="outline">取消</Button>
            <Button disabled={creditSaving || !creditDraft.userId || !creditDraft.amount} onClick={() => void creditBalance()}>
              {creditSaving ? <LoaderCircle className="animate-spin" /> : null}确认入账
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminPage>
  );
}

function DataTable({ children, empty, headers }: React.PropsWithChildren<{ empty: string; headers: string[] }>) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="overflow-hidden border"><Table><TableHeader><TableRow>{headers.map((header, index) => <TableHead className={index === headers.length - 1 ? "text-right" : undefined} key={`${header}-${index}`}>{header}</TableHead>)}</TableRow></TableHeader><TableBody>{hasRows ? children : <TableRow><TableCell className="h-32 text-center text-muted-foreground" colSpan={headers.length}>{empty}</TableCell></TableRow>}</TableBody></Table></div>
  );
}

function SelectField({ disabled, label, onChange, options, placeholder, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }>; placeholder?: string; value: string }) {
  return <div className="grid min-w-0 gap-1.5"><Label>{label}</Label><Select disabled={disabled} onValueChange={(next) => next && onChange(next)} value={value || null}><SelectTrigger className="w-full"><SelectValue>{options.find((option) => option.value === value)?.label ?? placeholder}</SelectValue></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>;
}

function Field({ label, onChange, type = "text", value }: { label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return <div className="grid gap-1.5"><Label>{label}</Label><Input min={type === "number" ? "0" : undefined} onChange={(event) => onChange(event.target.value)} step={type === "number" ? "0.000001" : undefined} type={type} value={value} /></div>;
}

function UserCell({ user }: { user: User }) {
  return <div><p className="font-medium">{user.displayName}</p><p className="max-w-52 truncate text-xs text-muted-foreground">{user.email || user.id}</p></div>;
}

function transactionLabel(type: string) { return ({ charge: "扣费", credit: "入账", release: "释放冻结" } as Record<string, string>)[type] ?? type; }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
async function readJson(response: Response) { const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>; if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : "请求失败"); return payload; }
