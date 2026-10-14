"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProductionConfigurationSnapshot } from "@/lib/production-configuration/contract";
import { configurationDiff } from "./view-model";
import { productionCopy } from "./copy";
import { displayValue, fieldLabel } from "./configuration-display";

export type BulkRegenerationTarget = {
  id: string;
  kind: "media" | "workflow";
  label: string;
};

type Preview = {
  token: string;
  target: string;
  count: number;
  executionVersion: number;
  steps?: string[];
  configuration: ProductionConfigurationSnapshot;
  previousConfiguration?: ProductionConfigurationSnapshot;
};

type Entry = {
  target: BulkRegenerationTarget;
  preview?: Preview;
  error?: string;
  executionKey: string;
  result?: string;
};

export function BulkRegenerationDialog({
  locale,
  onClose,
  onComplete,
  targets,
}: {
  locale: "zh-CN" | "en";
  onClose: () => void;
  onComplete: () => Promise<unknown> | void;
  targets: BulkRegenerationTarget[];
}) {
  const en = locale === "en";
  const copy = productionCopy[locale];
  const [entries, setEntries] = useState<Entry[]>(() =>
    targets.map((target) => ({
      target,
      executionKey: crypto.randomUUID(),
    })),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      targets.map(async (target): Promise<Entry> => {
        const executionKey = crypto.randomUUID();
        try {
          const response = await fetch("/api/execution/regenerate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: target.id,
              kind: target.kind,
              preview: true,
            }),
            signal: controller.signal,
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.message);
          return { target, executionKey, preview: data.preview as Preview };
        } catch (error) {
          return {
            target,
            executionKey,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    )
      .then((next) => {
        if (!controller.signal.aborted) setEntries(next);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [targets]);

  async function submit() {
    if (
      loading ||
      busy ||
      entries.some((entry) => !entry.preview || entry.error)
    )
      return;
    setBusy(true);
    try {
      const next = [...entries];
      for (let index = 0; index < next.length; index++) {
        const entry = next[index];
        if (!entry.preview) continue;
        try {
          const response = await fetch("/api/execution/regenerate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: entry.target.id,
              kind: entry.target.kind,
              preview: false,
              token: entry.preview.token,
              idempotencyKey: entry.executionKey,
            }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.message);
          next[index] = { ...entry, result: "succeeded" };
        } catch (error) {
          next[index] = {
            ...entry,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        setEntries([...next]);
      }
      const successCount = next.filter(
        (entry) => entry.result === "succeeded",
      ).length;
      setSubmitted(true);
      if (successCount) {
        const failedCount = next.length - successCount;
        if (failedCount) {
          toast.warning(
            en
              ? `${successCount} execution(s) created; ${failedCount} failed. See each target for details.`
              : `已创建 ${successCount} 个执行版本，${failedCount} 项失败；请查看各对象的错误详情。`,
          );
        } else {
          toast.success(
            en
              ? `${successCount} new execution(s) created`
              : `已创建 ${successCount} 个新执行版本`,
          );
        }
        await onComplete();
      }
    } finally {
      setBusy(false);
    }
  }

  const errors = entries.filter((entry) => entry.error);
  const ready =
    !loading &&
    entries.length > 0 &&
    entries.every((entry) => entry.preview && !entry.error);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="flex max-h-[88dvh] min-w-0 flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {en
              ? "Bulk regenerate with published settings"
              : "批量使用已发布配置重新生成"}
          </DialogTitle>
          <DialogDescription>
            {en
              ? "Each target gets a separate preview and confirmation token. Existing runs and assets are preserved; new requests may incur charges."
              : "每个对象分别读取配置与影响范围，再以独立确认令牌提交；旧运行和产物会保留，新请求可能产生费用。"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {loading ? (
            <p role="status" className="text-sm text-muted-foreground">
              {en ? "Loading previews…" : "正在读取逐项预览…"}
            </p>
          ) : null}
          {entries.map((entry) => {
            const preview = entry.preview;
            const changes = preview
              ? configurationDiff(
                  preview.previousConfiguration ?? {},
                  preview.configuration,
                )
              : [];
            return (
              <section
                className="min-w-0 space-y-2 rounded-lg border bg-muted/15 p-3"
                key={`${entry.target.kind}:${entry.target.id}`}
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="break-all text-sm font-medium">
                      {entry.target.label}
                    </h3>
                    <p className="break-all font-mono text-[10px] text-muted-foreground">
                      {entry.target.kind} · {entry.target.id}
                    </p>
                  </div>
                  {entry.result === "succeeded" ? (
                    <span className="shrink-0 text-xs text-primary">
                      {en ? "Queued" : "已提交"}
                    </span>
                  ) : null}
                </div>
                {entry.error ? (
                  <p
                    role="alert"
                    className="break-anywhere text-xs text-destructive"
                  >
                    {entry.error}
                  </p>
                ) : null}
                {preview ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {en ? "Scope" : "范围"}: {preview.count} · v
                      {preview.executionVersion}
                    </p>
                    {preview.steps?.length ? (
                      <p className="break-anywhere text-xs text-muted-foreground">
                        {preview.steps.join(" → ")}
                      </p>
                    ) : null}
                    <p className="break-all text-xs text-muted-foreground">
                      {preview.configuration.sources
                        .map(
                          (source) => `${source.scopeKey} v${source.version}`,
                        )
                        .join(" · ") || copy.inherited}
                    </p>
                    {changes.length ? (
                      <div className="divide-y rounded-md border">
                        {changes.map((change) => (
                          <div
                            className="grid gap-1 p-2 sm:grid-cols-[minmax(7rem,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-2"
                            key={change.field}
                          >
                            <p className="text-xs font-medium">
                              {fieldLabel(change.field, copy)}
                            </p>
                            <p className="whitespace-pre-wrap break-anywhere text-xs text-muted-foreground">
                              {displayValue(change.field, change.before, copy)}
                            </p>
                            <p className="whitespace-pre-wrap break-anywhere text-xs">
                              {displayValue(change.field, change.after, copy)}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {en
                          ? "Published settings are unchanged."
                          : "已发布配置没有字段变化。"}
                      </p>
                    )}
                  </>
                ) : null}
              </section>
            );
          })}
        </div>
        <DialogFooter className="shrink-0 gap-2 max-sm:flex-col">
          <Button
            className="max-sm:min-h-10"
            disabled={busy}
            onClick={onClose}
            variant="outline"
          >
            {copy.cancel}
          </Button>
          <Button
            className="max-sm:min-h-10"
            disabled={!ready || busy || submitted || errors.length > 0}
            onClick={() => void submit()}
          >
            {busy
              ? en
                ? "Submitting…"
                : "正在提交…"
              : en
                ? "Confirm selected regenerations"
                : "确认批量重新生成"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
