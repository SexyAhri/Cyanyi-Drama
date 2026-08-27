"use client";

import {
  Ban,
  CirclePause,
  CirclePlay,
  ListChecks,
  RotateCcw,
  ScanSearch,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  controlStudioMediaTask,
  controlStudioWorkflow,
  deleteStudioMediaTask,
  deleteStudioWorkflow,
} from "../api";
import { formatStudioDate } from "../i18n";
import { runtimeStatusToStageStatus } from "../stage-state";
import type { StudioLocale, WorkspaceSnapshot } from "../types";
import { mediaTaskLabel, workflowLabel } from "../workflow-labels";
import { StatusIndicator } from "../components/status-indicator";
import {
  buildOperationItems,
  type OperationItem,
} from "./inspector-view-model";

const copy = {
  "zh-CN": {
    active: "进行中",
    actionFailed: "操作失败",
    cancel: "取消",
    confirmDelete: "确认删除",
    delete: "删除",
    deleteDescription: "将永久删除此任务记录及关联数据，且无法撤销。",
    deleteSuccess: "任务已删除",
    deleteTitle: "删除任务记录？",
    empty: "当前剧集还没有运行记录",
    failed: "失败",
    inspect: "查看 Trace",
    pause: "暂停",
    resume: "恢复",
    retry: "重试",
  },
  en: {
    active: "Active",
    actionFailed: "Action failed",
    cancel: "Cancel",
    confirmDelete: "Delete",
    delete: "Delete",
    deleteDescription:
      "This permanently deletes the task record and its related data.",
    deleteSuccess: "Task deleted",
    deleteTitle: "Delete task record?",
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
  const [deleteItem, setDeleteItem] = useState<OperationItem | null>(null);
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
      if (action === "delete") {
        if (item.kind === "task") await deleteStudioMediaTask(item.id);
        else await deleteStudioWorkflow(item.id);
      } else if (item.kind === "task") {
        await controlStudioMediaTask(item.id, action as "cancel" | "retry");
      } else {
        await controlStudioWorkflow(
          item.id,
          action as "cancel" | "pause" | "resume" | "retry",
        );
      }
      await onRefresh();
      if (action === "delete") {
        setDeleteItem(null);
        toast.success(text.deleteSuccess);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text.actionFailed);
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
                onDelete={() => setDeleteItem(item)}
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
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !busyId) setDeleteItem(null);
        }}
        open={Boolean(deleteItem)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{text.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {text.deleteDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busyId)}>
              {text.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!deleteItem || Boolean(busyId)}
              onClick={() => {
                if (deleteItem) void run(deleteItem, "delete");
              }}
              variant="destructive"
            >
              <Trash2 />
              {text.confirmDelete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function OperationRow({
  busy,
  item,
  locale,
  onAction,
  onDelete,
  onTrace,
  text,
}: {
  busy: boolean;
  item: OperationItem;
  locale: StudioLocale;
  onAction: (action: string) => void;
  onDelete: () => void;
  onTrace: () => void;
  text: (typeof copy)[StudioLocale];
}) {
  const status = item.kind === "task" ? item.task.status : item.workflow.status;
  const label =
    item.kind === "task"
      ? mediaTaskLabel(locale, item.task.targetType, item.task.kind)
      : workflowLabel(locale, item.workflow.workflowType);
  const errorMessage = operationErrorMessage(
    item.kind === "task" ? item.task.error : item.workflow.error,
    locale,
  );
  const canDelete =
    item.kind === "task"
      ? ["canceled", "failed"].includes(status)
      : ["blocked", "canceled", "failed", "succeeded"].includes(status);
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
            <span>{formatStudioDate(locale, item.updatedAt)}</span>
            {item.kind === "task" ? <span>{item.task.progress}%</span> : null}
          </div>
          {errorMessage ? (
            <p
              className="mt-1 line-clamp-2 text-[10px] leading-4 text-destructive"
              title={errorMessage}
            >
              {errorMessage}
            </p>
          ) : null}
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
        {canDelete ? (
          <Action
            danger
            disabled={busy}
            icon={Trash2}
            label={text.delete}
            onClick={onDelete}
          />
        ) : null}
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
  danger,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  danger?: boolean;
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
            className={
              danger ? "text-destructive hover:text-destructive" : undefined
            }
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

function operationErrorMessage(
  error: Record<string, unknown> | undefined,
  locale: StudioLocale,
) {
  const message =
    typeof error?.message === "string" ? error.message.trim() : "";
  if (!message) return "";
  const timeout = message.match(/^STRUCTURED_PROVIDER_TIMEOUT:(\d+)$/);
  if (timeout) {
    const seconds = Math.round(Number(timeout[1]) / 1_000);
    return locale === "zh-CN"
      ? `模型响应超时（${seconds} 秒）`
      : `Model response timed out (${seconds}s)`;
  }
  if (/aborted due to timeout|timed out/i.test(message))
    return locale === "zh-CN" ? "模型响应超时" : "Model response timed out";
  return message;
}
