import {
  Circle,
  CircleCheck,
  CircleDashed,
  CirclePause,
  CircleX,
  TriangleAlert,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { getStageStatusCopy } from "../i18n";
import type { StudioLocale, StudioStageStatus } from "../types";

const styles: Record<StudioStageStatus, string> = {
  not_started: "text-muted-foreground",
  ready: "text-status-info",
  running: "text-status-running",
  paused: "text-status-warning",
  completed: "text-status-success",
  canceled: "text-muted-foreground",
  failed: "text-destructive",
  blocked: "text-muted-foreground",
};

export function StatusIndicator({
  className,
  compact = false,
  locale,
  status,
}: {
  className?: string;
  compact?: boolean;
  locale: StudioLocale;
  status: StudioStageStatus;
}) {
  const Icon =
    status === "completed"
      ? CircleCheck
      : status === "failed"
        ? TriangleAlert
        : status === "canceled"
          ? CircleX
          : status === "paused"
            ? CirclePause
            : status === "running"
              ? CircleDashed
              : Circle;

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-xs font-medium",
        styles[status],
        className,
      )}
    >
      <Icon
        className={cn(
          "size-3.5 shrink-0",
          status === "running" && "animate-spin",
        )}
      />
      {compact ? null : <span>{getStageStatusCopy(locale, status)}</span>}
    </span>
  );
}
