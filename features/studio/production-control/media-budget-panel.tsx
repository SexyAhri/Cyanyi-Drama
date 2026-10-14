"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadStudioMediaBudget, saveStudioMediaBudget, type StudioMediaBudgetSummary } from "../api";
import type { StudioLocale } from "../types";

const copy = {
  "zh-CN": {
    title: "媒体额度预算",
    description: "按平台计费额度限制新任务。已消耗与进行中冻结额度都会计入；未配置模型价格的任务在预算启用时会阻止提交。",
    limit: "项目额度上限",
    placeholder: "留空表示不限制",
    actual: "已消耗",
    reserved: "进行中冻结",
    remaining: "剩余额度",
    unlimited: "未设置",
    save: "保存预算",
    saving: "保存中",
    failed: "预算读取或保存失败",
    saved: "预算已保存",
  },
  en: {
    title: "Media credit budget",
    description: "Limits new tasks using platform credits. Settled charges and active holds count toward it. Unpriced models are blocked while a budget is enabled.",
    limit: "Project credit cap",
    placeholder: "Blank means unlimited",
    actual: "Spent",
    reserved: "Active holds",
    remaining: "Remaining",
    unlimited: "Not set",
    save: "Save budget",
    saving: "Saving",
    failed: "Unable to load or save this budget",
    saved: "Budget saved",
  },
} as const;

export function MediaBudgetPanel({ projectId, locale }: { projectId: string; locale: StudioLocale }) {
  const text = copy[locale];
  const [summary, setSummary] = useState<StudioMediaBudgetSummary | null>(null);
  const [limit, setLimit] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void loadStudioMediaBudget(projectId, undefined, controller.signal).then(({ summary: next }) => {
      if (controller.signal.aborted) return;
      setSummary(next);
      setLimit(next.limit ?? "");
    }).catch(() => {
      if (!controller.signal.aborted) setError(text.failed);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [projectId, text.failed]);

  async function save() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const result = await saveStudioMediaBudget(projectId, limit.trim() ? limit.trim() : null);
      setSummary(result.summary);
      setLimit(result.summary.limit ?? "");
      setSaved(true);
    } catch {
      setError(text.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 border-b px-4 py-4 sm:px-5" aria-labelledby="media-budget-title">
      <div className="flex flex-col gap-1">
        <h2 id="media-budget-title" className="text-sm font-semibold">{text.title}</h2>
        <p className="text-xs leading-5 text-muted-foreground">{text.description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(12rem,0.8fr)_auto] sm:items-end">
        <label className="grid gap-1.5 text-xs font-medium">
          {text.limit}
          <Input aria-label={text.limit} disabled={loading || saving} inputMode="decimal" min="0" onChange={(event) => { setLimit(event.target.value); setSaved(false); }} placeholder={text.placeholder} type="number" value={limit} />
        </label>
        <Button disabled={loading || saving || !/^(\d+(\.\d{1,6})?)?$/.test(limit)} onClick={() => void save()} size="sm">
          {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? text.saving : text.save}
        </Button>
      </div>
      <div className="grid grid-cols-3 border-y text-center">
        <BudgetMetric label={text.actual} value={summary?.actual ?? "—"} />
        <BudgetMetric label={text.reserved} value={summary?.reserved ?? "—"} />
        <BudgetMetric label={text.remaining} value={summary?.configured ? summary.remaining ?? "0" : text.unlimited} warning={summary?.exceeded} />
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {saved ? <p role="status" className="text-xs text-muted-foreground">{text.saved}</p> : null}
    </section>
  );
}

function BudgetMetric({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return <div className="min-w-0 border-r px-2 py-2 last:border-r-0">
    <p className={`truncate font-mono text-sm font-semibold ${warning ? "text-destructive" : ""}`}>{value}</p>
    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{label}</p>
  </div>;
}
