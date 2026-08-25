"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  Download,
  ExternalLink,
  ImageIcon,
  ImagePlus,
  Loader2,
  Minus,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Video,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatImageRatioLabel } from "@/lib/agent/media-ratio";
import type { AgentToolCall } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

import type { AgentComposerReferenceImage } from "../composer";
import { JsonPreview } from "./tool-registry";

type ImageGenerationResult = {
  images?: Array<{
    format?: string;
    height?: number;
    url?: string;
    width?: number;
  }>;
  note?: string;
  requestParams?: Record<string, boolean | number | string | undefined>;
  status?: string;
};

type VideoGenerationResult = {
  format?: string;
  note?: string;
  providerStatus?: string;
  requestParams?: Record<string, boolean | number | string | undefined>;
  status?: string;
  taskId?: string;
  thumbnailUrl?: string;
  url?: string;
};

type WeatherResult = {
  condition?: string;
  humidity?: string;
  location?: string;
  source?: string;
  temperature?: string;
  wind?: string;
};

type MediaGenerationArgs = {
  duration?: string;
  format?: string;
  model?: string;
  prompt?: string;
  providerHint?: string;
  ratio?: string;
  referenceImages?: AgentComposerReferenceImage[];
  referenceImage?: AgentComposerReferenceImage;
  requestParams?: Record<string, boolean | number | string | undefined>;
  resolution?: string;
  style?: string;
  template?: string;
  templatePrompt?: string;
};

type MediaSummaryData = {
  assetUrl?: string;
  detailRows: Array<{ label: string; value: string }>;
  format?: string;
  kind: "image" | "video";
  note?: string;
  previewSrc?: string;
  prompt: string;
  provider?: string;
  ratio?: string;
  referenceImages: AgentComposerReferenceImage[];
  requestRows?: Array<{ label: string; value: string }>;
  resolutionLabel?: string;
  resultLabel: string;
  status?: string;
  taskId?: string;
};

export function renderImageGenerationResult(result: unknown) {
  const data = result as ImageGenerationResult;
  const images = data.images?.filter((image) => image.url) ?? [];

  if (!images.length) {
    return <JsonPreview value={result} />;
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {images.map((image) => {
          const url = image.url!;

          return (
            <div
              className="overflow-hidden rounded-lg border bg-muted/30"
              key={url}
            >
              <AspectRatio className="bg-muted" ratio={1}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="Generated image preview"
                  className="size-full object-cover"
                  src={url}
                />
              </AspectRatio>
              <div className="flex items-center justify-between gap-2 p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <ImageIcon className="size-4 text-muted-foreground" />
                  <span className="truncate text-xs text-muted-foreground">
                    {formatMediaMeta(
                      formatImageSize(image.width, image.height),
                      image.format,
                    )}
                  </span>
                </div>
                <ResultActions url={url} />
              </div>
            </div>
          );
        })}
      </div>
      <ResultNote note={data.note} status={data.status} />
    </div>
  );
}

