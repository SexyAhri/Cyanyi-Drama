"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  Clapperboard,
  Clock3,
  Film,
  Layers3,
  LoaderCircle,
  MoreHorizontal,
  Palette,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectRecord } from "@/lib/projects/types";
import { cn } from "@/lib/utils";

import { formatStudioDate, getStudioCopy } from "../i18n";
import type { StudioLocale, StudioStageStatus } from "../types";
import { StatusIndicator } from "./status-indicator";

export function ProjectItem({
  locale,
  onDelete,
  project,
  view,
}: {
  locale: StudioLocale;
  onDelete: (projectId: string) => Promise<void>;
  project: ProjectRecord;
  view: "grid" | "list";
}) {
  const copy = getStudioCopy(locale);
  const status = runStatus(project.latestWorkflow?.status);
  const updatedAt = project.latestWorkflow?.updatedAt ?? project.updatedAt;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const href = `/projects/${encodeURIComponent(project.id)}`;

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await onDelete(project.id);
      setDeleteOpen(false);
      toast.success(copy.projectDeleted);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.loadFailed);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <article
        className={cn(
          "group relative overflow-hidden rounded-md border bg-card transition-[border-color,box-shadow,background-color] hover:border-foreground/25 hover:bg-muted/15 hover:shadow-sm",
          view === "list" && "sm:min-h-28",
        )}
      >
        <Link
          aria-label={`${copy.openProject}: ${project.name}`}
          className={cn(
            "block h-full p-4 pr-14 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            view === "list" &&
              "sm:grid sm:grid-cols-[minmax(15rem,1fr)_minmax(14rem,0.8fr)_auto] sm:items-center sm:gap-6",
          )}
          href={href}
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/45 text-muted-foreground transition-colors group-hover:text-foreground">
              <Clapperboard className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-sm font-semibold leading-5">
                  {project.name}
                </h2>
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <StatusIndicator locale={locale} status={status} />
                <span aria-hidden="true">·</span>
                <span>{project.config.videoRatio}</span>
                <span aria-hidden="true">·</span>
                <span>{project.config.videoResolution}</span>
              </div>
            </div>
          </div>

          <div
            className={cn(
              "mt-4 min-w-0 border-t pt-3 sm:min-h-14",
              view === "list" &&
                "sm:mt-0 sm:border-t-0 sm:border-l sm:py-1 sm:pl-6",
            )}
          >
            <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
              {project.description || project.config.artStyle}
            </p>
            {project.description ? (
              <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/80">
                <Palette className="size-3 shrink-0" />
                <span className="truncate">{project.config.artStyle}</span>
              </p>
            ) : null}
          </div>

          <div
            className={cn(
              "mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground",
              view === "list" &&
                "sm:mt-0 sm:flex-col sm:items-start sm:border-t-0 sm:pt-0",
            )}
          >
            <Metadata icon={Layers3}>
              {project.episodeCount} {copy.episodeCount}
            </Metadata>
            <Metadata icon={Clock3}>{formatStudioDate(locale, updatedAt)}</Metadata>
            {project.failedTaskCount > 0 ? (
              <Metadata className="text-destructive" icon={AlertTriangle}>
                {project.failedTaskCount} {copy.failedTasks}
              </Metadata>
            ) : (
              <Metadata icon={Film}>{project.config.videoRatio}</Metadata>
            )}
          </div>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label={copy.projectActions}
                className="absolute top-3 right-3 z-10 text-muted-foreground opacity-70 hover:opacity-100 group-hover:opacity-100"
                size="icon-sm"
                type="button"
                variant="ghost"
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem render={<Link href={href} />}>
              <ArrowUpRight />
              {copy.openProject}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setDeleteOpen(true)}
              variant="destructive"
            >
              <Trash2 />
              {copy.deleteProject}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </article>

      <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>{copy.deleteProjectTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.deleteProjectDescription.replace("{name}", project.name)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {copy.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              variant="destructive"
            >
              {isDeleting ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Trash2 />
              )}
              {isDeleting ? copy.deletingProject : copy.deleteProject}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Metadata({
  children,
  className,
  icon: Icon,
}: React.PropsWithChildren<{
  className?: string;
  icon: typeof Clock3;
}>) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
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
