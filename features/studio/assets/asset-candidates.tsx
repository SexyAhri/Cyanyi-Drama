"use client";

import {
  Check,
  Download,
  ImageIcon,
  LoaderCircle,
  Maximize2,
  Trash2,
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

import { getStudioCopy } from "../i18n";
import { runtimeStatusToStageStatus } from "../stage-state";
import type { StudioLocale } from "../types";
import { StatusIndicator } from "../components/status-indicator";
import type {
  StudioAssetCandidate,
  StudioAssetEntity,
} from "./asset-view-model";

export function AssetCandidateGrid({
  deletingAssetId,
  entity,
  isSelecting,
  locale,
  onDelete,
  onSelect,
  tasks,
}: {
  deletingAssetId: string;
  entity: StudioAssetEntity;
  isSelecting: boolean;
  locale: StudioLocale;
  onDelete: (candidate: StudioAssetCandidate) => Promise<boolean>;
  onSelect: (candidate: StudioAssetCandidate) => void;
  tasks: MediaTask[];
}) {
  const copy = getStudioCopy(locale);
  const [deleteTarget, setDeleteTarget] =
    useState<StudioAssetCandidate | null>(null);
  const [previewTarget, setPreviewTarget] =
    useState<StudioAssetCandidate | null>(null);
  const visibleTasks = tasks.filter((task) => {
    if (entity.kind === "prop") return task.targetId === entity.id;
    return entity.candidates.some((candidate) => candidate.id === task.targetId);
  });
  const unmatchedTasks = visibleTasks.filter(
    (task) =>
      !entity.candidates.some(
        (candidate) =>
          candidate.id === task.targetId || candidate.assetId === task.output?.[0]?.id,
      ),
  );

  if (!entity.candidates.length && !unmatchedTasks.length) {
    return (
      <div className="flex min-h-48 items-center justify-center border-y px-6 text-center text-sm text-muted-foreground">
        {copy.noCandidates}
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {entity.candidates.map((candidate) => {
          const task = visibleTasks.find(
            (item) =>
              item.targetId === candidate.id ||
              item.output?.some((asset) => asset.id === candidate.assetId),
          );
          return (
            <Candidate
              candidate={candidate}
              deletingAssetId={deletingAssetId}
              isSelecting={isSelecting}
              key={candidate.id}
              locale={locale}
              onDelete={() => setDeleteTarget(candidate)}
              onPreview={() => setPreviewTarget(candidate)}
              onSelect={onSelect}
              task={task}
            />
          );
        })}
        {unmatchedTasks.map((task) => (
          <PendingCandidate key={task.id} locale={locale} task={task} />
        ))}
      </div>
      {previewTarget?.url ? (
        <MediaPreviewDialog
          alt={previewTarget.description || entity.name}
          description={previewTarget.description || entity.name}
          kind="image"
          onOpenChange={(open) => {
            if (!open) setPreviewTarget(null);
          }}
          open={Boolean(previewTarget)}
          title={entity.name}
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
                ? copy.deleteSelectedAssetDescription
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

function Candidate({
  candidate,
  deletingAssetId,
  isSelecting,
  locale,
  onDelete,
  onPreview,
  onSelect,
  task,
}: {
  candidate: StudioAssetCandidate;
  deletingAssetId: string;
  isSelecting: boolean;
  locale: StudioLocale;
  onDelete: () => void;
  onPreview: () => void;
  onSelect: (candidate: StudioAssetCandidate) => void;
  task?: MediaTask;
}) {
  const copy = getStudioCopy(locale);
  const status = task?.status ?? (candidate.url ? "succeeded" : "queued");
  const active = task && ["queued", "running"].includes(task.status);
  const deleteBusy = candidate.assetId === deletingAssetId;
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        candidate.selected && "border-foreground/40 ring-1 ring-foreground/15",
      )}
    >
      <div className="relative bg-muted/35">
        <AspectRatio ratio={4 / 3}>
          {candidate.url ? (
            <button
              aria-label={copy.previewMedia}
              className="group relative size-full cursor-zoom-in"
              onClick={onPreview}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={candidate.description || copy.candidates}
                className="size-full object-contain"
                src={candidate.url}
              />
              <span className="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-md bg-black/65 text-white opacity-80 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">
                <Maximize2 className="size-3.5" />
              </span>
            </button>
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              {status === "queued" || status === "running" ? (
                <LoaderCircle className="size-5 animate-spin" />
              ) : (
                <ImageIcon className="size-5" />
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
          status={runtimeStatusToStageStatus(status)}
        />
        <div className="ml-auto flex items-center gap-0.5">
          {candidate.url && candidate.assetId && !candidate.selected ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={copy.setAsSelected}
                    disabled={isSelecting}
                    onClick={() => onSelect(candidate)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                {isSelecting ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
              </TooltipTrigger>
              <TooltipContent>{copy.setAsSelected}</TooltipContent>
            </Tooltip>
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
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={copy.deleteMedia}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={Boolean(deletingAssetId) || Boolean(active)}
                    onClick={onDelete}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                {deleteBusy ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </TooltipTrigger>
              <TooltipContent>{copy.deleteMedia}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </figcaption>
      {task?.error?.message ? (
        <p className="border-t px-2.5 py-2 text-xs text-destructive">
          {task.error.message}
        </p>
      ) : null}
    </figure>
  );
}

function PendingCandidate({
  locale,
  task,
}: {
  locale: StudioLocale;
  task: MediaTask;
}) {
  return (
    <figure className="overflow-hidden rounded-lg border bg-card">
      <AspectRatio ratio={4 / 3}>
        <div className="flex size-full items-center justify-center bg-muted/35">
          {task.status === "queued" || task.status === "running" ? (
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" />
          )}
        </div>
      </AspectRatio>
      <figcaption className="flex min-h-11 items-center border-t px-2.5 py-1.5">
        <StatusIndicator
          locale={locale}
          status={runtimeStatusToStageStatus(task.status)}
        />
      </figcaption>
      {task.error?.message ? (
        <p className="border-t px-2.5 py-2 text-xs text-destructive">
          {task.error.message}
        </p>
      ) : null}
    </figure>
  );
}