export function renderVideoGenerationResult(result: unknown) {
  const data = result as VideoGenerationResult;

  if (!data.url && !data.thumbnailUrl) {
    return <JsonPreview value={result} />;
  }

  return (
    <div className="grid gap-3">
      <div className="overflow-hidden rounded-lg border bg-muted/30">
        <AspectRatio className="bg-muted" ratio={16 / 9}>
          {data.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Generated video preview"
              className="size-full object-cover"
              src={data.thumbnailUrl}
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Video className="size-8 text-muted-foreground" />
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/10">
            <div className="flex size-12 items-center justify-center rounded-full bg-background/90 shadow-sm">
              <Play className="ml-0.5 size-5" fill="currentColor" />
            </div>
          </div>
        </AspectRatio>
        <div className="flex items-center justify-between gap-2 p-2">
          <div className="flex min-w-0 items-center gap-2">
            <Video className="size-4 text-muted-foreground" />
            <span className="truncate text-xs text-muted-foreground">
              {formatMediaMeta("Video result", data.format)}
            </span>
          </div>
          {data.url ? <ResultActions url={data.url} /> : null}
        </div>
      </div>
      <ResultNote note={data.note} status={data.status} />
    </div>
  );
}

export function MediaGenerationToolCard({
  createdAt,
  embedded = false,
  toolCall,
  onUseAsReferenceImage,
}: {
  createdAt?: string;
  embedded?: boolean;
  toolCall: AgentToolCall;
  onUseAsReferenceImage?: (referenceImage: AgentComposerReferenceImage) => void;
}) {
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const summary = buildMediaSummaryData(toolCall);
  const lifecycleState = resolveMediaLifecycleState(
    toolCall.status,
    Boolean(summary?.assetUrl),
  );
  const isRunning = lifecycleState === "running";
  const isError = lifecycleState === "error" || lifecycleState === "denied";
  const hasAsset = Boolean(summary?.assetUrl);
  const hasPreview = Boolean(summary?.previewSrc);
  const completedCount = hasAsset ? 1 : 0;
  const totalCount = 1;
  const elapsedSeconds = useLiveElapsedSeconds(
    createdAt,
    lifecycleState === "running",
  );
  const elapsedLabel = formatElapsedDuration(elapsedSeconds);

  function handleUseAsReferenceImage() {
    if (!referenceImagePayload || !onUseAsReferenceImage) {
      return;
    }

    onUseAsReferenceImage(referenceImagePayload);
    toast.success("已设为参考图");
  }

  if (!summary) {
    return (
      <div className="rounded-xl border bg-background p-4 ring-1 ring-foreground/10">
        <JsonPreview value={{ args: toolCall.args, result: toolCall.result }} />
      </div>
    );
  }

  const referenceImagePayload =
    summary.kind === "image"
      ? buildReferenceImagePayload(toolCall, summary)
      : null;
  const canUseAsReferenceImage = Boolean(
    referenceImagePayload && onUseAsReferenceImage,
  );
  const kindLabel = summary.kind === "image" ? "图片" : "视频";
  const statusLabel = getMediaLifecycleLabel(
    lifecycleState,
    kindLabel,
    toolCall.status,
  );
  const progressWidth =
    lifecycleState === "error" ||
    lifecycleState === "success" ||
    lifecycleState === "denied"
      ? "100%"
      : toolCall.status === "running"
        ? "56%"
        : "18%";
  const resultDescription = hasAsset
    ? summary.resultLabel
    : lifecycleState === "error"
      ? toolCall.error || `${kindLabel}生成失败，请检查错误信息后重试`
      : lifecycleState === "denied"
        ? `${kindLabel}生成已取消，当前任务未执行`
        : toolCall.status === "done"
          ? `${kindLabel}生成已结束，但没有返回可预览结果`
          : lifecycleState === "running"
            ? `正在生成${kindLabel}，生成完成后会在这里显示预览`
            : toolCall.status === "approved"
              ? `任务已批准，等待${kindLabel}生成开始`
              : `任务已提交，等待${kindLabel}生成`;

  return (
    <>
      <div
        className={cn(
          "w-full rounded-2xl border bg-background p-4 ring-1 ring-foreground/10",
          !embedded && "max-w-157",
          isError && "border-destructive/30 ring-destructive/15",
        )}
      >
        <div className="space-y-0">
          <div
            className={cn(
              "rounded-t-xl rounded-b-none border-b-0 px-3 py-2",
              lifecycleState === "error" || lifecycleState === "denied"
                ? "border border-destructive/20 bg-destructive/6"
                : lifecycleState === "success"
                  ? "border border-emerald-200/80 bg-emerald-50/70"
                  : "border border-sky-200/80 bg-sky-50/70",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div
                className={cn(
                  "flex items-center gap-1.5 text-xs font-medium",
                  lifecycleState === "error" || lifecycleState === "denied"
                    ? "text-destructive"
                    : lifecycleState === "success"
                      ? "text-emerald-800"
                      : "text-sky-900",
                )}
              >
                {isError ? (
                  <XCircle className="size-3.5" />
                ) : isRunning ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                <span>{statusLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                {lifecycleState === "running" ? (
                  <span className="font-mono text-[11px] text-sky-700 tabular-nums">
                    已生成 {elapsedLabel}
                  </span>
                ) : null}
                <span
                  className={cn(
                    "text-xs font-medium",
                    lifecycleState === "error" || lifecycleState === "denied"
                      ? "text-destructive"
                      : lifecycleState === "success"
                        ? "text-emerald-700"
                        : "text-sky-700",
                  )}
                >
                  {lifecycleState === "error" || lifecycleState === "denied"
                    ? "失败"
                    : lifecycleState === "success"
                      ? "完成"
                      : `${completedCount}/${totalCount}`}
                </span>
              </div>
            </div>
            <div
              className={cn(
                "mt-1.5 h-1 overflow-hidden rounded-full",
                lifecycleState === "error" || lifecycleState === "denied"
                  ? "bg-destructive/10"
                  : lifecycleState === "success"
                    ? "bg-emerald-100"
                    : "bg-sky-100",
              )}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  lifecycleState === "error" || lifecycleState === "denied"
                    ? "bg-destructive"
                    : lifecycleState === "success"
                      ? "bg-emerald-500"
                      : "bg-sky-500",
                )}
                style={{ width: progressWidth }}
              />
            </div>
          </div>

          <div
            className={cn(
              "group cursor-pointer rounded-b-2xl rounded-t-none border border-t-0 bg-muted/15 p-3 transition-colors hover:bg-muted/25",
              lifecycleState === "error" || lifecycleState === "denied"
                ? "border-destructive/20"
                : lifecycleState === "success"
                  ? "border-emerald-200/80"
                  : "border-sky-200/80",
            )}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setOpen(true);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative w-full shrink-0 sm:w-40 md:w-44">
                <div className="absolute left-2 top-2 z-10 flex flex-wrap gap-1">
                  {summary.ratio ? <MetaBadge value={summary.ratio} /> : null}
                  {summary.resolutionLabel ? (
                    <MetaBadge value={summary.resolutionLabel} />
                  ) : null}
                </div>
                <AspectRatio
                  className="overflow-hidden rounded-xl border bg-background"
                  ratio={summary.kind === "image" ? 1 : 16 / 9}
                >
                  {hasPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt="Media generation preview"
                      className="size-full object-cover"
                      src={summary.previewSrc}
                    />
                  ) : summary.kind === "video" && hasAsset ? (
                    <div className="flex size-full items-center justify-center bg-muted/35 text-muted-foreground">
                      <Video className="size-8" />
                    </div>
                  ) : lifecycleState === "error" ||
                    lifecycleState === "denied" ? (
                    <FailurePreview
                      detail={false}
                      error={toolCall.error}
                      kind={summary.kind}
                    />
                  ) : (
                    <LoadingPreview kind={summary.kind} />
                  )}
                  {summary.kind === "video" && (hasPreview || hasAsset) ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/8">
                      <div className="flex size-10 items-center justify-center rounded-full bg-background/90 shadow-sm">
                        <Play className="ml-0.5 size-4" fill="currentColor" />
                      </div>
                    </div>
                  ) : null}
                </AspectRatio>
              </div>

              <div className="min-w-0 flex-1">
                <p className="line-clamp-3 text-sm leading-6 text-foreground">
                  {summary.prompt}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {summary.provider ? <span>{summary.provider}</span> : null}
                  {summary.referenceImages.length > 0 ? (
                    <Badge className="font-normal" variant="secondary">
                      {summary.referenceImages.length} 张参考图
                    </Badge>
                  ) : null}
                  {lifecycleState === "running" ? (
                    <span className="font-mono tabular-nums">
                      用时 {elapsedLabel}
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex min-w-0 items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {resultDescription}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      aria-label="Open details"
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpen(true);
                      }}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <ExternalLink />
                    </Button>
                    {canUseAsReferenceImage ? (
                      <Button
                        aria-label="Use as reference image"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleUseAsReferenceImage();
                        }}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <ImagePlus />
                      </Button>
                    ) : null}
                    {summary.assetUrl ? (
                      <MediaLinkButton
                        ariaLabel="Download result"
                        className="size-6 rounded-[min(var(--radius-md),10px)]"
                        download
                        href={summary.assetUrl}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                        variant="ghost"
                      >
                        <Download />
                      </MediaLinkButton>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="w-[min(96vw,1360px)] overflow-hidden p-0 sm:max-w-[min(96vw,1360px)]">
          <div className="grid max-h-[88vh] min-h-144 overflow-hidden md:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
            <div className="flex min-h-0 min-w-0 flex-col gap-3 bg-muted/25 p-4 md:p-5">
              <div className="flex min-h-6 flex-wrap gap-1">
                {summary.ratio ? <MetaBadge value={summary.ratio} /> : null}
                {summary.resolutionLabel ? (
                  <MetaBadge value={summary.resolutionLabel} />
                ) : null}
              </div>
              <div className="flex min-h-72 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-background p-3">
                {summary.assetUrl ? (
                  summary.kind === "video" &&
                  isLikelyVideoFile(summary.assetUrl) ? (
                    <video
                      className="max-h-[min(70vh,680px)] max-w-full rounded-xl object-contain"
                      controls
                      poster={summary.previewSrc ?? summary.assetUrl}
                      src={summary.assetUrl}
                    />
                  ) : (
                    <PreviewImageWithContextMenu
                      alt="Media generation detail preview"
                      className="max-h-[min(70vh,680px)] max-w-full rounded-xl object-contain"
                      onOpenPreview={() => setPreviewOpen(true)}
                      onUseAsReferenceImage={
                        canUseAsReferenceImage
                          ? handleUseAsReferenceImage
                          : undefined
                      }
                      src={summary.previewSrc ?? summary.assetUrl}
                    />
                  )
                ) : lifecycleState === "error" ||
                  lifecycleState === "denied" ? (
                  <div className="flex size-full items-center justify-center p-6">
                    <FailurePreview
                      detail
                      error={toolCall.error}
                      kind={summary.kind}
                    />
                  </div>
                ) : (
                  <div className="flex size-full items-center justify-center p-6">
                    <LoadingPreview detail kind={summary.kind} />
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-col">
              <DialogHeader className="border-b px-5 pb-4 pt-5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>输入内容</span>
                  <Button
                    aria-label="Copy prompt"
                    onClick={() => {
                      void navigator.clipboard.writeText(summary.prompt);
                      toast.success("已复制提示词");
                    }}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <Copy />
                  </Button>
                </div>
                <DialogTitle className="text-lg leading-7">
                  {summary.prompt}
                </DialogTitle>
                <DialogDescription>
                  {summary.provider
                    ? `来源：${summary.provider}`
                    : "媒体生成详情"}
                </DialogDescription>
              </DialogHeader>

              <ScrollArea
                className="min-h-0 flex-1"
                scrollbarClassName="w-2.5 translate-x-2 border-l-transparent pr-0"
                thumbClassName="bg-foreground/18 transition-colors hover:bg-foreground/28"
              >
                <div className="space-y-5 px-5 py-5">
                  {summary.referenceImages.length > 0 ? (
                    <section className="space-y-3">
                      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        参考图
                      </p>
                      <Card
                        className="shadow-none ring-1 ring-foreground/8"
                        size="sm"
                      >
                        <CardContent className="px-4 py-4">
                          <div className="space-y-4">
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-foreground">
                                本次生成共使用 {summary.referenceImages.length}{" "}
                                张参考图
                              </p>
                              <p className="text-xs text-muted-foreground">
                                换装这类任务建议同时放入人物底图和衣服参考图，模型更容易对齐主体与材质。
                              </p>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {summary.referenceImages.map(
                                (referenceImage, index) => (
                                  <div
                                    className="flex items-center gap-3 rounded-xl border bg-muted/20 p-3"
                                    key={referenceImage.url + String(index)}
                                  >
                                    <div className="w-18 shrink-0">
                                      <AspectRatio
                                        className="overflow-hidden rounded-xl border bg-muted"
                                        ratio={1}
                                      >
                                        <PreviewImageWithContextMenu
                                          alt={`Reference image preview ${index + 1}`}
                                          className="size-full object-cover"
                                          src={referenceImage.url}
                                        />
                                      </AspectRatio>
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-1">
                                      <p className="text-sm font-medium text-foreground">
                                        参考图 {index + 1}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {formatReferenceImageMeta(
                                          referenceImage,
                                        )}
                                      </p>
                                    </div>
                                  </div>
                                ),
                              )}
                            </div>
                            {canUseAsReferenceImage ? (
                              <div className="flex justify-end">
                                <Button
                                  onClick={handleUseAsReferenceImage}
                                  size="sm"
                                  type="button"
                                  variant="outline"
                                >
                                  <ImagePlus />
                                  设为参考图
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        </CardContent>
                      </Card>
                    </section>
                  ) : null}

                  <section className="space-y-3">
                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      参数配置
                    </p>
                    {summary.requestRows?.length ? (
                      <Card
                        className="shadow-none ring-1 ring-foreground/8"
                        size="sm"
                      >
                        <CardContent className="px-0 py-0">
                          <div className="border-b px-4 py-3 text-xs font-medium text-muted-foreground">
                            实际发送
                          </div>
                          <Table className="table-fixed">
                            <TableBody>
                              {summary.requestRows.map((row) => (
                                <TableRow key={row.label}>
                                  <TableCell className="w-28 whitespace-normal px-4 py-3 text-xs text-muted-foreground">
                                    {row.label}
                                  </TableCell>
                                  <TableCell className="min-w-0 whitespace-normal px-4 py-3 font-medium text-foreground">
                                    {renderDetailValue(row)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </CardContent>
                      </Card>
                    ) : null}
                    <Card
                      className="shadow-none ring-1 ring-foreground/8"
                      size="sm"
                    >
                      <CardContent className="px-0 py-0">
                        <div className="border-b px-4 py-3 text-xs font-medium text-muted-foreground">
                          选择与结果
                        </div>
                        <Table className="table-fixed">
                          <TableBody>
                            {summary.detailRows.map((row) => (
                              <TableRow key={row.label}>
                                <TableCell className="w-28 whitespace-normal px-4 py-3 text-xs text-muted-foreground">
                                  {row.label}
                                </TableCell>
                                <TableCell className="min-w-0 whitespace-normal wrap-break-word px-4 py-3 font-medium text-foreground">
                                  {row.label === "状态" ? (
                                    <Badge variant="outline">{row.value}</Badge>
                                  ) : (
                                    renderDetailValue(row)
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </section>

                  {!summary.assetUrl ? (
                    <div
                      className={cn(
                        "rounded-2xl p-4 text-sm",
                        lifecycleState === "error" ||
                          lifecycleState === "denied"
                          ? "border border-destructive/20 bg-destructive/6 text-destructive"
                          : "border border-dashed bg-muted/15 text-muted-foreground",
                      )}
                    >
                      {lifecycleState === "error"
                        ? `${kindLabel}生成失败。请检查上方错误信息与 API 配置，修正后可在消息下方点击“重新生成”再次尝试。`
                        : lifecycleState === "denied"
                          ? `${kindLabel}生成已被拒绝或取消，当前任务不会继续执行。`
                          : toolCall.status === "done"
                            ? `${kindLabel}任务已结束，但服务端没有返回可渲染结果。请检查 provider 返回值与解析逻辑。`
                            : `资源还在生成中。生成完成后，这里会显示可点击预览的大图，右键即可下载。`}
                    </div>
                  ) : null}
                </div>
              </ScrollArea>

              <div className="flex items-center justify-between gap-3 border-t bg-muted/25 px-5 py-4">
                <div className="text-xs text-muted-foreground">
                  {summary.taskId
                    ? `任务 ID：${summary.taskId}`
                    : "生成任务详情"}
                </div>
                <div className="flex items-center gap-2">
                  {canUseAsReferenceImage ? (
                    <Button
                      onClick={handleUseAsReferenceImage}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <ImagePlus />
                      设为参考图
                    </Button>
                  ) : null}
                  {summary.assetUrl ? (
                    summary.kind === "image" ? (
                      <Button
                        onClick={() => setPreviewOpen(true)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <ExternalLink />
                        打开预览
                      </Button>
                    ) : (
                      <MediaLinkButton
                        ariaLabel="Open result"
                        href={summary.assetUrl}
                        size="sm"
                        target="_blank"
                        variant="outline"
                      >
                        <ExternalLink />
                        打开结果
                      </MediaLinkButton>
                    )
                  ) : null}
                  {summary.assetUrl ? (
                    <MediaLinkButton
                      ariaLabel="Download result"
                      download
                      href={summary.assetUrl}
                      size="sm"
                      variant="outline"
                    >
                      <Download />
                      下载
                    </MediaLinkButton>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <FullscreenImagePreviewPortal
        alt="Media generation full preview"
        onClose={() => setPreviewOpen(false)}
        onUseAsReferenceImage={
          canUseAsReferenceImage ? handleUseAsReferenceImage : undefined
        }
        open={Boolean(
          summary.assetUrl && summary.kind === "image" && previewOpen,
        )}
        src={summary.assetUrl}
      />
    </>
  );
}

export function renderWeatherResult(result: unknown) {
  const data = result as WeatherResult;

  if (!data.location && !data.temperature) {
    return <JsonPreview value={result} />;
  }

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{data.location ?? "Weather"}</p>
          <p className="text-xs text-muted-foreground">
            {data.condition ?? "Current conditions"}
          </p>
        </div>
        {data.temperature ? (
          <span className="text-2xl font-semibold">{data.temperature}</span>
        ) : null}
      </div>
      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        {data.wind ? <span>Wind: {data.wind}</span> : null}
        {data.humidity ? <span>Humidity: {data.humidity}</span> : null}
      </div>
      {data.source ? <ResultNote note={data.source} /> : null}
    </div>
  );
}

function PreviewImageWithContextMenu({
  alt,
  className,
  onOpenPreview,
  onUseAsReferenceImage,
  src,
}: {
  alt: string;
  className?: string;
  onOpenPreview?: () => void;
  onUseAsReferenceImage?: () => void;
  src: string;
}) {
  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt}
      className={cn(
        "max-h-full max-w-full rounded-2xl object-contain",
        className,
      )}
      src={src}
    />
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger className="block">
        {onOpenPreview ? (
          <button
            className="block cursor-zoom-in"
            onClick={onOpenPreview}
            title="点击放大预览，右键打开菜单"
            type="button"
          >
            {image}
          </button>
        ) : (
          <div className="block">{image}</div>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        <ContextMenuItem
          onClick={async () => {
            await copyImageToClipboard(src);
          }}
        >
          <Copy />
          复制
        </ContextMenuItem>
        {onUseAsReferenceImage ? (
          <ContextMenuItem onClick={onUseAsReferenceImage}>
            <ImagePlus />
            设为参考图
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          onClick={async () => {
            await downloadFile(src);
          }}
        >
          <Download />
          下载
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FullscreenImagePreview({
  alt,
  onClose,
  onUseAsReferenceImage,
  src,
}: {
  alt: string;
  onClose: () => void;
  onUseAsReferenceImage?: () => void;
  src?: string;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
  });

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [src]);

  if (!src) {
    return null;
  }

  function clampScale(nextScale: number) {
    return Math.min(5, Math.max(1, Number(nextScale.toFixed(2))));
  }

  function clampOffset(
    nextOffset: { x: number; y: number },
    nextScale = scale,
  ) {
    if (!containerRef.current || !imageRef.current || nextScale <= 1) {
      return { x: 0, y: 0 };
    }

    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;
    const imageWidth = imageRef.current.clientWidth;
    const imageHeight = imageRef.current.clientHeight;
    const maxOffsetX = Math.max(
      0,
      (imageWidth * nextScale - containerWidth) / 2,
    );
    const maxOffsetY = Math.max(
      0,
      (imageHeight * nextScale - containerHeight) / 2,
    );

    return {
      x: Math.min(maxOffsetX, Math.max(-maxOffsetX, nextOffset.x)),
      y: Math.min(maxOffsetY, Math.max(-maxOffsetY, nextOffset.y)),
    };
  }

  function updateScale(nextScale: number) {
    const clampedScale = clampScale(nextScale);
    setScale(clampedScale);

    if (clampedScale === 1) {
      setOffset({ x: 0, y: 0 });
      return;
    }

    setOffset((currentOffset) => clampOffset(currentOffset, clampedScale));
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.2 : 0.2;
    updateScale(scale + delta);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (scale <= 1) {
      return;
    }

    dragStateRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: offset.x,
      startOffsetY: offset.y,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStateRef.current.active) {
      return;
    }

    setOffset(
      clampOffset({
        x:
          dragStateRef.current.startOffsetX +
          (event.clientX - dragStateRef.current.startX),
        y:
          dragStateRef.current.startOffsetY +
          (event.clientY - dragStateRef.current.startY),
      }),
    );
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStateRef.current.active) {
      return;
    }

    dragStateRef.current.active = false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleReset() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  const image = (
    <div
      className={cn(
        "flex max-h-full max-w-full select-none items-center justify-center transition-transform duration-150",
        scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
      )}
      onDoubleClick={() => {
        if (scale > 1) {
          handleReset();
          return;
        }

        updateScale(2);
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        transformOrigin: "center center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={alt}
        className="block max-h-[calc(100dvh-7rem)] max-w-[calc(100dvw-4rem)] rounded-2xl bg-white object-contain shadow-2xl"
        draggable={false}
        ref={imageRef}
        src={src}
      />
    </div>
  );

  return (
    <div className="relative flex h-full w-full flex-col bg-black/92">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-4">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-black/55 px-2 py-1 text-white shadow-lg backdrop-blur">
          <Button
            aria-label="Zoom out"
            disabled={scale <= 1}
            onClick={() => updateScale(scale - 0.25)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Minus />
          </Button>
          <span className="min-w-14 text-center text-xs font-medium tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <Button
            aria-label="Zoom in"
            disabled={scale >= 5}
            onClick={() => updateScale(scale + 0.25)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Plus />
          </Button>
          <Button
            aria-label="Reset zoom"
            onClick={handleReset}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <RotateCcw />
          </Button>
        </div>
      </div>

      <Button
        aria-label="Close preview"
        className="absolute right-4 top-4 z-10 rounded-full border border-white/10 bg-black/55 text-white shadow-lg backdrop-blur hover:bg-white/10 hover:text-white"
        onClick={onClose}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <XCircle />
      </Button>

      <ContextMenu>
        <ContextMenuTrigger className="flex flex-1 items-center justify-center overflow-hidden outline-none">
          <div
            className="flex h-full w-full items-center justify-center overflow-hidden p-4 sm:p-8"
            onWheel={handleWheel}
            ref={containerRef}
          >
            {image}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-40">
          <ContextMenuItem
            onClick={async () => {
              await copyImageToClipboard(src);
            }}
          >
            <Copy />
            复制
          </ContextMenuItem>
          {onUseAsReferenceImage ? (
            <ContextMenuItem onClick={onUseAsReferenceImage}>
              <ImagePlus />
              设为参考图
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem
            onClick={async () => {
              await downloadFile(src);
            }}
          >
            <Download />
            下载
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function FullscreenImagePreviewPortal({
  alt,
  onClose,
  onUseAsReferenceImage,
  open,
  src,
}: {
  alt: string;
  onClose: () => void;
  onUseAsReferenceImage?: () => void;
  open: boolean;
  src?: string;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-100 bg-black/92">
      <FullscreenImagePreview
        alt={alt}
        onClose={onClose}
        onUseAsReferenceImage={onUseAsReferenceImage}
        src={src}
      />
    </div>,
    document.body,
  );
}

async function copyImageToClipboard(src: string) {
  try {
    const response = await fetch(src);

    if (!response.ok) {
      throw new Error("Failed to fetch image.");
    }

    const blob = await response.blob();

    if ("ClipboardItem" in window) {
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type || "image/png"]: blob,
        }),
      ]);
      toast.success("已复制图片");
      return;
    }

    await navigator.clipboard.writeText(src);
    toast.success("当前浏览器不支持直接复制图片，已复制图片链接");
  } catch {
    try {
      await navigator.clipboard.writeText(src);
      toast.success("复制图片失败，已复制图片链接");
    } catch {
      toast.error("复制失败");
    }
  }
}

async function downloadFile(src: string) {
  let objectUrl: string | null = null;

  try {
    const response = await fetch(src);

    if (!response.ok) {
      throw new Error("Failed to fetch media.");
    }

    const blob = await response.blob();
    objectUrl = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = getDownloadFilename(src, blob.type);
    link.rel = "noreferrer";
    document.body.append(link);
    link.click();
    link.remove();
    toast.success("已开始下载图片");
  } catch {
    toast.error("下载失败，请检查资源链接或跨域配置");
  } finally {
    if (objectUrl) {
      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl!);
      }, 1000);
    }
  }
}

function buildMediaSummaryData(
  toolCall: AgentToolCall,
): MediaSummaryData | null {
  const args = (toolCall.args ?? {}) as MediaGenerationArgs;
  const referenceImages = sanitizeReferenceImages(
    args.referenceImages,
    args.referenceImage,
  );

  if (toolCall.name === "image_generation") {
    const result = (toolCall.result ?? {}) as ImageGenerationResult;
    const image = result.images?.find((item) => item.url);
    const resolutionLabel = getResolutionLabel(
      image?.width,
      image?.height,
      args.resolution,
    );
    const ratioLabel = formatImageRatioLabel(
      image?.width,
      image?.height,
      args.ratio,
    );

    return {
      detailRows: buildDetailRows({
        selectedModel: args.model,
        selectedRatio: args.ratio,
        selectedResolution: args.resolution,
        selectedFormat: args.format,
        style: args.style,
        resultRatio: ratioLabel,
        resultSize: resolutionLabel,
        resultFormat: image?.format ?? args.format,
        template:
          args.template && args.template !== "none" ? args.template : undefined,
      }),
      format: image?.format ?? args.format,
      kind: "image",
      note: result.note,
      prompt: getPromptText(args),
      provider: formatProvider(args.providerHint, args.model),
      ratio: ratioLabel,
      referenceImages,
      requestRows: buildRequestDetailRows(
        result.requestParams ?? args.requestParams ?? {},
      ),
      resolutionLabel,
      resultLabel: formatMediaMeta(
        formatImageSize(image?.width, image?.height, args.resolution),
        image?.format ?? args.format,
      ),
      assetUrl: image?.url,
      previewSrc: image?.url,
      status: formatMediaStatus(result.status ?? toolCall.status),
    };
  }

  if (toolCall.name === "video_generation") {
    const result = (toolCall.result ?? {}) as VideoGenerationResult;

    return {
      detailRows: buildDetailRows({
        model: args.model,
        ratio: args.ratio,
        resolution: args.resolution,
        format: result.format ?? args.format,
        duration: args.duration,
        taskId: result.taskId,
      }),
      format: result.format ?? args.format,
      kind: "video",
      note: result.note,
      prompt: getPromptText(args),
      provider: formatProvider(args.providerHint, args.model),
      ratio: args.ratio,
      referenceImages: [],
      requestRows: buildRequestDetailRows(
        result.requestParams ?? args.requestParams ?? {},
      ),
      resolutionLabel: args.resolution,
      resultLabel: formatMediaMeta("视频结果", result.format ?? args.format),
      assetUrl: result.url,
      previewSrc: result.thumbnailUrl ?? result.url,
      status: formatMediaStatus(
        result.providerStatus ?? result.status ?? toolCall.status,
      ),
      taskId: result.taskId,
    };
  }

  return null;
}

function sanitizeReferenceImages(
  referenceImages?: AgentComposerReferenceImage[],
  legacyReferenceImage?: AgentComposerReferenceImage,
) {
  const candidates = [
    ...(referenceImages ?? []),
    ...(legacyReferenceImage ? [legacyReferenceImage] : []),
  ];
  const seen = new Set<string>();

  return candidates
    .filter((referenceImage) => {
      const url = referenceImage?.url?.trim();

      if (!url || seen.has(url)) {
        return false;
      }

      seen.add(url);
      return true;
    })
    .map((referenceImage) => ({
      url: referenceImage.url,
      format: referenceImage.format,
      height: referenceImage.height,
      mimeType: referenceImage.mimeType,
      model: referenceImage.model,
      prompt: referenceImage.prompt,
      sourceToolCallId: referenceImage.sourceToolCallId,
      width: referenceImage.width,
    }));
}

function buildReferenceImagePayload(
  toolCall: AgentToolCall,
  summary: MediaSummaryData,
): AgentComposerReferenceImage | null {
  if (summary.kind !== "image" || !summary.assetUrl) {
    return null;
  }

  const args = (toolCall.args ?? {}) as MediaGenerationArgs;
  const result = (toolCall.result ?? {}) as ImageGenerationResult;
  const image =
    result.images?.find((item) => item.url === summary.assetUrl) ??
    result.images?.find((item) => item.url);

  return {
    url: summary.assetUrl,
    format: image?.format ?? summary.format,
    height: image?.height,
    model: args.model,
    prompt: getPromptText(args),
    sourceToolCallId: toolCall.id,
    width: image?.width,
  };
}

function buildDetailRows(
  rows: Record<string, boolean | number | string | undefined>,
) {
  return Object.entries(rows)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([label, value]) => ({
      label: mapDetailLabel(label),
      value: String(value),
    }));
}

function buildRequestDetailRows(
  rows: Record<string, boolean | number | string | undefined>,
) {
  return buildDetailRows(
    Object.fromEntries(
      Object.entries(rows).filter(
        ([label]) => label !== "prompt" && label !== "requestBody",
      ),
    ),
  );
}

function renderDetailValue(row: { label: string; value: string }) {
  if (row.label === "Body") {
    return (
      <pre className="max-h-64 max-w-full overflow-auto whitespace-pre-wrap wrap-break-word rounded-lg bg-muted/45 p-3 font-mono text-xs font-normal leading-5 text-foreground">
        {row.value}
      </pre>
    );
  }

  return <span className="wrap-break-word">{row.value}</span>;
}

function mapDetailLabel(label: string) {
  const labelMap: Record<string, string> = {
    duration: "时长",
    format: "格式",
    model: "模型",
    providerStatus: "Provider 状态",
    ratio: "比例",
    referenceCount: "参考图",
    resolution: "尺寸",
    source: "来源",
    status: "状态",
    style: "风格",
    taskId: "任务 ID",
    template: "模板",
  };

  const requestLabelMap: Record<string, string> = {
    contentType: "Content-Type",
    endpoint: "Endpoint",
    method: "Method",
    n: "数量",
    prompt: "Prompt",
    output_format: "Output Format",
    quality: "Quality",
    requestBody: "Body",
    requestUrl: "URL",
    response_format: "Response Format",
    resultFormat: "返回格式",
    resultRatio: "返回比例",
    resultSize: "返回尺寸",
    selectedFormat: "选择格式",
    selectedModel: "选择模型",
    selectedRatio: "选择比例",
    selectedResolution: "选择分辨率",
    size: "Size",
    stream: "Stream",
    temperature: "Temperature",
    top_p: "Top P",
    frequency_penalty: "Frequency Penalty",
    presence_penalty: "Presence Penalty",
  };

  return requestLabelMap[label] ?? labelMap[label] ?? label;
}

function getPromptText(args: MediaGenerationArgs) {
  return args.prompt?.trim() || args.templatePrompt?.trim() || "未提供输入内容";
}

function getResolutionLabel(
  width?: number,
  height?: number,
  fallback?: string,
) {
  if (width && height) {
    return `${width} x ${height}`;
  }

  return fallback;
}

function formatProvider(providerHint?: string, model?: string) {
  const normalizedProvider = providerHint
    ?.replaceAll("-", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  if (normalizedProvider && model) {
    return `${normalizedProvider} · ${model}`;
  }

  return normalizedProvider ?? model ?? undefined;
}

function formatReferenceImageMeta(referenceImage: AgentComposerReferenceImage) {
  return formatMediaMeta(
    formatImageSize(referenceImage.width, referenceImage.height, "参考图"),
    referenceImage.format,
  );
}

function getMediaLifecycleLabel(
  state: "denied" | "error" | "success" | "running" | "pending",
  kindLabel: string,
  toolStatus: AgentToolCall["status"],
) {
  if (state === "error") {
    return `${kindLabel}生成失败`;
  }

  if (state === "denied") {
    return `${kindLabel}生成已取消`;
  }

  if (state === "success") {
    return `${kindLabel}生成完成`;
  }

  if (state === "running") {
    return `${kindLabel}生成中`;
  }

  if (toolStatus === "approved") {
    return `${kindLabel}任务已批准`;
  }

  return `${kindLabel}任务已创建`;
}

function resolveMediaLifecycleState(
  toolStatus: AgentToolCall["status"],
  hasAsset: boolean,
) {
  if (toolStatus === "error") {
    return "error" as const;
  }

  if (toolStatus === "denied") {
    return "denied" as const;
  }

  if (hasAsset) {
    return "success" as const;
  }

  if (toolStatus === "running") {
    return "running" as const;
  }

  if (toolStatus === "done") {
    return "error" as const;
  }

  return "pending" as const;
}

function formatMediaStatus(status?: string) {
  if (!status) {
    return undefined;
  }

  const normalized = status.trim().toLowerCase();

  const statusMap: Record<string, string> = {
    approved: "已批准",
    complete: "已完成",
    completed: "已完成",
    denied: "已拒绝",
    done: "已完成",
    error: "失败",
    failed: "失败",
    finished: "已完成",
    pending: "等待中",
    processing: "处理中",
    queued: "排队中",
    ready: "已完成",
    running: "生成中",
    submitted: "已提交",
    success: "已完成",
    succeeded: "已完成",
  };

  return statusMap[normalized] ?? status;
}

function LoadingPreview({
  kind,
  detail = false,
}: {
  detail?: boolean;
  kind: "image" | "video";
}) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 bg-muted/35 text-muted-foreground">
      <Loader2 className={cn("animate-spin", detail ? "size-10" : "size-7")} />
      <div className="flex items-center gap-2 text-xs font-medium">
        {kind === "image" ? (
          <ImageIcon className="size-4" />
        ) : (
          <Video className="size-4" />
        )}
        <span>{kind === "image" ? "图片生成中" : "视频生成中"}</span>
      </div>
    </div>
  );
}

function FailurePreview({
  detail = false,
  error,
  kind,
}: {
  detail?: boolean;
  error?: string;
  kind: "image" | "video";
}) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 bg-destructive/6 px-4 text-center text-destructive">
      <XCircle className={cn(detail ? "size-10" : "size-7")} />
      <div className="space-y-1">
        <div className="text-xs font-medium">
          {kind === "image" ? "图片生成失败" : "视频生成失败"}
        </div>
        <div className="max-w-full break-words text-[11px] leading-5 text-destructive/80 [overflow-wrap:anywhere]">
          {error || "请检查错误信息后重试"}
        </div>
      </div>
    </div>
  );
}

function MetaBadge({ value }: { value: string }) {
  return (
    <span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm">
      {value}
    </span>
  );
}

function useLiveElapsedSeconds(startedAt?: string, active = false) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    getElapsedSeconds(startedAt),
  );

  useEffect(() => {
    setElapsedSeconds(getElapsedSeconds(startedAt));

    if (!active) {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds(getElapsedSeconds(startedAt));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [active, startedAt]);

  return elapsedSeconds;
}

function getElapsedSeconds(startedAt?: string) {
  if (!startedAt) {
    return 0;
  }

  const startedTime = new Date(startedAt).getTime();

  if (Number.isNaN(startedTime)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - startedTime) / 1000));
}

function formatElapsedDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function MediaLinkButton({
  ariaLabel,
  children,
  className,
  download,
  href,
  onClick,
  rel,
  size = "icon-xs",
  target,
  variant = "ghost",
}: {
  ariaLabel: string;
  children: React.ReactNode;
  className?: string;
  download?: boolean;
  href: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  rel?: string;
  size?: React.ComponentProps<typeof Button>["size"];
  target?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  return (
    <Button
      aria-label={ariaLabel}
      className={className}
      nativeButton={false}
      render={
        <a
          download={download}
          href={href}
          onClick={onClick}
          rel={rel}
          target={target}
        />
      }
      size={size}
      variant={variant}
    >
      {children}
    </Button>
  );
}

function ResultActions({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-1">
      <MediaLinkButton
        ariaLabel="Open result"
        href={url}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLink />
      </MediaLinkButton>
      <MediaLinkButton ariaLabel="Download result" download href={url}>
        <Download />
      </MediaLinkButton>
    </div>
  );
}

function ResultNote({ note, status }: { note?: string; status?: string }) {
  if (!note && !status) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
      {status ? <Badge variant="outline">{status}</Badge> : null}
      {note ? <span>{note}</span> : null}
    </div>
  );
}

function formatImageSize(width?: number, height?: number, fallback?: string) {
  if (!width || !height) {
    return fallback ?? "图片结果";
  }

  return `${width} x ${height}`;
}

function formatMediaMeta(label: string, format?: string) {
  if (!format) {
    return label;
  }

  return `${label} · ${format.toUpperCase()}`;
}

function getDownloadFilename(src: string, mimeType?: string) {
  try {
    const pathname = new URL(src).pathname;
    const lastSegment = pathname.split("/").pop()?.trim();

    if (lastSegment) {
      return decodeURIComponent(lastSegment);
    }
  } catch {
    if (src.startsWith("data:")) {
      return `media.${mimeTypeToExtension(mimeType || "image/png") || "png"}`;
    }
  }

  return `media.${mimeTypeToExtension(mimeType || "image/png") || "png"}`;
}

function mimeTypeToExtension(mimeType: string) {
  const normalized = mimeType.trim().toLowerCase().split(";")[0];

  if (normalized === "image/jpeg") {
    return "jpg";
  }

  if (normalized === "image/svg+xml") {
    return "svg";
  }

  if (normalized === "video/quicktime") {
    return "mov";
  }

  if (normalized.includes("/")) {
    return normalized.split("/")[1];
  }

  return "";
}

function isLikelyVideoFile(url: string) {
  return /\.(mp4|mov|webm)(?:$|\?)/i.test(url);
}
