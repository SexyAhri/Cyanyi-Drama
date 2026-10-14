"use client";

import { Check, GitCompareArrows, RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import type { PostQcStatus } from "@/lib/production/post-contract";
import { cn } from "@/lib/utils";

import type { ProductionDeliverableRecord, StudioLocale } from "../types";
import { compareVersionPayloads } from "../production/version-diff";
import { formatStudioDate } from "../i18n";

export type EditableQcCheck = {
  status: PostQcStatus;
  measured: number | null;
  target: number | null;
  unit: string;
  note: string;
};

export function QcReportEditor<T extends string>({
  checks,
  columns = 1,
  keys,
  labels,
  locale,
  onChange,
}: {
  checks: Record<T, EditableQcCheck>;
  columns?: 1 | 2;
  keys: readonly T[];
  labels: Record<T, string>;
  locale: StudioLocale;
  onChange: (key: T, value: EditableQcCheck) => void;
}) {
  const text =
    locale === "en"
      ? {
          measured: "Measured",
          target: "Target",
          unit: "Unit",
          note: "QC note",
        }
      : { measured: "实测", target: "目标", unit: "单位", note: "检查备注" };
  return (
    <div
      className={cn(
        "grid border-t",
        columns === 2 && "2xl:grid-cols-2 2xl:gap-x-5",
      )}
    >
      {keys.map((key) => {
        const check = checks[key];
        return (
          <div className="border-b py-3" key={key}>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <QcIcon status={check.status} />
                <span className="truncate text-sm font-medium">
                  {labels[key]}
                </span>
              </div>
              <NativeSelect
                aria-label={labels[key]}
                className="h-8 w-28 shrink-0"
                onChange={(event) =>
                  onChange(key, {
                    ...check,
                    status: event.target.value as PostQcStatus,
                  })
                }
                value={check.status}
              >
                <NativeSelectOption value="pending">
                  {locale === "en" ? "Pending" : "待检查"}
                </NativeSelectOption>
                <NativeSelectOption value="pass">
                  {locale === "en" ? "Pass" : "通过"}
                </NativeSelectOption>
                <NativeSelectOption value="fail">
                  {locale === "en" ? "Fail" : "失败"}
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-2 pt-2 sm:grid-cols-3">
              <Input
                aria-label={text.measured}
                className="h-8"
                onChange={(event) =>
                  onChange(key, {
                    ...check,
                    measured: optionalNumber(event.target.value),
                  })
                }
                placeholder={text.measured}
                type="number"
                value={check.measured ?? ""}
              />
              <Input
                aria-label={text.target}
                className="h-8"
                onChange={(event) =>
                  onChange(key, {
                    ...check,
                    target: optionalNumber(event.target.value),
                  })
                }
                placeholder={text.target}
                type="number"
                value={check.target ?? ""}
              />
              <Input
                aria-label={text.unit}
                className="h-8"
                maxLength={32}
                onChange={(event) =>
                  onChange(key, { ...check, unit: event.target.value })
                }
                placeholder={text.unit}
                value={check.unit}
              />
              <Input
                aria-label={text.note}
                className="col-span-2 h-8 sm:col-span-3"
                maxLength={2_000}
                onChange={(event) =>
                  onChange(key, { ...check, note: event.target.value })
                }
                placeholder={text.note}
                value={check.note}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function VersionHistory({
  busy,
  locale,
  onRestore,
  versions,
}: {
  busy: boolean;
  locale: StudioLocale;
  onRestore: (deliverableId: string) => void;
  versions: Array<{
    deliverable: ProductionDeliverableRecord;
    summary: ReactNode;
  }>;
}) {
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const orderedVersions = [...versions].sort(
    (left, right) => right.deliverable.version - left.deliverable.version,
  );
  const current = orderedVersions[0]?.deliverable;
  const comparison = orderedVersions.find(
    (item) => item.deliverable.id === comparisonId,
  )?.deliverable;
  const differences =
    current && comparison
      ? compareVersionPayloads(comparison.payload, current.payload)
      : [];
  if (!versions.length)
    return (
      <p className="border-y py-4 text-sm text-muted-foreground">
        {locale === "en" ? "No saved versions" : "还没有保存版本"}
      </p>
    );
  return (
    <div className="divide-y border-y">
      {orderedVersions.map(({ deliverable, summary }) => (
        <div
          className="flex min-w-0 flex-wrap items-center gap-2 py-3 sm:gap-3"
          key={deliverable.id}
        >
          <Badge variant="outline">v{deliverable.version}</Badge>
          <Badge variant="secondary">
            {deliverableStatus(locale, deliverable.status)}
          </Badge>
          <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {summary}
          </div>
          {current && deliverable.id !== current.id ? (
            <Button
              aria-label={
                locale === "en"
                  ? `Compare version ${deliverable.version} with current`
                  : `比较版本 ${deliverable.version} 与当前版本`
              }
              disabled={busy}
              onClick={() =>
                setComparisonId(
                  comparisonId === deliverable.id ? null : deliverable.id,
                )
              }
              size="sm"
              variant={comparisonId === deliverable.id ? "secondary" : "ghost"}
            >
              <GitCompareArrows className="size-3.5" />
              {locale === "en" ? "Compare" : "比较"}
            </Button>
          ) : null}
          {deliverable.status === "superseded" ? (
            <Button
              aria-label={locale === "en" ? "Restore version" : "恢复版本"}
              disabled={busy}
              onClick={() => onRestore(deliverable.id)}
              size="icon-sm"
              variant="ghost"
            >
              <RotateCcw className="size-3.5" />
            </Button>
          ) : null}
          {comparisonId === deliverable.id && current ? (
            <section
              className="grid min-w-0 basis-full gap-3 rounded-md bg-muted/35 p-3 text-xs sm:grid-cols-2"
              aria-label={locale === "en" ? "Version comparison" : "版本比较"}
            >
              <div className="min-w-0">
                <h4 className="mb-1 font-semibold">
                  {locale === "en"
                    ? `Selected v${comparison?.version}`
                    : `所选版本 v${comparison?.version}`}
                </h4>
                <p className="break-all text-muted-foreground">
                  {formatVersionSnapshot(comparison, locale)}
                </p>
              </div>
              <div className="min-w-0">
                <h4 className="mb-1 font-semibold">
                  {locale === "en"
                    ? `Current v${current.version}`
                    : `当前版本 v${current.version}`}
                </h4>
                <p className="break-all text-muted-foreground">
                  {formatVersionSnapshot(current, locale)}
                </p>
              </div>
              <div className="min-w-0 space-y-2 sm:col-span-2">
                <h4 className="font-semibold">
                  {locale === "en" ? "Payload differences" : "内容差异"}
                </h4>
                {differences.length ? (
                  differences.map((difference) => (
                    <div
                      className="grid min-w-0 gap-2 border-t pt-2 sm:grid-cols-[minmax(8rem,0.7fr)_minmax(0,1fr)_minmax(0,1fr)]"
                      key={difference.path}
                    >
                      <code className="break-all text-muted-foreground">
                        {difference.path}
                      </code>
                      <pre className="max-h-32 min-w-0 overflow-auto whitespace-pre-wrap break-anywhere rounded bg-background/70 p-2">
                        {formatDiffValue(difference.before, locale)}
                      </pre>
                      <pre className="max-h-32 min-w-0 overflow-auto whitespace-pre-wrap break-anywhere rounded bg-background/70 p-2">
                        {formatDiffValue(difference.after, locale)}
                      </pre>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">
                    {locale === "en" ? "Payloads are identical." : "内容相同。"}
                  </p>
                )}
              </div>
            </section>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function formatVersionSnapshot(
  version: ProductionDeliverableRecord | undefined,
  locale: StudioLocale,
) {
  if (!version) return "";
  const sourceLabel = locale === "en" ? "Sources" : "来源";
  const sourceText = version.sourceRefs.length
    ? JSON.stringify(version.sourceRefs)
    : locale === "en"
      ? "none"
      : "无";
  const updatedAt = formatStudioDate(locale, version.updatedAt);
  const promptTrace = compactPromptTrace(version.promptTrace);
  const traceText = promptTrace
    ? ` · ${locale === "en" ? "Input/config trace" : "输入/配置追踪"}: ${JSON.stringify(promptTrace)}`
    : "";
  return `${updatedAt} · ${sourceLabel}: ${sourceText} · ${locale === "en" ? "Dependency fingerprint" : "依赖指纹"}: ${version.dependencyHash}${traceText}`;
}

function compactPromptTrace(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = [
    "provider",
    "model",
    "promptId",
    "promptVersion",
    "inputHash",
    "configurationHash",
    "cacheVersion",
    "reused",
  ];
  return Object.fromEntries(
    keys.flatMap((key) =>
      record[key] === undefined ? [] : [[key, record[key]]],
    ),
  );
}

function formatDiffValue(value: unknown, locale: StudioLocale) {
  if (value === undefined) return locale === "en" ? "(missing)" : "（无）";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function QcIcon({ status }: { status: PostQcStatus }) {
  return status === "pass" ? (
    <Check className="size-4 text-emerald-600" />
  ) : status === "fail" ? (
    <X className="size-4 text-destructive" />
  ) : (
    <span className="size-2 rounded-full bg-muted-foreground/40" />
  );
}

function optionalNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deliverableStatus(locale: StudioLocale, status: string) {
  const values: Record<string, readonly [string, string]> = {
    draft: ["草稿", "Draft"],
    review: ["评审中", "In review"],
    approved: ["已批准", "Approved"],
    locked: ["已锁定", "Locked"],
    stale: ["已失效", "Stale"],
    superseded: ["已废弃", "Superseded"],
  };
  const value = values[status];
  return value?.[locale === "en" ? 1 : 0] ?? status;
}
