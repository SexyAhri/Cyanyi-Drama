import {
  AlertTriangle,
  ArrowUpRight,
  Clapperboard,
  Clock3,
  Layers3,
} from "lucide-react";
import Link from "next/link";

import type { ProjectRecord } from "@/lib/projects/types";
import { cn } from "@/lib/utils";

import { formatStudioDate, getStudioCopy } from "../i18n";
import type { StudioLocale, StudioStageStatus } from "../types";
import { StatusIndicator } from "./status-indicator";

export function ProjectItem({
  locale,
  project,
  view,
}: {
  locale: StudioLocale;
  project: ProjectRecord;
  view: "grid" | "list";
}) {
  const copy = getStudioCopy(locale);
  const status = runStatus(project.latestWorkflow?.status);
  const updatedAt = project.latestWorkflow?.updatedAt ?? project.updatedAt;

  return (
    <Link
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-card transition-colors hover:border-foreground/25 hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        view === "list" && "flex min-h-28",
      )}
      href={`/projects/${encodeURIComponent(project.id)}`}
    >
      <div
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden border-b bg-muted/35",
          view === "grid"
            ? "h-32 w-full"
            : "h-auto w-36 border-r border-b-0 sm:w-48",
        )}
      >
        <div className="absolute inset-x-0 top-0 flex h-6 items-center justify-between border-b border-border/70 px-2">
          <span className="flex gap-1" aria-hidden="true">
            <span className="size-1 rounded-full bg-foreground/30" />
            <span className="size-1 rounded-full bg-foreground/20" />
            <span className="size-1 rounded-full bg-foreground/15" />
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {project.config.videoRatio}
          </span>
        </div>
        <div
          className={cn(
            "mt-5 flex items-center justify-center border border-foreground/15 bg-background/70 shadow-sm",
            project.config.videoRatio === "9:16" ? "h-16 w-9" : "h-11 w-20",
          )}
        >
          <Clapperboard className="size-4 text-foreground/55" />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">{project.name}</h2>
            <p className="mt-1 line-clamp-2 min-h-5 text-xs leading-5 text-muted-foreground">
              {project.description || project.config.artStyle}
            </p>
          </div>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Layers3 className="size-3.5" />
            {project.episodeCount} {copy.episodeCount}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="size-3.5" />
            {formatStudioDate(locale, updatedAt)}
          </span>
          {project.failedTaskCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="size-3.5" />
              {project.failedTaskCount} {copy.failedTasks}
            </span>
          ) : (
            <StatusIndicator locale={locale} status={status} />
          )}
        </div>
      </div>
    </Link>
  );
}

function runStatus(status?: string): StudioStageStatus {
  if (!status) return "not_started";
  if (status === "succeeded") return "completed";
  if (status === "paused") return "paused";
  if (status === "failed" || status === "blocked") return "failed";
  if (["queued", "running", "canceling"].includes(status)) return "running";
  return "not_started";
}
