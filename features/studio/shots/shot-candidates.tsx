"use client";

import {
  Ban,
  Check,
  Download,
  ImageIcon,
  LoaderCircle,
  Maximize2,
  RotateCcw,
  Trash2,
  VideoIcon,
} from "lucide-react";
import { useState } from "react";

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
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { MediaPreviewDialog } from "@/components/ui/media-preview-dialog";
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
  deletingAssetId,
  candidates,
  isSelecting,
  locale,
  onDelete,
  onSelect,
  onTaskAction,
}: {
  busyTaskId: string;
  deletingAssetId: string;
  candidates: ShotMediaCandidate[];
  isSelecting: boolean;
  locale: StudioLocale;
  onDelete: (candidate: ShotMediaCandidate) => Promise<boolean>;
  onSelect: (candidate: ShotMediaCandidate) => void;
  onTaskAction: (task: MediaTask, action: "cancel" | "retry") => void;
}) {
  const copy = getStudioCopy(locale);
  const [deleteTarget, setDeleteTarget] =
    useState<ShotMediaCandidate | null>(null);
  const [previewTarget, setPreviewTarget] =
    useState<ShotMediaCandidate | null>(null);
  if (!candidates.length) {
    return (
      <div className="flex min-h-56 items-center justify-center border-y px-6 text-center text-sm text-muted-foreground">
        {copy.noMediaCandidates}
      </div>
    );
  }
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {candidates.map((candidate) => (
          <CandidateCard
            busyTaskId={busyTaskId}
            candidate={candidate}
            deletingAssetId={deletingAssetId}
            isSelecting={isSelecting}
            key={candidate.id}
            locale={locale}
            onDelete={() => setDeleteTarget(candidate)}
            onPreview={() => setPreviewTarget(candidate)}
            onSelect={onSelect}
            onTaskAction={onTaskAction}
          />
        ))}
      </div>

      {previewTarget?.url ? (
        <MediaPreviewDialog
          alt={copy.previewMedia}
          description={copy.previewMedia}
          kind={previewTarget.kind}
          onOpenChange={(open) => {
            if (!open) setPreviewTarget(null);
          }}
          open={Boolean(previewTarget)}
          title={copy.previewMedia}
          url={previewTarget.url}
        />
      ) : null}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !deletingAssetId) setDeleteTarget(null);
        }}
        open={Boolean(deleteTarget)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.deleteMediaTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.selected
                ? copy.deleteSelectedMediaDescription
                : copy.deleteMediaDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingAssetId)}>
              {copy.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(deletingAssetId)}
              onClick={async (event) => {
                event.preventDefault();
                if (!deleteTarget) return;
                if (await onDelete(deleteTarget)) setDeleteTarget(null);
              }}
              variant="destructive"
            >
              {deletingAssetId ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {deletingAssetId ? copy.deleting : copy.deleteMedia}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CandidateCard({
  busyTaskId,
  candidate,
  deletingAssetId,
  isSelecting,
  locale,
  onDelete,
  onPreview,
  onSelect,
  onTaskAction,
}: {
  busyTaskId: string;
  candidate: ShotMediaCandidate;
  deletingAssetId: string;
  isSelecting: boolean;
  locale: StudioLocale;
  onDelete: () => void;
  onPreview: () => void;
  onSelect: (candidate: ShotMediaCandidate) => void;
  onTaskAction: (task: MediaTask, action: "cancel" | "retry") => void;
}) {
  const copy = getStudioCopy(locale);
  const taskBusy = candidate.task?.id === busyTaskId;
  const deleteBusy = candidate.assetId === deletingAssetId;
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
          {candidate.url ? (
            <button
              aria-label={copy.previewMedia}
              className="group relative size-full cursor-zoom-in"
              onClick={onPreview}
              type="button"
            >
              {candidate.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={copy.images}
                  className="size-full object-contain"
                  src={candidate.url}
                />
              ) : (
                <video
                  aria-label={copy.videos}
                  className="size-full object-contain"
                  muted
                  playsInline
                  preload="metadata"
                  src={candidate.url}
                />
              )}
              <span className="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-md bg-black/65 text-white opacity-80 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">
                <Maximize2 className="size-3.5" />
              </span>
            </button>
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
          {candidate.assetId ? (
            <IconAction
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={Boolean(deletingAssetId) || Boolean(active)}
              icon={
                deleteBusy ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )
              }
              label={copy.deleteMedia}
              onClick={onDelete}
            />
          ) : null}
        </div>
      </figcaption>
    </figure>
  );
}

function IconAction({
  className,
  disabled,
  icon,
  label,
  onClick,
}: {
  className?: string;
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
            className={className}
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
