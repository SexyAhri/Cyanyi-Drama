"use client";

import {
  ArrowDown,
  ArrowUp,
  Ban,
  Clapperboard,
  Download,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MediaTask } from "@/lib/media/task-contract";
import { cn } from "@/lib/utils";

import {
  buildStudioTimeline,
  controlStudioMediaTask,
  loadStudioProductionData,
  loadStudioProjectAssets,
  loadStudioStoryboard,
  renderStudioTimeline,
  saveStudioTimeline,
} from "../api";
import { StatusIndicator } from "../components/status-indicator";
import { runtimeStatusToStageStatus } from "../stage-state";
import type {
  EditorTimeline,
  ProductionData,
  ProjectMediaAsset,
  StudioLocale,
  StudioModelOption,
  StudioStoryboardData,
  WorkspaceSnapshot,
} from "../types";
import {
  alignTimelineSubtitles,
  findTimelineAsset,
  moveTimelineTrack,
  updateTimelineDuration,
} from "./delivery-view-model";
import { RenderDialog } from "./render-dialog";

const copy = {
  "zh-CN": {
    title: "时间线与交付",
    build: "生成时间线",
    rebuild: "重建时间线",
    save: "保存时间线",
    tracks: "镜头顺序",
    duration: "时长",
    seconds: "秒",
    moveUp: "上移镜头",
    moveDown: "下移镜头",
    noTimeline: "还没有时间线",
    noTimelineDetail: "完成分镜和镜头素材后，生成可编辑的交付时间线。",
    noPreview: "当前镜头没有可预览素材",
    preview: "镜头预览",
    subtitles: "字幕预览",
    noSubtitles: "没有关联到当前镜头的字幕",
    output: "成片",
    noOutput: "尚未渲染成片",
    cancel: "取消任务",
    retry: "重试任务",
    download: "下载",
    loadFailed: "交付数据载入失败",
    actionFailed: "操作失败",
    built: "时间线已生成",
    saved: "时间线已保存",
    submitted: "渲染任务已提交",
  },
  en: {
    title: "Timeline and delivery",
    build: "Build timeline",
    rebuild: "Rebuild timeline",
    save: "Save timeline",
    tracks: "Shot order",
    duration: "Duration",
    seconds: "seconds",
    moveUp: "Move shot up",
    moveDown: "Move shot down",
    noTimeline: "No timeline yet",
    noTimelineDetail:
      "Build an editable delivery timeline after storyboard media is ready.",
    noPreview: "No preview media for this shot",
    preview: "Shot preview",
    subtitles: "Subtitle preview",
    noSubtitles: "No subtitles linked to this shot",
    output: "Final video",
    noOutput: "No rendered video yet",
    cancel: "Cancel task",
    retry: "Retry task",
    download: "Download",
    loadFailed: "Unable to load delivery data",
    actionFailed: "Action failed",
    built: "Timeline built",
    saved: "Timeline saved",
    submitted: "Render submitted",
  },
} as const;

type DeliveryData = {
  production: ProductionData;
  storyboard: StudioStoryboardData;
  assets: ProjectMediaAsset[];
};

