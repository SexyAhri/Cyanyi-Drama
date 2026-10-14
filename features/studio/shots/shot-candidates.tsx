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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import { StatusIndicator } from "../components/status-indicator";
import { formatStudioDate, getStudioCopy } from "../i18n";
import { runtimeStatusToStageStatus } from "../stage-state";
import { mediaTaskExecutionPhaseLabel } from "../workflow-labels";
import type { StudioLocale } from "../types";
import {
  shotCandidateSnapshot,
  type ShotMediaCandidate,
} from "./shot-view-model";

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
  const [deleteTarget, setDeleteTarget] = useState<ShotMediaCandidate | null>(
    null,
  );
  const [previewTarget, setPreviewTarget] = useState<ShotMediaCandidate | null>(
    null,
  );
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
  const snapshot = shotCandidateSnapshot(candidate);
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
        {candidate.selected || candidate.segmentIndex !== undefined ? (
          <Badge className="absolute top-2 left-2" variant="secondary">
            {candidate.selected ? <Check className="size-3" /> : null}
            {candidate.segmentIndex === undefined
              ? copy.selectedAsset
              : locale === "en"
                ? `Segment ${candidate.segmentIndex + 1}/${candidate.segmentCount}`
                : `片段 ${candidate.segmentIndex + 1}/${candidate.segmentCount}`}
          </Badge>
        ) : null}
      </div>
      {candidate.configurationStale ? (
        <p className="border-t bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {locale === "en"
            ? "Generated from older source, references, or settings. Review before selecting, or regenerate from the current version."
            : "该产物基于旧剧本、引用素材或配置生成；选用前请复核，或基于当前版本重新生成。"}
        </p>
      ) : null}
      {active && candidate.task ? (
        <p
          className="border-t px-3 py-1.5 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {mediaTaskExecutionPhaseLabel(locale, candidate.task.executionPhase)}{" "}
          · {candidate.task.progress}%
        </p>
      ) : null}
      {snapshot ? (
        <Accordion className="border-t">
          <AccordionItem value={`snapshot-${candidate.id}`}>
            <AccordionTrigger className="px-3 py-2 text-xs">
              {locale === "en"
                ? "Frozen input and configuration"
                : "冻结输入与配置版本"}
            </AccordionTrigger>
            <AccordionContent className="grid min-w-0 gap-2 px-3 text-xs">
              <dl className="grid min-w-0 gap-x-3 gap-y-1 sm:grid-cols-2">
                <SnapshotDetail
                  label={locale === "en" ? "Task" : "请求 ID"}
                  value={snapshot.taskId}
                />
                <SnapshotDetail
                  label={locale === "en" ? "Model" : "模型"}
                  value={`${snapshot.provider} · ${snapshot.model}`}
                />
                <SnapshotDetail
                  label={locale === "en" ? "Created" : "创建时间"}
                  value={formatStudioDate(locale, candidate.createdAt)}
                />
                {snapshot.inputHash ? (
                  <SnapshotDetail
                    label={locale === "en" ? "Input fingerprint" : "输入指纹"}
                    value={snapshot.inputHash}
                  />
                ) : null}
                {snapshot.configurationHash ? (
                  <SnapshotDetail
                    label={
                      locale === "en" ? "Configuration fingerprint" : "配置指纹"
                    }
                    value={snapshot.configurationHash}
                  />
                ) : null}
              </dl>
              {snapshot.configurationSources.length ? (
                <div className="min-w-0 rounded-md bg-muted/50 p-2">
                  <p className="font-medium">
                    {locale === "en"
                      ? "Published configuration versions"
                      : "配置来源版本"}
                  </p>
                  <ul className="mt-1 grid gap-1 text-muted-foreground">
                    {snapshot.configurationSources.map((source) => (
                      <li
                        className="break-all"
                        key={`${source.scopeKey}-${source.version}`}
                      >
                        {source.scopeKey} · v{source.version}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {snapshot.prompt ? (
                <div className="min-w-0 rounded-md bg-muted/50 p-2">
                  <p className="font-medium">
                    {locale === "en" ? "Frozen prompt" : "冻结提示词"}
                  </p>
                  <p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-anywhere text-muted-foreground">
                    {snapshot.prompt}
                  </p>
                </div>
              ) : null}
              {Object.keys(snapshot.parameters).length ? (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-anywhere rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-5">
                  {JSON.stringify(snapshot.parameters, null, 2)}
                </pre>
              ) : null}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}
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

function SnapshotDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono">{value}</dd>
    </div>
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
