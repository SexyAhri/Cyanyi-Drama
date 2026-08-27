"use client";

import { Check, RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import type { PostQcStatus } from "@/lib/production/post-contract";

import type { ProductionDeliverableRecord, StudioLocale } from "../types";

export type EditableQcCheck = {
  status: PostQcStatus;
  measured: number | null;
  target: number | null;
  unit: string;
  note: string;
};

export function QcReportEditor<T extends string>({
  checks,
  keys,
  labels,
  locale,
  onChange,
}: {
  checks: Record<T, EditableQcCheck>;
  keys: readonly T[];
  labels: Record<T, string>;
  locale: StudioLocale;
  onChange: (key: T, value: EditableQcCheck) => void;
}) {
  const text = locale === "en"
    ? { measured: "Measured", target: "Target", unit: "Unit", note: "QC note" }
    : { measured: "实测", target: "目标", unit: "单位", note: "检查备注" };
  return (
    <div className="divide-y border-y">
      {keys.map((key) => {
        const check = checks[key];
        return (
          <div className="py-3" key={key}>
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <QcIcon status={check.status} />
                <span className="truncate text-sm font-medium">{labels[key]}</span>
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
  versions: Array<{ deliverable: ProductionDeliverableRecord; summary: ReactNode }>;
}) {
  if (!versions.length)
    return (
      <p className="border-y py-4 text-sm text-muted-foreground">
        {locale === "en" ? "No saved versions" : "还没有保存版本"}
      </p>
    );
  return (
    <div className="divide-y border-y">
      {versions.map(({ deliverable, summary }) => (
        <div className="flex min-w-0 items-center gap-3 py-3" key={deliverable.id}>
          <Badge variant="outline">v{deliverable.version}</Badge>
          <Badge variant="secondary">
            {deliverableStatus(locale, deliverable.status)}
          </Badge>
          <div className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {summary}
          </div>
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
        </div>
      ))}
    </div>
  );
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
