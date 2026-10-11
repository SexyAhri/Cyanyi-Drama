"use client";
import type { PointerEvent } from "react";
import {
  AudioLines,
  Clapperboard,
  FileText,
  ImageIcon,
  Video,
  UserRound,
  MapPin,
  Package,
  Plus,
  LoaderCircle,
  Maximize2,
} from "lucide-react";
import { useState } from "react";
import { MediaPreviewDialog } from "@/components/ui/media-preview-dialog";
import type { MediaTask } from "@/lib/media/task-contract";
import type { ProjectMediaAsset, StudioLocale } from "../types";
import type { CanvasCard } from "./types";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  PORT_Y,
  kindLabel,
} from "./canvas-view-model";

export function CanvasNode({
  node,
  media,
  task,
  selected,
  connecting,
  target,
  locale,
  onSelect,
  onDrag,
  onConnect,
  onComplete,
  onBranch,
  busy,
  linkedPrompt,
  summary,
  durationSeconds,
  usageCount,
  inputs,
}: {
  node: CanvasCard;
  media?: ProjectMediaAsset;
  task?: MediaTask;
  selected: boolean;
  connecting: boolean;
  target: boolean;
  locale: StudioLocale;
  onSelect: (add: boolean) => void;
  onDrag: (event: PointerEvent<HTMLButtonElement>) => void;
  onConnect: (event?: PointerEvent<HTMLButtonElement>) => void;
  onComplete: () => void;
  onBranch: (kind: "image" | "video") => void;
  busy: boolean;
  linkedPrompt?: string;
  summary?: string;
  durationSeconds?: number | null;
  usageCount?: number;
  inputs: string[];
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const Icon = {
    text: FileText,
    panel: Clapperboard,
    image: ImageIcon,
    video: Video,
    audio: AudioLines,
    character: UserRound,
    location: MapPin,
    prop: Package,
  }[node.kind];
  const status = task
    ? {
        queued: locale === "en" ? "Queued" : "排队中",
        running: `${locale === "en" ? "Generating" : "生成中"} ${task.progress}%`,
        succeeded: locale === "en" ? "Ready" : "生成完成",
        failed: locale === "en" ? "Failed" : "生成失败",
        canceled: locale === "en" ? "Canceled" : "已取消",
      }[task.status]
    : media?.url
      ? node.kind === "image" && node.id.startsWith("episode-asset-image-") && media.sourceTargetId !== node.id
        ? locale === "en" ? "Using project image" : "复用项目素材"
        : locale === "en"
        ? "Ready"
        : "已有素材"
      : ["image", "video", "panel"].includes(node.kind)
        ? locale === "en"
          ? "Draft"
          : "待生成"
        : kindLabel(node.kind, locale);
  const previewText = summary || (node.kind === "video" ? node.videoText : linkedPrompt || node.text);
  return (
    <section
      data-node-id={node.id}
      className={`group absolute rounded-xl border bg-card shadow-sm transition-shadow ${selected ? "z-10 ring-2 ring-primary" : "hover:shadow-md"}`}
      style={{
        left: node.x,
        top: node.y,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      }}
      onClick={(event) => {
        if (
          !(
            event.target instanceof Element &&
            event.target.closest("button,video,audio")
          )
        )
          onSelect(event.shiftKey || event.ctrlKey || event.metaKey);
      }}
    >
      {selected && !["audio", "video"].includes(node.kind) && (
        <details
          className="absolute -right-12 top-20 z-20"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <summary
            aria-label={
              locale === "en" ? "Create a branch" : "从此节点创建分支"
            }
            title={locale === "en" ? "Create a branch" : "添加下游创作节点"}
            className="flex size-8 cursor-pointer list-none items-center justify-center rounded-full border bg-background shadow-sm focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden"
          >
            <Plus className="size-4" />
          </summary>
          <div className="absolute left-10 top-0 w-32 rounded-lg border bg-background p-1 shadow-lg">
            {(["image", "video"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                disabled={busy}
                onClick={(event) => {
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                  onBranch(kind);
                }}
                className="block w-full rounded-md px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-50"
              >
                {kind === "image"
                  ? locale === "en"
                    ? "Image branch"
                    : "创作图片"
                  : locale === "en"
                    ? "Video branch"
                    : "制作视频"}
              </button>
            ))}
          </div>
        </details>
      )}
      <button
        type="button"
        data-connection-target={node.id}
        aria-label={`${locale === "en" ? "Connect to" : "连接到"}${node.title}`}
        title={locale === "en" ? "Input" : "输入端口"}
        className="absolute -left-4 z-10 flex size-8 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-primary"
        style={{ top: PORT_Y - 16 }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onComplete();
        }}
      >
        <span
          className={`size-4 rounded-full border-2 border-background bg-muted-foreground ${target ? "ring-4 ring-primary bg-primary" : ""}`}
        />
      </button>
      <button
        type="button"
        data-connection-source={node.id}
        aria-label={`${locale === "en" ? "Connect from" : "从此节点开始连线"} ${node.title}`}
        title={
          locale === "en"
            ? "Drag to an input port"
            : "拖到目标输入端口，或点击后再点输入端口"
        }
        className="absolute -right-4 z-10 flex size-8 touch-none items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-primary"
        style={{ top: PORT_Y - 16 }}
        onPointerDown={onConnect}
        onClick={(event) => {
          event.stopPropagation();
          if (event.detail === 0) onConnect();
        }}
      >
        <span
          className={`size-4 rounded-full border-2 border-background bg-primary ${connecting ? "ring-4 ring-primary/30" : ""}`}
        />
      </button>
      <button
        type="button"
        className="flex h-10 w-full cursor-grab touch-none items-center gap-2 rounded-t-xl border-b px-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={onDrag}
        onClick={(event) => {
          event.stopPropagation();
          if (event.detail === 0) onSelect(event.shiftKey);
        }}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{node.title}</span>
      </button>
      <div className="relative flex h-40 items-center justify-center overflow-hidden bg-muted/20">
        {media?.url ? (
          media.kind === "video" ? (
            <video
              src={media.url}
              controls
              preload="metadata"
              className="h-full w-full object-contain"
              data-canvas-no-zoom
            />
          ) : media.kind === "audio" ? (
            <audio
              src={media.url}
              controls
              preload="none"
              className="w-full px-3"
              data-canvas-no-zoom
            />
          ) : (
            <button
              type="button"
              className="group/preview relative flex h-full w-full cursor-zoom-in items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              aria-label={locale === "en" ? `Preview ${node.title}` : `预览${node.title}`}
              title={locale === "en" ? "Click to preview" : "点击预览图片"}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setPreviewOpen(true);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={node.title}
                src={media.url}
                draggable={false}
                loading="lazy"
                className="h-full w-full object-contain"
              />
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover/preview:bg-black/20 group-hover/preview:opacity-100">
                <Maximize2 className="size-5 drop-shadow" />
              </span>
            </button>
          )
        ) : previewText ? (
          <p className="line-clamp-4 w-full whitespace-pre-wrap px-4 text-sm leading-6 text-muted-foreground">
            {previewText}
          </p>
        ) : (
          <div className="space-y-3 px-4 text-center text-muted-foreground">
            <Icon className="mx-auto size-8 opacity-40" />
            <p className="text-xs leading-5">
              {inputs.length
                ? locale === "en"
                  ? "Inputs connected. Select to write a prompt."
                  : "已连接参考，点击填写创作提示词"
                : locale === "en"
                  ? "Select to add content or connect inputs"
                  : "点击填写内容，或连接参考素材"}
            </p>
          </div>
        )}
        {(task?.status === "queued" || task?.status === "running") && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80 px-4 text-center backdrop-blur-[2px]">
            <LoaderCircle className="size-7 animate-spin text-primary" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{status}</p>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {task.progressMessage || node.title}
              </p>
            </div>
            <div
              className="h-1.5 w-3/4 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={task.progress}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${Math.max(task.progress, 5)}%` }}
              />
            </div>
          </div>
        )}
        {inputs.length > 0 && (
          <div
            className="absolute bottom-2 left-2 right-2 truncate rounded-md bg-background/90 px-2 py-1 text-[11px] text-muted-foreground"
            title={inputs.join(" · ")}
          >
            {locale === "en" ? "From: " : "引用："}
            {inputs.join(" · ")}
          </div>
        )}
      </div>
      {media?.kind === "image" && media.url && (
        <MediaPreviewDialog
          alt={node.title}
          description={node.title}
          kind="image"
          onOpenChange={setPreviewOpen}
          open={previewOpen}
          title={node.title}
          url={media.url}
        />
      )}
      <div
        className="flex h-10 items-center justify-between gap-2 border-t px-3 text-xs text-muted-foreground"
        title={task?.error?.message}
      >
        <span
          className={
            task?.status === "failed" ? "truncate text-destructive" : "truncate"
          }
        >
          {status}
        </span>
        {usageCount != null ? (
          <span>{locale === "en" ? `Used in ${usageCount} shots` : `${usageCount} 个镜头使用`}</span>
        ) : node.panelId && (
          <span>{durationSeconds != null ? `${durationSeconds}s` : locale === "en" ? "Linked shot" : "关联镜头"}</span>
        )}
      </div>
    </section>
  );
}
