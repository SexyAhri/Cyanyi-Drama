"use client";

import { Check, Download, ImageIcon, LoaderCircle } from "lucide-react";

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

import { getStudioCopy } from "../i18n";
import { runtimeStatusToStageStatus } from "../stage-state";
import type { StudioLocale } from "../types";
import { StatusIndicator } from "../components/status-indicator";
import type {
  StudioAssetCandidate,
  StudioAssetEntity,
} from "./asset-view-model";

export function AssetCandidateGrid({
  entity,
  isSelecting,
  locale,
  onSelect,
  tasks,
}: {
  entity: StudioAssetEntity;
  isSelecting: boolean;
  locale: StudioLocale;
  onSelect: (candidate: StudioAssetCandidate) => void;
  tasks: MediaTask[];
}) {
  const copy = getStudioCopy(locale);
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
            isSelecting={isSelecting}
            key={candidate.id}
            locale={locale}
            onSelect={onSelect}
            task={task}
          />
        );
      })}
      {unmatchedTasks.map((task) => (
        <PendingCandidate key={task.id} locale={locale} task={task} />
      ))}
    </div>
  );
}

function Candidate({
  candidate,
  isSelecting,
  locale,
  onSelect,
  task,
}: {
  candidate: StudioAssetCandidate;
  isSelecting: boolean;
  locale: StudioLocale;
  onSelect: (candidate: StudioAssetCandidate) => void;
  task?: MediaTask;
}) {
  const copy = getStudioCopy(locale);
  const status = task?.status ?? (candidate.url ? "succeeded" : "queued");
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
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={candidate.description || copy.candidates}
              className="size-full object-contain"
              src={candidate.url}
            />
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
