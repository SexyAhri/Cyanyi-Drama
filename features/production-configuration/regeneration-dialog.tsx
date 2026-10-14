"use client";
import { useEffect, useRef, useState } from "react";
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

type Preview = {
  token: string;
  target: string;
  count: number;
  executionVersion: number;
  steps?: string[];
  configuration: ProductionConfigurationSnapshot;
  previousConfiguration?: ProductionConfigurationSnapshot;
  prompt?: string;
  parameters?: unknown;
};
export function RegenerationDialog({
  id,
  kind,
  locale,
  onClose,
  onComplete,
}: {
  id: string;
  kind: "media" | "workflow";
  locale: "zh-CN" | "en";
  onClose: () => void;
  onComplete: () => Promise<unknown> | void;
}) {
  const en = locale === "en";
  const copy = productionCopy[locale];
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const submitting = useRef(false);
  async function call(body: object, signal?: AbortSignal) {
    const response = await fetch("/api/execution/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, kind, ...body }),
      signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message);
    return result;
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/execution/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, kind, preview: true }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message);
        return data;
      })
      .then((data) => {
        setPreview(data.preview);
        setError("");
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, [id, kind]);
  async function reload() {
    setBusy(true);
    setPreview(null);
    setError("");
    try {
      setPreview((await call({ preview: true })).preview);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!preview || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await call({
        preview: false,
        token: preview.token,
        idempotencyKey: key.current,
      });
      toast.success(en ? "New execution created" : "已创建新的执行版本");
      await onComplete();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setPreview(null);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const diff = preview
    ? configurationDiff(
        preview.previousConfiguration ?? {},
        preview.configuration,
      )
    : [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[85dvh] min-w-0 flex-col sm:max-w-2xl"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>
            {en ? "Regenerate with published settings" : "使用新配置重新生成"}
          </DialogTitle>
          <DialogDescription>
            {en
              ? "Creates a new execution and keeps the original record and assets. Fresh model requests may incur charges."
              : "创建新执行版本，保留原记录和已有产物；将发送新模型请求，可能产生费用。"}
          </DialogDescription>
        </DialogHeader>
        <div
          className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto pr-1 text-sm"
          aria-live="polite"
        >
          {error ? (
            <p role="alert" className="break-anywhere text-destructive">
              {error}
            </p>
          ) : null}
          {!preview && !error ? (
            <p className="text-muted-foreground">
              {en ? "Loading preview…" : "正在读取配置与影响范围…"}
            </p>
          ) : null}
          {preview ? (
            <>
              <dl className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {en ? "Affected target" : "影响对象"}
                  </dt>
                  <dd className="break-all">{preview.target}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {en ? "Scope" : "执行范围"}
                  </dt>
                  <dd>
                    {kind === "workflow"
                      ? en
                        ? "Entire workflow"
                        : "整条工作流"
                      : en
                        ? "Media requests"
                        : "媒体请求"}{" "}
                    · {preview.count} · v{preview.executionVersion}
                  </dd>
                </div>
              </dl>
              {preview.steps ? (
                <p className="break-anywhere text-xs text-muted-foreground">
                  {preview.steps.join(" → ")}
                </p>
              ) : null}
              <section className="space-y-2">
                <h3 className="font-medium">
                  {en ? "Published versions" : "配置版本来源"}
                </h3>
                <p className="break-all text-xs text-muted-foreground">
                  {preview.configuration.defaultsVersion ??
                    "production-configuration-v1"}{" "}
                  ·{" "}
                  {preview.configuration.sources
                    .map((item) => `${item.scopeKey} v${item.version}`)
                    .join(" · ") || copy.inherited}
                </p>
              </section>
              <section className="space-y-2">
                <h3 className="font-medium">
                  {en ? "Changes from original snapshot" : "与原快照的设置差异"}
                </h3>
                {diff.length ? (
                  <div className="divide-y rounded-lg border">
                    {diff.map((item) => (
                      <div key={item.field} className="space-y-1 p-3">
                        <p className="text-xs font-medium">
                          {fieldLabel(item.field, copy)}
                        </p>
                        <div className="grid gap-2 text-xs sm:grid-cols-2">
                          <p className="whitespace-pre-wrap break-anywhere text-muted-foreground">
                            {displayValue(item.field, item.before, copy)}
                          </p>
                          <p className="whitespace-pre-wrap break-anywhere">
                            {displayValue(item.field, item.after, copy)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {en
                      ? "Settings are unchanged. A fresh execution will still be created."
                      : "设置值未变化，仍会创建新的执行版本。"}
                  </p>
                )}
              </section>
              {preview.prompt ? (
                <details>
                  <summary className="cursor-pointer rounded py-2 font-medium focus-visible:outline-2 focus-visible:outline-ring">
                    {en ? "Final prompt" : "最终提示词"}
                  </summary>
                  <p className="whitespace-pre-wrap break-anywhere rounded border p-3 text-xs">
                    {preview.prompt}
                  </p>
                </details>
              ) : null}
              {preview.parameters ? (
                <details>
                  <summary className="cursor-pointer rounded py-2 font-medium focus-visible:outline-2 focus-visible:outline-ring">
                    {en ? "Request parameters" : "请求参数"}
                  </summary>
                  <pre className="whitespace-pre-wrap break-all rounded border p-3 text-xs">
                    {JSON.stringify(preview.parameters, null, 2)}
                  </pre>
                </details>
              ) : null}
            </>
          ) : null}
        </div>
        <DialogFooter className="shrink-0 gap-2 max-sm:flex-col">
          <Button
            variant="outline"
            className="min-h-10"
            disabled={busy}
            onClick={onClose}
          >
            {en ? "Cancel" : "取消"}
          </Button>
          <Button
            variant="outline"
            className="min-h-10"
            disabled={busy}
            onClick={() => void reload()}
          >
            {en ? "Refresh preview" : "重新预览"}
          </Button>
          <Button
            className="min-h-10"
            disabled={busy || !preview}
            onClick={() => void submit()}
          >
            {busy
              ? en
                ? "Working…"
                : "处理中…"
              : en
                ? "Confirm new execution"
                : "确认创建新执行"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
