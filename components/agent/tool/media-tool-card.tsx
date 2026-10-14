"use client";

import { useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  Download,
  ImageIcon,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import type { AgentToolCall, MediaSafetyRetry } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

import type { AgentComposerReferenceImage } from "../composer";
import {
  getMediaToolPresentation,
  type MediaToolLifecycle,
} from "./media-tool-card-data";

export function MediaToolCard({
  hideProcessDetails = false,
  onUseAsReferenceImage,
  toolCall,
}: {
  hideProcessDetails?: boolean;
  createdAt?: string;
  onUseAsReferenceImage?: (referenceImage: AgentComposerReferenceImage) => void;
  toolCall: AgentToolCall;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const media = getMediaToolPresentation(toolCall);
  if (!media) return null;

  const label = media.kind === "image" ? "图片" : "视频";
  const canUseAsReference = Boolean(
    media.referenceImage && onUseAsReferenceImage,
  );
  const failed = media.lifecycle === "error" || media.lifecycle === "denied";

  function handleUseAsReference() {
    if (!media?.referenceImage || !onUseAsReferenceImage) return;
    onUseAsReferenceImage(media.referenceImage);
    toast.success("已设为参考图");
  }

  if (failed) {
    return (
      <MediaFailure
        error={media.error}
        kind={media.kind}
        lifecycle={media.lifecycle}
        safetyRetry={media.safetyRetry}
      />
    );
  }

  if (!media.assetUrl && !media.previewSrc) {
    return (
      <div
        aria-live="polite"
        className="flex min-h-16 w-fit max-w-full items-center gap-3 rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground"
        role="status"
      >
        <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
        <span>
          {media.safetyRetry ? "已调整描述，" : ""}
          {media.lifecycle === "running"
            ? `正在生成${label}…`
            : `等待${label}生成…`}
        </span>
      </div>
    );
  }

  return (
    <>
      <figure className="group/media relative w-fit max-w-full">
        {media.safetyRetry && !hideProcessDetails ? (
          <details className="mb-2 text-xs leading-relaxed text-muted-foreground">
            <summary className="cursor-pointer">
              首次尝试被安全检查拦截，已调整描述并重新生成
            </summary>
            <p className="mt-1 whitespace-pre-wrap break-anywhere rounded-lg bg-muted/50 p-2">
              {media.safetyRetry.revisedPrompt}
            </p>
          </details>
        ) : null}
        <div className="relative w-fit max-w-full overflow-hidden rounded-xl bg-muted/30">
          {media.kind === "image" && media.previewSrc ? (
            <button
              aria-label="打开图片预览"
              className="block w-fit max-w-full cursor-zoom-in rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setPreviewOpen(true)}
              type="button"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt="生成图片"
                className="block h-auto max-h-[min(68dvh,680px)] max-w-full rounded-xl object-contain"
                src={media.previewSrc}
              />
            </button>
          ) : media.kind === "video" && media.assetUrl ? (
            <video
              aria-label="生成视频"
              className="block max-h-[min(68dvh,680px)] w-full max-w-[560px] rounded-xl bg-black"
              controls
              playsInline
              poster={media.previewSrc}
              preload="metadata"
              src={media.assetUrl}
            />
          ) : media.previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="生成视频预览"
              className="block h-auto max-h-[min(68dvh,680px)] max-w-full rounded-xl object-contain"
              src={media.previewSrc}
            />
          ) : (
            <div className="flex h-48 w-72 max-w-full items-center justify-center text-muted-foreground">
              <Video className="size-8" />
            </div>
          )}
        </div>

        <figcaption className="mt-2 flex min-h-9 items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {media.kind === "image" ? (
              <ImageIcon className="size-3.5" />
            ) : (
              <Video className="size-3.5" />
            )}
            {label}已生成
          </span>
          <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-background/90 p-0.5 shadow-xs">
            {media.kind === "image" && media.previewSrc ? (
              <MediaAction
                label="放大预览"
                onClick={() => setPreviewOpen(true)}
                icon={Maximize2}
              />
            ) : null}
            {canUseAsReference ? (
              <MediaAction
                label="设为参考图"
                onClick={handleUseAsReference}
                icon={ImagePlus}
              />
            ) : null}
            {media.assetUrl ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <a
                      aria-label="下载"
                      className={cn(
                        buttonVariants({ size: "icon-sm", variant: "ghost" }),
                        "text-muted-foreground hover:text-foreground",
                      )}
                      download={assetDownloadFilename(
                        media.assetUrl,
                        toolCall.id,
                        media.kind === "image"
                          ? imageExtension(media.referenceImage?.format)
                          : "mp4",
                      )}
                      href={media.assetUrl}
                    />
                  }
                >
                  <Download className="size-4" />
                </TooltipTrigger>
                <TooltipContent>下载</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </figcaption>
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

function MediaAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Maximize2;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className="text-muted-foreground hover:text-foreground"
            onClick={onClick}
            size="icon-sm"
            type="button"
            variant="ghost"
          />
        }
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function MediaFailure({
  error,
  kind,
  lifecycle,
  safetyRetry,
}: {
  error?: string;
  kind: "image" | "video";
  lifecycle: MediaToolLifecycle;
  safetyRetry?: MediaSafetyRetry;
}) {
  const label = kind === "image" ? "图片" : "视频";
  const denied = lifecycle === "denied";
  const summary = denied ? `${label}生成已取消` : friendlyError(error, label);

  return (
    <Collapsible className="w-full min-w-0 max-w-[628px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
        <div
          aria-live="polite"
          className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            {safetyRetry ? `调整描述后仍未生成${label}。${summary}` : summary}
          </span>
        </div>
        {error && !denied ? (
          <CollapsibleTrigger className="group inline-flex shrink-0 items-center gap-1 rounded-sm py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            错误详情
            <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
        ) : null}
      </div>
      {error && !denied ? (
        <CollapsibleContent>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-anywhere border-l-2 border-border pl-4 font-sans text-xs leading-6 text-muted-foreground [overflow-wrap:anywhere]">
            {error}
          </pre>
          {safetyRetry ? (
            <div className="mt-2 border-l-2 border-border pl-4 text-xs leading-6 text-muted-foreground">
              <p>本次使用的提示词</p>
              <p className="whitespace-pre-wrap break-anywhere [overflow-wrap:anywhere]">
                {safetyRetry.revisedPrompt}
              </p>
            </div>
          ) : null}
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function friendlyError(error: string | undefined, label: string) {
  if (!error) return `${label}生成失败，请重试。`;
  const message = error.toLowerCase();
  if (
    /401|403|unauthori[sz]ed|forbidden|invalid.api.key|鉴权|密钥|权限/.test(
      message,
    )
  )
    return `${label}生成失败，请检查模型服务的密钥或权限。`;
  if (/429|rate.limit|quota|余额|额度|限流/.test(message))
    return `${label}生成失败，服务额度或请求频率已达上限。`;
  if (/timeout|timed.out|超时/.test(message))
    return `${label}生成超时，请稍后重试。`;
  if (
    /参考.*(?:拒绝|安全|违规)|input(?:image|video)sensitivecontentdetected/.test(
      message,
    )
  )
    return "参考素材未通过模型服务的安全检查，请更换素材后重试。";
  if (
    /content.policy|safety|sensitivecontentdetected|moderation|内容审核|安全检查|安全策略|被拒绝/.test(
      message,
    )
  )
    return `${label}生成被模型服务拒绝，请调整描述后重试。`;
  if (/network|fetch.failed|econn|连接失败|网络/.test(message))
    return `${label}生成失败，暂时无法连接模型服务。`;
  return `${label}生成失败，请重试或查看错误详情。`;
}

function imageExtension(format?: string) {
  const normalized = format?.trim().toLowerCase();
  if (normalized === "jpeg") return "jpg";
  return normalized === "jpg" || normalized === "webp" || normalized === "gif"
    ? normalized
    : "png";
}

function assetDownloadFilename(
  url: string,
  fallbackId: string,
  extension: string,
) {
  const encodedId = /\/api\/media\/assets\/([^/?]+)\/content(?:[?#]|$)/.exec(
    url,
  )?.[1];
  let assetId = fallbackId;
  if (encodedId) {
    try {
      assetId = decodeURIComponent(encodedId);
    } catch {
      assetId = encodedId;
    }
  }
  return `${assetId.replace(/[^a-zA-Z0-9._-]/g, "_")}.${extension}`;
}
