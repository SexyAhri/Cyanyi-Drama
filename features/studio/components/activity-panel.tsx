import { AudioLines, Bot, ImageIcon, ListChecks, Video } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";

import { formatStudioDate, getStudioCopy } from "../i18n";
import { runtimeStatusToStageStatus } from "../stage-state";
import type { StudioLocale, WorkspaceSnapshot } from "../types";
import { StatusIndicator } from "./status-indicator";

type ActivityItem =
  | {
      id: string;
      kind: "workflow";
      label: string;
      status: string;
      traceId: string;
      updatedAt: string;
    }
  | {
      id: string;
      kind: "task";
      label: string;
      progress: number;
      status: string;
      traceId: string;
      updatedAt: string;
      taskKind: string;
    };

export function ActivityPanel({
  locale,
  snapshot,
}: {
  locale: StudioLocale;
  snapshot: WorkspaceSnapshot;
}) {
  const copy = getStudioCopy(locale);
  const items = getActivityItems(snapshot);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Bot className="size-4 text-muted-foreground" />
        <h2 className="text-xs font-semibold">{copy.productionActivity}</h2>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {items.length}
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {items.length ? (
          <div className="divide-y">
            {items.map((item) => (
              <ActivityRow
                item={item}
                key={`${item.kind}-${item.id}`}
                locale={locale}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            <ListChecks className="size-5" />
            <p>{copy.noActivity}</p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function ActivityRow({
  item,
  locale,
}: {
  item: ActivityItem;
  locale: StudioLocale;
}) {
  const Icon =
    item.kind === "workflow"
      ? ListChecks
      : item.taskKind === "video"
        ? Video
        : item.taskKind === "audio" || item.taskKind === "lipsync"
          ? AudioLines
          : ImageIcon;

  return (
    <div className="px-3 py-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/40">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 truncate text-xs font-medium">
              {item.label}
            </p>
            <StatusIndicator
              compact
              locale={locale}
              status={runtimeStatusToStageStatus(item.status)}
            />
          </div>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{formatStudioDate(locale, item.updatedAt)}</span>
            {item.kind === "task" ? <span>{item.progress}%</span> : null}
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/75">
            {item.traceId}
          </p>
        </div>
      </div>
    </div>
  );
}

function getActivityItems(snapshot: WorkspaceSnapshot): ActivityItem[] {
  return [
    ...snapshot.workflows.map(
      (workflow): ActivityItem => ({
        id: workflow.id,
        kind: "workflow",
        label: workflow.workflowType,
        status: workflow.status,
        traceId: workflow.traceId,
        updatedAt: workflow.updatedAt,
      }),
    ),
    ...snapshot.tasks.map(
      (task): ActivityItem => ({
        id: task.id,
        kind: "task",
        label: task.targetType ?? task.model,
        progress: task.progress,
        status: task.status,
        taskKind: task.kind,
        traceId: task.traceId,
        updatedAt: task.updatedAt,
      }),
    ),
  ]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 30);
}
