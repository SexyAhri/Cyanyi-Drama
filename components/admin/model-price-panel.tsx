"use client";

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Pencil, Plus, Save, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableRow, TableCell } from "@/components/ui/table";
import { DataTable } from "@/components/ui/data-table";
import { CAPABILITY_BILLING_UNITS, type ModelPriceEntry } from "@/lib/billing/pricing-contract";
import { modelPricePlans, draftForPlan, draftRates, pricePlanSummary, capabilityLabels, priceUnitLabels, type PriceChannel, type PriceDraft } from "./model-price-plan";

export function ModelPricePanel({ channels, prices, onChange }: { channels: PriceChannel[]; prices: ModelPriceEntry[]; onChange: (prices: ModelPriceEntry[]) => void }) {
  const plans = useMemo(() => modelPricePlans(channels, prices), [channels, prices]);
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PriceDraft>({ mode: "tokens", values: {} });
  const [initial, setInitial] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"discard" | "disable" | null>(null);
  const [sample, setSample] = useState({ input: "100000", cached: "20000", output: "10000" });
  const selected = plans.find(plan => plan.key === selectedKey);
  const dirty = open && JSON.stringify(draft) !== initial;
  const filtered = plans.filter(plan => `${plan.label} ${plan.model} ${plan.channel}`.toLowerCase().includes(search.toLowerCase()));
  const field = (unit: string, value: string) => {
    setError("");
    setDraft(current => ({ ...current, values: { ...current.values, [unit]: value } }));
  };
  const edit = (key: string) => {
    const plan = plans.find(plan => plan.key === key);
    if (!plan) return;
    const next = draftForPlan(plan);
    setSelectedKey(key); setDraft(next); setInitial(JSON.stringify(next)); setError(""); setOpen(true);
  };
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  async function save() {
    if (!selected || saving) return;
    const rates = draftRates(draft);
    if (rates.some(rate => String(rate.unitPrice).trim() === "" || !Number.isFinite(Number(rate.unitPrice)) || Number(rate.unitPrice) < 0)) {
      setError("请完整填写所有必填价格；免费请明确填 0。"); return;
    }
    setSaving(true); setError("");
    try {
      const result = await readJson(await fetch("/api/billing/prices", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: selected.provider, model: selected.model, capability: selected.capability, rates }) }));
      onChange([...prices.filter(price => price.provider !== selected.provider || price.model !== selected.model || price.capability !== selected.capability), ...(result.prices as ModelPriceEntry[])]);
      setOpen(false); toast.success("模型价格方案已保存");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }
  async function disable() {
    if (!selected || saving) return;
    setSaving(true); setError("");
    try {
      await readJson(await fetch(`/api/billing/prices?${new URLSearchParams({ provider: selected.provider, model: selected.model, capability: selected.capability })}`, { method: "DELETE" }));
      onChange(prices.filter(price => price.provider !== selected.provider || price.model !== selected.model || price.capability !== selected.capability));
      setConfirm(null); setOpen(false); toast.success("价格方案已停用");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "停用失败，请重试"); setConfirm(null); }
    finally { setSaving(false); }
  }
  const preview = (Number(sample.input) - Number(sample.cached)) * Number(draft.values["1m_input_tokens"]) / 1e6 + Number(sample.cached) * Number(draft.values["1m_cached_input_tokens"]) / 1e6 + Number(sample.output) * Number(draft.values["1m_output_tokens"]) / 1e6;
  return <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
    <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-base font-semibold">模型计价</h2><p className="mt-1 text-sm text-muted-foreground">人民币 CNY。文本按实际 Token，图片按张，视频按秒；每个模型一套价格方案。</p></div>
      <Button disabled={!plans.some(plan => !plan.prices.length)} onClick={() => { const plan = plans.find(plan => !plan.prices.length); if (plan) edit(plan.key); }}><Plus />配置未定价模型</Button>
    </div>
    <div className="relative w-full max-w-sm shrink-0"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label="搜索模型或渠道" className="pl-9" placeholder="搜索模型或渠道" value={search} onChange={event => setSearch(event.target.value)} /></div>
    <p className="shrink-0 text-xs leading-5 text-muted-foreground">0 表示免费。未配置或已停用时不能调用。同名模型按供应商共用价格，已发出请求保留原价格快照。</p>
    <DataTable label="模型价格" className="min-w-[720px]" headers={["模型 / 渠道", "能力", "计费方式", "价格（CNY）", "操作"]} empty={search ? "没有匹配的模型" : "请先在模型渠道中添加模型"}>
      {filtered.map(plan => <TableRow key={plan.key}>
        <TableCell className="max-w-64"><div className="truncate font-medium" title={plan.model}>{plan.label}</div><div className="mt-1 truncate text-xs text-muted-foreground" title={plan.channel}>{plan.channel}</div></TableCell>
        <TableCell><Badge variant="outline">{capabilityLabels[plan.capability] ?? plan.capability}</Badge></TableCell>
        <TableCell>{plan.legacy ? <span className="text-amber-700 dark:text-amber-300">旧方案 · 待重新配置</span> : !plan.prices.length ? <span className="text-muted-foreground">未配置</span> : plan.prices.some(price => price.unit.includes("tokens")) ? "按 Token / 百万" : `按${priceUnitLabels[plan.prices[0].unit] ?? plan.prices[0].unit}`}</TableCell>
        <TableCell className="max-w-lg whitespace-normal text-xs leading-6 tabular-nums">{pricePlanSummary(plan)}</TableCell>
        <TableCell><Button aria-label={`配置 ${plan.model} 价格`} onClick={() => edit(plan.key)} size="sm" variant="outline"><Pencil className="size-3.5" />{plan.prices.length ? "编辑" : "配置"}</Button></TableCell>
      </TableRow>)}
    </DataTable>
    <Dialog open={open} onOpenChange={next => { if (saving) return; if (!next && dirty) setConfirm("discard"); else setOpen(next); }}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-3xl" showCloseButton={!saving}>
        <DialogHeader><DialogTitle>配置模型价格</DialogTitle><DialogDescription>{selected?.label} · {selected?.channel} · {selected ? capabilityLabels[selected.capability] : ""}</DialogDescription></DialogHeader>
        <div className="grid min-h-0 gap-5 overflow-y-auto px-0.5 py-1">
          {selected?.legacy ? <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">原方案为「{pricePlanSummary(selected)}」。字符价无法准确换算为 Token 价，请重新填写；保存后整体替换旧方案，历史账单不变。</p> : null}
          <div className="grid gap-2"><Label htmlFor="pricing-mode">计费方式</Label><Select disabled={saving} value={draft.mode} onValueChange={value => value && setDraft(current => ({ ...current, mode: value }))}><SelectTrigger id="pricing-mode" className="w-full"><SelectValue>{draft.mode === "tokens" ? "按 Token（每百万 Token）" : `按${priceUnitLabels[draft.mode] ?? draft.mode}`}</SelectValue></SelectTrigger><SelectContent>{(selected?.capability === "text" ? ["tokens", "request"] : CAPABILITY_BILLING_UNITS[selected?.capability ?? "image"]).map(unit => <SelectItem key={unit} value={unit}>{unit === "tokens" ? "按 Token（每百万 Token）" : `按${priceUnitLabels[unit] ?? unit}`}</SelectItem>)}</SelectContent></Select></div>
          <PriceRateFields draft={draft} disabled={saving} onChange={field} />
          {draft.mode === "tokens" ? <div className="grid gap-3 border-t pt-4">
            <p className="text-xs leading-5 text-muted-foreground">普通输入 = 总输入 − 缓存命中。三项分别计费后相加，不按字符估算，也不对 Token 数向上取整。输出包含模型报告的推理 Token。</p>
            <details><summary className="cursor-pointer text-sm font-medium">缓存写入价格（可选）</summary><div className="mt-3 grid gap-2"><RateInput unit="1m_cache_write_tokens" value={draft.values["1m_cache_write_tokens"] ?? ""} disabled={saving} onChange={field} optional /><p className="text-xs text-muted-foreground">仅为返回缓存写入用量的渠道填写；留空时按普通输入价格计费，填写后从普通输入中扣除。</p></div></details>
            <details><summary className="cursor-pointer text-sm font-medium">费用试算</summary><div className="mt-3 grid gap-3 sm:grid-cols-3">{([['input', '总输入 Token'], ['cached', '其中缓存命中'], ['output', '输出 Token']] as const).map(([key, label]) => <div className="grid gap-2" key={key}><Label htmlFor={`sample-${key}`}>{label}</Label><Input id={`sample-${key}`} min="0" step="1" type="number" value={sample[key]} onChange={event => setSample(current => ({ ...current, [key]: event.target.value }))} /></div>)}</div><p className="mt-3 text-sm" aria-live="polite">{Object.values(sample).every(value => value !== "" && Number.isSafeInteger(Number(value)) && Number(value) >= 0) && Number(sample.cached) <= Number(sample.input) && draftRates(draft).every(rate => String(rate.unitPrice) !== "") && Number.isFinite(preview) ? `预计费用 ¥${preview.toFixed(6)}（试算不含缓存写入）` : "请填写有效价格和用量；缓存命中不能超过总输入。"}</p></details>
          </div> : <p className="text-xs text-muted-foreground">{draft.mode === "request" ? "每次完成的模型请求收取一次固定费用，不叠加 Token 或字符费用。" : "按实际返回的图片数量或测得的媒体时长结算；字符计价使用真实输入字符数，不按整百万进位。"}</p>}
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        </div>
        <DialogFooter className="flex-wrap border-t pt-4"><Button disabled={saving || !selected?.prices.length} className="mr-auto" variant="ghost" onClick={() => setConfirm("disable")}><Trash2 />停用价格</Button><Button disabled={saving} variant="outline" onClick={() => dirty ? setConfirm("discard") : setOpen(false)}>取消</Button><Button disabled={saving || !selected} onClick={() => void save()}>{saving ? <LoaderCircle className="animate-spin" /> : <Save />}保存方案</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirm !== null} onOpenChange={value => !saving && !value && setConfirm(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm === "discard" ? "放弃未保存的价格？" : "停用此模型价格？"}</AlertDialogTitle><AlertDialogDescription>{confirm === "discard" ? "继续编辑可保留当前填写内容。" : "停用后将阻止此模型的新请求，历史账单和已冻结请求保持不变。"}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={saving}>{confirm === "discard" ? "继续编辑" : "取消"}</AlertDialogCancel><AlertDialogAction disabled={saving} variant="destructive" onClick={() => confirm === "discard" ? (setOpen(false), setConfirm(null)) : void disable()}>{saving ? "正在停用…" : confirm === "discard" ? "放弃修改" : "确认停用"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

export function PriceRateFields({ draft, disabled, onChange }: { draft: PriceDraft; disabled: boolean; onChange: (unit: string, value: string) => void }) {
  return <div className={draft.mode === "tokens" ? "grid gap-4 sm:grid-cols-3" : "grid gap-4"}>{(draft.mode === "tokens" ? ["1m_input_tokens", "1m_output_tokens", "1m_cached_input_tokens"] : [draft.mode]).map(unit => <RateInput disabled={disabled} key={unit} unit={unit} value={draft.values[unit] ?? ""} onChange={onChange} />)}</div>;
}
function RateInput({ unit, value, disabled, optional, onChange }: { unit: string; value: string; disabled: boolean; optional?: boolean; onChange: (unit: string, value: string) => void }) {
  const label = ({ "1m_input_tokens": "输入（未缓存）", "1m_output_tokens": "输出", "1m_cached_input_tokens": "缓存读取", "1m_cache_write_tokens": "缓存写入" } as Record<string, string>)[unit] ?? "单价";
  return <div className="grid gap-2"><Label htmlFor={`rate-${unit}`}>{label}{optional ? "（可选）" : ""}</Label><div className="relative"><span className="pointer-events-none absolute left-3 top-2 text-muted-foreground">¥</span><Input id={`rate-${unit}`} className="pl-7 tabular-nums" disabled={disabled} type="number" inputMode="decimal" min="0" step="0.000001" placeholder={optional ? "留空使用输入价" : "填写价格，免费填 0"} value={value} onChange={event => onChange(unit, event.target.value)} /></div><p className="text-xs text-muted-foreground">CNY / {unit.includes("tokens") ? "百万 Token" : priceUnitLabels[unit] ?? unit}</p></div>;
}
async function readJson(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "请求失败，请重试");
  return body;
}
