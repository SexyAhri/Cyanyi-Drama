"use client";

import {
  Ban,
  Check,
  Download,
  ImageIcon,
  LoaderCircle,
  RotateCcw,
  VideoIcon,
} from "lucide-react";

import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MediaTask } from "@/lib/media/task-contract";
import { cn } from "@/lib/utils";

import { StatusIndicator } from "../components/status-indicator";
import { getStudioCopy } from "../i18n";
import { runtimeStatusToStageStatus } from "../stage-state";
import type { StudioLocale } from "../types";
import type { ShotMediaCandidate } from "./shot-view-model";

export function ShotCandidateGrid({
  busyTaskId,
  candidates,
  isSelecting,
  locale,
  onSelect,
  onTaskAction,
}: {
  busyTaskId: string;
  candidates: ShotMediaCandidate[];
  isSelecting: boolean;
  locale: StudioLocale;
  onSelect: (candidate: ShotMediaCandidate) => void;
  onTaskAction: (task: MediaTask, action: "cancel" | "retry") => void;
}) {
  const copy = getStudioCopy(locale);
  if (!candidates.length) {
    return (
      <div className="flex min-h-56 items-center justify-center border-y px-6 text-center text-sm text-muted-foreground">
        {copy.noMediaCandidates}
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {candidates.map((candidate) => (
        <CandidateCard
          busyTaskId={busyTaskId}
          candidate={candidate}
          isSelecting={isSelecting}
          key={candidate.id}
          locale={locale}
          onSelect={onSelect}
          onTaskAction={onTaskAction}
        />
      ))}
    </div>
  );
}

function CandidateCard({
  busyTaskId,
  candidate,
  isSelecting,
  locale,
  onSelect,
  onTaskAction,
}: {
  busyTaskId: string;
  candidate: ShotMediaCandidate;
  isSelecting: boolean;
  locale: StudioLocale;
  onSelect: (candidate: ShotMediaCandidate) => void;
  onTaskAction: (task: MediaTask, action: "cancel" | "retry") => void;
}) {
  const copy = getStudioCopy(locale);
  const taskBusy = candidate.task?.id === busyTaskId;
  const active =
    candidate.task && ["queued", "running"].includes(candidate.task.status);
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        candidate.selected && "border-foreground/40 ring-1 ring-foreground/15",
      )}
    >
      <div className="relative bg-muted/35">
        <AspectRatio ratio={16 / 9}>
          {candidate.url && candidate.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={copy.images}
              className="size-full object-contain"
              src={candidate.url}
            />
          ) : candidate.url && candidate.kind === "video" ? (
            <video
              aria-label={copy.videos}
              className="size-full object-contain"
              controls
              preload="metadata"
              src={candidate.url}
            />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              {active ? (
                <LoaderCircle className="size-5 animate-spin" />
              ) : candidate.kind === "image" ? (
                <ImageIcon className="size-5" />
              ) : (
                <VideoIcon className="size-5" />
              )}
            </div>
          )}
        </AspectRatio>
        {candidate.selected ? (
          <Badge className="absolute top-2 left-2" variant="secondary">
            <Check className="size-3" />
            {copy.selectedAsset}
          </Badge>
        ) : null}
      </div>
      <figcaption className="flex min-h-11 items-center gap-2 border-t px-2.5 py-1.5">
        <StatusIndicator
          locale={locale}
          status={runtimeStatusToStageStatus(candidate.status)}
        />
        <div className="ml-auto flex items-center gap-0.5">
          {candidate.assetId && candidate.url && !candidate.selected ? (
            <IconAction
              disabled={isSelecting}
              icon={
                isSelecting ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )
              }
              label={copy.setAsSelected}
              onClick={() => onSelect(candidate)}
            />
          ) : null}
          {active && candidate.task ? (
            <IconAction
              disabled={taskBusy}
              icon={
                taskBusy ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Ban className="size-3.5" />
                )
              }
              label={copy.cancelTask}
              onClick={() => onTaskAction(candidate.task!, "cancel")}
            />
          ) : null}
          {candidate.task?.status === "failed" ? (
            <IconAction
              disabled={taskBusy}
              icon={
                taskBusy ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="size-3.5" />
                )
              }
              label={copy.retryFailed}
              onClick={() => onTaskAction(candidate.task!, "retry")}
            />
          ) : null}
          {candidate.url ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    aria-label={copy.download}
                    className={buttonVariants({
                      size: "icon-sm",
                      variant: "ghost",
                    })}
                    download
                    href={candidate.url}
                  />
                }
              >
                <Download className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>{copy.download}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </figcaption>
    </figure>
  );
}

function IconAction({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled: boolean;
  icon: React.ReactNode;
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
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