export function DeliveryWorkspace({
  episode,
  locale,
  onRefresh,
  snapshot,
  videoModels,
}: {
  episode: WorkspaceSnapshot["project"]["episodes"][number];
  locale: StudioLocale;
  onRefresh: () => Promise<unknown> | void;
  snapshot: WorkspaceSnapshot;
  videoModels: StudioModelOption[];
}) {
  const text = copy[locale];
  const projectId = snapshot.project.id;
  const [data, setData] = useState<DeliveryData | null>(null);
  const [timeline, setTimeline] = useState<EditorTimeline | null>(null);
  const [savedTimeline, setSavedTimeline] = useState("");
  const [selectedTrackId, setSelectedTrackId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState("");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const [production, storyboard, assets] = await Promise.all([
          loadStudioProductionData(projectId, episode.id, signal),
          loadStudioStoryboard(projectId, episode.id, signal),
          loadStudioProjectAssets(projectId, signal),
        ]);
        const next = { production, storyboard, assets };
        if (!signal?.aborted) {
          setData(next);
          const stored = production.editorProject?.timeline ?? null;
          setTimeline(stored);
          setSavedTimeline(stored ? JSON.stringify(stored) : "");
        }
        return next;
      } catch (requestError) {
        if (!signal?.aborted)
          setError(
            requestError instanceof Error
              ? requestError.message
              : text.loadFailed,
          );
        return null;
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [episode.id, projectId, text.loadFailed],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const tracks = useMemo(() => timeline?.tracks ?? [], [timeline]);
  const selectedTrack =
    tracks.find((track) => track.id === selectedTrackId) ?? tracks[0];

  useEffect(() => {
    if (!tracks.length) return setSelectedTrackId("");
    if (!tracks.some((track) => track.id === selectedTrackId))
      setSelectedTrackId(tracks[0].id);
  }, [selectedTrackId, tracks]);

  const tasks = snapshot.tasks.filter((task) => task.episodeId === episode.id);
  const renderTask = tasks
    .filter((task) => task.targetType === "editor_render")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const dirty = Boolean(timeline) && JSON.stringify(timeline) !== savedTimeline;
  const subtitles =
    timeline && data
      ? alignTimelineSubtitles(data.production.voiceLines, timeline)
      : [];

  async function refreshAll() {
    await Promise.all([load(), onRefresh()]);
  }

  async function act(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await action();
      toast.success(message);
      await refreshAll();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : text.actionFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  async function buildTimeline() {
    await act(async () => {
      const result = await buildStudioTimeline(projectId, episode.id);
      setTimeline(result.editorProject.timeline);
      setSavedTimeline(JSON.stringify(result.editorProject.timeline));
    }, text.built);
  }

  async function saveTimeline() {
    if (!timeline || !data) return;
    await act(async () => {
      const result = await saveStudioTimeline(projectId, episode.id, {
        timeline,
        subtitles: alignTimelineSubtitles(data.production.voiceLines, timeline),
      });
      setData((current) =>
        current ? { ...current, production: result } : current,
      );
      setSavedTimeline(JSON.stringify(timeline));
    }, text.saved);
  }

  async function render(input: {
    model: StudioModelOption;
    ratio: string;
    resolution: string;
    fps: number;
  }) {
    await act(
      () =>
        renderStudioTimeline(projectId, episode.id, {
          channelId: input.model.channelId,
          model: input.model.modelId,
          ratio: input.ratio,
          resolution: input.resolution,
          fps: input.fps,
        }),
      text.submitted,
    );
  }

  async function controlTask(task: MediaTask, action: "cancel" | "retry") {
    setBusyTaskId(task.id);
    try {
      await controlStudioMediaTask(task.id, action);
      await refreshAll();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : text.actionFailed,
      );
    } finally {
      setBusyTaskId("");
    }
  }

  if (loading && !data)
    return (
      <div className="flex min-h-96 items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );

  const previewAsset = data
    ? findTimelineAsset(selectedTrack, data.assets)
    : undefined;
  const selectedSubtitles = selectedTrack
    ? subtitles.filter(
        (subtitle) =>
          subtitle.start === selectedTrack.start &&
          subtitle.end === selectedTrack.end,
      )
    : [];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-7 sm:py-7">
      <header className="flex flex-col gap-4 border-b pb-5 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {String(episode.episodeNumber).padStart(2, "0")} · {episode.name}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold">{text.title}</h1>
            {renderTask ? (
              <StatusIndicator
                locale={locale}
                status={runtimeStatusToStageStatus(renderTask.status)}
              />
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() => void buildTimeline()}
            size="sm"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            {timeline ? text.rebuild : text.build}
          </Button>
          <Button
            disabled={busy || !dirty}
            onClick={() => void saveTimeline()}
            size="sm"
            variant="outline"
          >
            <Save className="size-4" />
            {text.save}
          </Button>
          <RenderDialog
            busy={busy}
            defaultRatio={snapshot.project.config.videoRatio}
            defaultResolution={snapshot.project.config.videoResolution}
            disabled={
              busy || !timeline?.tracks.length || dirty || !videoModels.length
            }
            locale={locale}
            models={videoModels}
            onRender={render}
          />
        </div>
      </header>

      {error ? (
        <div className="flex items-center justify-between gap-3 border-b py-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button onClick={() => void load()} size="sm" variant="outline">
            <RotateCcw className="size-4" />
            {text.retry}
          </Button>
        </div>
      ) : null}

      {!tracks.length ? (
        <div className="flex min-h-96 flex-col items-center justify-center gap-2 border-b text-center text-muted-foreground">
          <Clapperboard className="size-6" />
          <h2 className="text-sm font-medium text-foreground">
            {text.noTimeline}
          </h2>
          <p className="max-w-md text-sm leading-6">{text.noTimelineDetail}</p>
        </div>
      ) : (
        <div className="grid min-h-[40rem] border-b 2xl:grid-cols-[22rem_minmax(0,1fr)]">
          <aside className="border-b 2xl:border-r 2xl:border-b-0">
            <div className="flex h-11 items-center justify-between border-b px-3 text-xs font-semibold">
              <span>{text.tracks}</span>
              <span className="text-muted-foreground">
                {timeline?.duration.toFixed(1)} {text.seconds}
              </span>
            </div>
            <div className="max-h-96 overflow-y-auto p-1.5 2xl:max-h-[calc(100dvh-17rem)]">
              {tracks.map((track, index) => (
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5",
                    selectedTrack?.id === track.id && "bg-muted",
                  )}
                  key={track.id}
                >
                  <button
                    className="min-w-0 flex-1 py-1 text-left"
                    onClick={() => setSelectedTrackId(track.id)}
                    type="button"
                  >
                    <span className="block text-sm font-medium">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {track.start.toFixed(1)}–{track.end.toFixed(1)}{" "}
                      {text.seconds}
                    </span>
                  </button>
                  <Input
                    aria-label={text.duration}
                    className="h-7 w-16 px-1.5 text-center text-xs"
                    max={30}
                    min={0.5}
                    onChange={(event) =>
                      setTimeline((current) =>
                        current
                          ? updateTimelineDuration(
                              current,
                              track.id,
                              Number(event.target.value),
                            )
                          : current,
                      )
                    }
                    step={0.5}
                    type="number"
                    value={track.duration}
                  />
                  <TimelineAction
                    disabled={index === 0}
                    icon={<ArrowUp className="size-3.5" />}
                    label={text.moveUp}
                    onClick={() =>
                      setTimeline((current) =>
                        current
                          ? moveTimelineTrack(current, track.id, -1)
                          : current,
                      )
                    }
                  />
                  <TimelineAction
                    disabled={index === tracks.length - 1}
                    icon={<ArrowDown className="size-3.5" />}
                    label={text.moveDown}
                    onClick={() =>
                      setTimeline((current) =>
                        current
                          ? moveTimelineTrack(current, track.id, 1)
                          : current,
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </aside>

          <section className="min-w-0 p-4 sm:p-6">
            <h2 className="mb-2 text-sm font-semibold">{text.preview}</h2>
            <div className="overflow-hidden rounded-md border bg-muted/30">
              <AspectRatio ratio={16 / 9}>
                {previewAsset?.url && previewAsset.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt={text.preview}
                    className="size-full object-contain"
                    src={previewAsset.url}
                  />
                ) : previewAsset?.url ? (
                  <video
                    className="size-full object-contain"
                    controls
                    preload="metadata"
                    src={previewAsset.url}
                  />
                ) : (
                  <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
                    {text.noPreview}
                  </div>
                )}
              </AspectRatio>
            </div>

            <section className="mt-5 border-t pt-5">
              <h2 className="text-sm font-semibold">{text.subtitles}</h2>
              {selectedSubtitles.length ? (
                <div className="mt-2 divide-y border-y">
                  {selectedSubtitles.map((subtitle) => (
                    <div
                      className="grid gap-1 py-3 sm:grid-cols-[8rem_minmax(0,1fr)]"
                      key={subtitle.id}
                    >
                      <span className="text-xs font-medium">
                        {subtitle.speaker}
                      </span>
                      <p className="text-sm leading-6 text-muted-foreground">
                        {subtitle.text}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 border-y py-4 text-sm text-muted-foreground">
                  {text.noSubtitles}
                </p>
              )}
            </section>
          </section>
        </div>
      )}

      {data ? (
        <OutputPreview
          assets={data.assets}
          busyTaskId={busyTaskId}
          editor={data.production.editorProject}
          locale={locale}
          onTaskAction={controlTask}
          task={renderTask}
        />
      ) : null}
    </div>
  );
}

function OutputPreview({
  assets,
  busyTaskId,
  editor,
  locale,
  onTaskAction,
  task,
}: {
  assets: ProjectMediaAsset[];
  busyTaskId: string;
  editor: ProductionData["editorProject"];
  locale: StudioLocale;
  onTaskAction: (task: MediaTask, action: "cancel" | "retry") => void;
  task?: MediaTask;
}) {
  const text = copy[locale];
  const asset = editor?.outputAssetId
    ? assets.find((item) => item.id === editor.outputAssetId)
    : undefined;
  const output = task?.status === "succeeded" ? task.output?.[0] : undefined;
  const url = asset?.url ?? output?.url;
  const active = task && ["queued", "running"].includes(task.status);
  return (
    <section className="py-5">
      <h2 className="mb-2 text-sm font-semibold">{text.output}</h2>
      <figure className="overflow-hidden rounded-md border bg-card">
        <div className="mx-auto max-w-4xl bg-muted/30">
          <AspectRatio ratio={16 / 9}>
            {url ? (
              <video
                className="size-full object-contain"
                controls
                preload="metadata"
                src={url}
              />
            ) : active ? (
              <div className="flex size-full items-center justify-center">
                <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
                {text.noOutput}
              </div>
            )}
          </AspectRatio>
        </div>
        <figcaption className="flex min-h-11 items-center gap-2 border-t px-2.5 py-1.5">
          <StatusIndicator
            locale={locale}
            status={
              task
                ? runtimeStatusToStageStatus(task.status)
                : url
                  ? "completed"
                  : "not_started"
            }
          />
          <div className="ml-auto flex items-center gap-0.5">
            {active ? (
              <TaskAction
                busy={busyTaskId === task.id}
                icon={<Ban className="size-3.5" />}
                label={text.cancel}
                onClick={() => onTaskAction(task, "cancel")}
              />
            ) : null}
            {task?.status === "failed" ? (
              <TaskAction
                busy={busyTaskId === task.id}
                icon={<RotateCcw className="size-3.5" />}
                label={text.retry}
                onClick={() => onTaskAction(task, "retry")}
              />
            ) : null}
            {url ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <a
                      aria-label={text.download}
                      className={buttonVariants({
                        size: "icon-sm",
                        variant: "ghost",
                      })}
                      download
                      href={url}
                    />
                  }
                >
                  <Download className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>{text.download}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </figcaption>
      </figure>
    </section>
  );
}

function TimelineAction({
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

function TaskAction({
  busy,
  icon,
  label,
  onClick,
}: {
  busy: boolean;
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
            disabled={busy}
            onClick={onClick}
            size="icon-sm"
            type="button"
            variant="ghost"
          />
        }
      >
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
