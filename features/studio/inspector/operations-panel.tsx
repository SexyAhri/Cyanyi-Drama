"use client";

import {
  Ban,
  CirclePause,
  CirclePlay,
  ListChecks,
  RotateCcw,
  ScanSearch,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { controlStudioMediaTask, controlStudioWorkflow } from "../api";
import { formatStudioDate } from "../i18n";
import { runtimeStatusToStageStatus } from "../stage-state";
import type { StudioLocale, WorkspaceSnapshot } from "../types";
import { StatusIndicator } from "../components/status-indicator";
import {
  buildOperationItems,
  type OperationItem,
} from "./inspector-view-model";

const copy = {
  "zh-CN": {
    active: "进行中",
    cancel: "取消",
    empty: "当前剧集还没有运行记录",
    failed: "失败",
    inspect: "查看 Trace",
    pause: "暂停",
    resume: "恢复",
    retry: "重试",
  },
  en: {
    active: "Active",
    cancel: "Cancel",
    empty: "No runs for this episode",
    failed: "Failed",
    inspect: "Inspect trace",
    pause: "Pause",
    resume: "Resume",
    retry: "Retry",
  },
} as const;

export function OperationsPanel({
  episodeId,
  locale,
  onRefresh,
  onTrace,
  snapshot,
}: {
  episodeId?: string;
  locale: StudioLocale;
  onRefresh: () => Promise<unknown> | void;
  onTrace: (traceId: string) => void;
  snapshot: WorkspaceSnapshot;
}) {
  const text = copy[locale];
  const [busyId, setBusyId] = useState("");
  const items = useMemo(
    () => buildOperationItems(snapshot, episodeId),
    [episodeId, snapshot],
  );
  const statuses = items.map((item) =>
    item.kind === "task" ? item.task.status : item.workflow.status,
  );
  const active = statuses.filter((status) =>
    ["canceling", "queued", "running"].includes(status),
  ).length;
  const failed = statuses.filter((status) =>
    ["blocked", "failed"].includes(status),
  ).length;

  async function run(item: OperationItem, action: string) {
    setBusyId(item.id);
    try {
      if (item.kind === "task") {
        await controlStudioMediaTask(item.id, action as "cancel" | "retry");
      } else {
        await controlStudioWorkflow(
          item.id,
          action as "cancel" | "pause" | "resume" | "retry",
        );
      }
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-2 border-b text-center">
        <Metric label={text.active} value={active} />
        <Metric label={text.failed} value={failed} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length ? (
          <div className="divide-y">
            {items.slice(0, 50).map((item) => (
              <OperationRow
                busy={busyId === item.id}
                item={item}
                key={`${item.kind}:${item.id}`}
                locale={locale}
                onAction={(action) => void run(item, action)}
                onTrace={() =>
                  onTrace(
                    item.kind === "task"
                      ? item.task.traceId
                      : item.workflow.traceId,
                  )
                }
                text={text}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <ListChecks className="size-5" />
            <p>{text.empty}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function OperationRow({
  busy,
  item,
  locale,
  onAction,
  onTrace,
  text,
}: {
  busy: boolean;
  item: OperationItem;
  locale: StudioLocale;
  onAction: (action: string) => void;
  onTrace: () => void;
  text: (typeof copy)[StudioLocale];
}) {
  const status = item.kind === "task" ? item.task.status : item.workflow.status;
  const label =
    item.kind === "task"
      ? (item.task.targetType ?? item.task.model)
      : item.workflow.workflowType;
  const traceId =
    item.kind === "task" ? item.task.traceId : item.workflow.traceId;
  return (
    <div className="px-3 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 truncate text-xs font-medium">
              {label}
            </p>
            <StatusIndicator
              compact
              locale={locale}
              status={runtimeStatusToStageStatus(status)}
            />
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{item.kind === "task" ? item.task.kind : "workflow"}</span>
            <span>{formatStudioDate(locale, item.updatedAt)}</span>
            {item.kind === "task" ? <span>{item.task.progress}%</span> : null}
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/75">
            {traceId}
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        {item.kind === "task" && ["queued", "running"].includes(status) ? (
          <Action
            disabled={busy}
            icon={Ban}
            label={text.cancel}
            onClick={() => onAction("cancel")}
          />
        ) : null}
        {item.kind === "task" && status === "failed" ? (
          <Action
            disabled={busy}
            icon={RotateCcw}
            label={text.retry}
            onClick={() => onAction("retry")}
          />
        ) : null}
        {item.kind === "workflow" && status === "running" ? (
          <Action
            disabled={busy}
            icon={CirclePause}
            label={text.pause}
            onClick={() => onAction("pause")}
          />
        ) : null}
        {item.kind === "workflow" && status === "paused" ? (
          <Action
            disabled={busy}
            icon={CirclePlay}
            label={text.resume}
            onClick={() => onAction("resume")}
          />
        ) : null}
        {item.kind === "workflow" &&
        ["queued", "running", "paused", "canceling"].includes(status) ? (
          <Action
            disabled={busy}
            icon={Ban}
            label={text.cancel}
            onClick={() => onAction("cancel")}
          />
        ) : null}
        {item.kind === "workflow" && ["blocked", "failed"].includes(status) ? (
          <Action
            disabled={busy}
            icon={RotateCcw}
            label={text.retry}
            onClick={() => onAction("retry")}
          />
        ) : null}
        <Action
          disabled={busy}
          icon={ScanSearch}
          label={text.inspect}
          onClick={onTrace}
        />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r px-3 py-3 last:border-r-0">
      <p className="font-mono text-base font-semibold">{value}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Action({
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: typeof Ban;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            size="icon-sm"
            type="button"
            variant="ghost"
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
