"use client";

import { useState } from "react";
import {
  Download,
  ImageIcon,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  Play,
  Video,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AgentToolCall } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

import type { AgentComposerReferenceImage } from "../composer";
import {
  getMediaToolPresentation,
  type MediaToolLifecycle,
} from "./media-tool-card-data";

export function MediaToolCard({
  embedded = false,
  onUseAsReferenceImage,
  toolCall,
}: {
  createdAt?: string;
  embedded?: boolean;
  onUseAsReferenceImage?: (referenceImage: AgentComposerReferenceImage) => void;
  toolCall: AgentToolCall;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const media = getMediaToolPresentation(toolCall);

  if (!media) return null;

  const title = media.kind === "image" ? "图片生成" : "视频生成";
  const canUseAsReference = Boolean(
    media.referenceImage && onUseAsReferenceImage,
  );

  function handleUseAsReference() {
    if (!media?.referenceImage || !onUseAsReferenceImage) return;
    onUseAsReferenceImage(media.referenceImage);
    toast.success("已设为参考图");
  }

  return (
    <>
      <figure
        className={cn(
          "w-full overflow-hidden rounded-lg border bg-card",
          !embedded && "mx-auto max-w-157",
          (media.lifecycle === "error" || media.lifecycle === "denied") &&
            "border-destructive/35",
        )}
      >
        <figcaption className="flex h-11 items-center gap-2 border-b px-3">
          <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {media.kind === "image" ? (
              <ImageIcon className="size-4" />
            ) : (
              <Video className="size-4" />
            )}
          </span>
          <span className="text-sm font-medium">{title}</span>
          <LifecycleStatus className="ml-auto" lifecycle={media.lifecycle} />
        </figcaption>

        <div className="relative bg-muted/35">
          <AspectRatio ratio={16 / 10}>
            {media.kind === "image" && media.previewSrc ? (
              <button
                aria-label="打开图片预览"
                className="flex size-full cursor-zoom-in items-center justify-center bg-black/[0.03] p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => setPreviewOpen(true)}
                type="button"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="生成图片"
                  className="max-h-full max-w-full rounded-md object-contain"
                  src={media.previewSrc}
                />
              </button>
            ) : media.kind === "video" && media.assetUrl ? (
              <video
                className="size-full bg-black object-contain"
                controls
                playsInline
                poster={media.previewSrc}
                preload="metadata"
                src={media.assetUrl}
              />
            ) : media.kind === "video" && media.previewSrc ? (
              <div className="relative size-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="生成视频预览"
                  className="size-full object-contain"
                  src={media.previewSrc}
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/10">
                  <span className="flex size-10 items-center justify-center rounded-full bg-background text-foreground shadow-sm">
                    <Play className="ml-0.5 size-4" fill="currentColor" />
                  </span>
                </span>
              </div>
            ) : (
              <MediaPlaceholder
                error={media.error}
                kind={media.kind}
                lifecycle={media.lifecycle}
              />
            )}
          </AspectRatio>
        </div>

        <div className="flex min-h-12 items-center gap-3 border-t px-3 py-2">
          <p
            className={cn(
              "min-w-0 flex-1 truncate text-xs text-muted-foreground",
              media.lifecycle === "error" && "text-destructive",
            )}
          >
            {media.error || lifecycleDescription(media.lifecycle, media.kind)}
          </p>
          <div className="flex shrink-0 items-center gap-0.5">
            {media.kind === "image" && media.previewSrc ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label="打开预览"
                      onClick={() => setPreviewOpen(true)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    />
                  }
                >
                  <Maximize2 className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>打开预览</TooltipContent>
              </Tooltip>
            ) : null}
            {canUseAsReference ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label="设为参考图"
                      onClick={handleUseAsReference}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    />
                  }
                >
                  <ImagePlus className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>设为参考图</TooltipContent>
              </Tooltip>
            ) : null}
            {media.assetUrl ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <a
                      aria-label="下载"
                      className={buttonVariants({
                        size: "icon-sm",
                        variant: "ghost",
                      })}
                      download
                      href={media.assetUrl}
                    />
                  }
                >
                  <Download className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>下载</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </figure>

      <Dialog onOpenChange={setPreviewOpen} open={previewOpen}>
        <DialogContent className="!flex h-[min(90dvh,900px)] w-[min(94vw,1200px)] max-w-[min(94vw,1200px)] items-stretch gap-0 overflow-hidden rounded-lg bg-black p-0 text-white ring-0 sm:max-w-[min(94vw,1200px)]">
          <DialogHeader className="sr-only">
            <DialogTitle>图片预览</DialogTitle>
            <DialogDescription>生成图片预览</DialogDescription>
          </DialogHeader>
          {media.kind === "image" && media.previewSrc ? (
            <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-4 sm:p-8">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="生成图片预览"
                className="size-full object-contain"
                src={media.previewSrc}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function LifecycleStatus({
  className,
  lifecycle,
}: {
  className?: string;
  lifecycle: MediaToolLifecycle;
}) {
  const error = lifecycle === "error" || lifecycle === "denied";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground",
        lifecycle === "success" && "text-status-success",
        lifecycle === "running" && "text-status-running",
        error && "text-destructive",
        className,
      )}
    >
      {lifecycle === "running" ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : error ? (
        <XCircle className="size-3.5" />
      ) : lifecycle === "success" ? (
        <span className="size-1.5 rounded-full bg-current" />
      ) : (
        <span className="size-1.5 rounded-full border border-current" />
      )}
      {lifecycleLabel(lifecycle)}
    </span>
  );
}

function MediaPlaceholder({
  error,
  kind,
  lifecycle,
}: {
  error?: string;
  kind: "image" | "video";
  lifecycle: MediaToolLifecycle;
}) {
  const failed = lifecycle === "error" || lifecycle === "denied";
  const Icon = failed ? XCircle : kind === "image" ? ImageIcon : Video;
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-md border bg-background text-muted-foreground",
          failed && "border-destructive/30 text-destructive",
        )}
      >
        {lifecycle === "running" ? (
          <LoaderCircle className="size-5 animate-spin" />
        ) : (
          <Icon className="size-5" />
        )}
      </span>
      <p
        className={cn(
          "max-w-sm text-sm text-muted-foreground",
          failed && "text-destructive",
        )}
      >
        {error || lifecycleDescription(lifecycle, kind)}
      </p>
    </div>
  );
}

function lifecycleLabel(lifecycle: MediaToolLifecycle) {
  if (lifecycle === "success") return "已完成";
  if (lifecycle === "running") return "生成中";
  if (lifecycle === "error") return "失败";
  if (lifecycle === "denied") return "已取消";
  return "等待中";
}

function lifecycleDescription(
  lifecycle: MediaToolLifecycle,
  kind: "image" | "video",
) {
  const label = kind === "image" ? "图片" : "视频";
  if (lifecycle === "success") return `${label}已生成`;
  if (lifecycle === "running") return `正在生成${label}`;
  if (lifecycle === "error") return `未返回可用的${label}结果`;
  if (lifecycle === "denied") return "任务已取消";
  return "等待任务开始";
}
