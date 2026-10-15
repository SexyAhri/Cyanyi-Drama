"use client";

import {
  Ban,
  Clapperboard,
  Download,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  ZoomIn,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MediaTask } from "@/lib/media/task-contract";

import {
  buildStudioTimeline,
  controlStudioMediaTask,
  loadStudioDeliverables,
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
  EditorSubtitle,
  ProductionData,
  ProductionDeliverableCatalog,
  ProjectMediaAsset,
  StudioLocale,
  StudioModelOption,
  StudioSelectionContext,
  StudioStoryboardData,
  WorkspaceSnapshot,
} from "../types";
import {
  alignTimelineSubtitles,
  findTimelineAsset,
  updateTimelineTrackSettings,
} from "./delivery-view-model";
import { PostMasterPanel } from "./post-master-panel";
import { RenderDialog } from "./render-dialog";
import { syncTimelineSources } from "@/lib/production/timeline-source-sync";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { TimelineEditor } from "./timeline-editor";
import { SubtitleEditor } from "./subtitle-editor";
import { ImageFramingControl } from "./image-framing-control";
import { aspectRatioValue } from "@/lib/production/image-framing";
import { inspectSubtitleTimings } from "@/lib/production/subtitle-timing";

const copy = {
  "zh-CN": {
    title: "时间线与交付",
    timelineTab: "时间线编辑",
    postTab: "后期母版",
    timelineDuration: "成片时长",
    timelineZoom: "时间线缩放",
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
    review: "镜头检查",
    shot: "镜头",
    range: "时间范围",
    media: "媒体类型",
    image: "图片",
    video: "视频",
    transition: "过渡",
    cut: "直接切换",
    fade: "淡入淡出",
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
    timelineTab: "Timeline edit",
    postTab: "Post master",
    timelineDuration: "Duration",
    timelineZoom: "Timeline zoom",
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
    review: "Shot inspector",
    shot: "Shot",
    range: "Time range",
    media: "Media type",
    image: "Image",
    video: "Video",
    transition: "Transition",
    cut: "Cut",
    fade: "Fade in/out",
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
  deliverables: ProductionDeliverableCatalog;
  production: ProductionData;
  storyboard: StudioStoryboardData;
  assets: ProjectMediaAsset[];
};

export function DeliveryWorkspace({
  episode,
  locale,
  onContextChange,
  onRefresh,
  snapshot,
}: {
  episode: WorkspaceSnapshot["project"]["episodes"][number];
  locale: StudioLocale;
  onContextChange: (selection?: StudioSelectionContext) => void;
  onRefresh: () => Promise<unknown> | void;
  snapshot: WorkspaceSnapshot;
  videoModels: StudioModelOption[];
}) {
  const text = copy[locale];
  const projectId = snapshot.project.id;
  const [data, setData] = useState<DeliveryData | null>(null);
  const [timeline, setTimeline] = useState<EditorTimeline | null>(null);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [savedTimeline, setSavedTimeline] = useState("");
  const [subtitles, setSubtitles] = useState<EditorSubtitle[]>([]);
  const [savedSubtitles, setSavedSubtitles] = useState("[]");
  const [subtitleResetOpen, setSubtitleResetOpen] = useState(false);
  const [measuredImages, setMeasuredImages] = useState<Record<string, { width: number; height: number }>>({});
  const [selectedTrackId, setSelectedTrackId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState("");
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState("timeline");
  const [pixelsPerSecond, setPixelsPerSecond] = useState(32);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const [production, storyboard, assets, deliverables] = await Promise.all([
          loadStudioProductionData(projectId, episode.id, signal),
          loadStudioStoryboard(projectId, episode.id, signal),
          loadStudioProjectAssets(projectId, signal),
          loadStudioDeliverables(projectId, signal),
        ]);
        const next = { production, storyboard, assets, deliverables };
        if (!signal?.aborted) {
          setData(next);
          const stored = production.editorProject?.timeline ?? null;
          setTimeline(stored);
          setSavedTimeline(stored ? JSON.stringify(stored) : "");
          const savedCues = production.editorProject?.subtitles ?? (stored ? alignTimelineSubtitles(production.voiceLines, stored) : []);
          setSubtitles(savedCues);
          setSavedSubtitles(JSON.stringify(savedCues));
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
    onContextChange(
      selectedTrack
        ? {
            id: selectedTrack.id,
            kind: "timeline_track",
            label: `${String(selectedTrack.shotIndex + 1).padStart(2, "0")} · ${selectedTrack.start.toFixed(1)}–${selectedTrack.end.toFixed(1)}`,
            metadata: {
              duration: selectedTrack.duration,
              shotIndex: selectedTrack.shotIndex,
            },
          }
        : undefined,
    );
  }, [onContextChange, selectedTrack]);

  useEffect(() => {
    if (!tracks.length) return setSelectedTrackId("");
    if (!tracks.some((track) => track.id === selectedTrackId))
      setSelectedTrackId(tracks[0].id);
  }, [selectedTrackId, tracks]);

  const tasks = snapshot.tasks.filter((task) => task.episodeId === episode.id);
  const renderTask = tasks
    .filter((task) => task.targetType === "editor_render")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const dirty = Boolean(timeline) && (JSON.stringify(timeline) !== savedTimeline || JSON.stringify(subtitles) !== savedSubtitles);
  const subtitleVoiceLines = data?.production.voiceLines ?? [];
  const subtitleIssues = timeline ? inspectSubtitleTimings(subtitles, timeline.duration, subtitleVoiceLines) : [];
  const sourceSync = timeline && data?.storyboard.storyboard
    ? syncTimelineSources(timeline, data.storyboard.storyboard.panels) : null;
  const sourcesChanged = Boolean(sourceSync?.changedIds.length || sourceSync?.incompatibleIds.length);
  function refreshTimelineMedia() {
    if (!sourceSync) return;
    setTimeline(sourceSync.timeline);
    toast.success(locale === "en" ? "Media references updated; save the timeline to apply." : "已更新素材引用并保留剪辑，请保存时间线。");
  }
  function resetSubtitleTiming() {
    if (!timeline || !data) return;
    try {
      setSubtitles(alignTimelineSubtitles(data.production.voiceLines, timeline));
      setSubtitleResetOpen(false);
    } catch (error) { toast.error(error instanceof Error ? error.message : text.actionFailed); }
  }

  async function refreshAll() {
    await Promise.all([load(), onRefresh()]);
  }

  async function act(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await action();
      toast.success(message);
      await refreshAll();
      return true;
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : text.actionFailed,
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function buildTimeline() {
    await act(async () => {
      const result = await buildStudioTimeline(projectId, episode.id);
      setRebuildOpen(false);
      setTimeline(result.editorProject.timeline);
      setSavedTimeline(JSON.stringify(result.editorProject.timeline));
    }, text.built);
  }

  async function saveTimeline() {
    if (!timeline || !data) return;
    await act(async () => {
      const result = await saveStudioTimeline(projectId, episode.id, {
        timeline,
        subtitles,
      });
      setData((current) =>
        current ? { ...current, production: result } : current,
      );
      setSavedTimeline(JSON.stringify(timeline));
      setSavedSubtitles(JSON.stringify(subtitles));
    }, text.saved);
  }

  async function render(input: {
    ratio: string;
    resolution: string;
    fps: number;
  }) {
    return act(
      () =>
        renderStudioTimeline(projectId, episode.id, {
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
      const result = await controlStudioMediaTask(task.id, action);
      if (action === "cancel" && result.task.cancellationPolicy?.provider === "cancellation_unsupported")
        toast.warning(locale === "en"
          ? "Local task stopped. The provider job may continue; late results are discarded and provider charges may still apply."
          : "本地任务已停止。模型服务端任务可能继续运行，迟到结果会丢弃，服务商费用仍可能产生。",
        );
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
          data?.production.voiceLines.some(line => line.id === subtitle.id && line.matchedPanelId === (selectedTrack.panelId ?? selectedTrack.id)) ||
          (subtitle.start < selectedTrack.end && subtitle.end > selectedTrack.start),
      )
    : [];
  const previewRatio = aspectRatioValue(snapshot.project.config.videoRatio);

  return (
    <div className="@container mx-auto w-full max-w-[1600px] px-3 py-3 sm:px-5 lg:px-6">
      <header className="flex flex-col gap-2.5 border-b pb-3 @min-[44rem]:flex-row @min-[44rem]:items-center @min-[44rem]:justify-between">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{text.title}</h1>
            {renderTask ? (
              <StatusIndicator
                locale={locale}
                status={runtimeStatusToStageStatus(renderTask.status)}
              />
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {String(episode.episodeNumber).padStart(2, "0")} · {episode.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            disabled={busy || dirty}
            onClick={() => timeline ? setRebuildOpen(true) : void buildTimeline()}
            size="sm"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            {timeline ? text.rebuild : text.build}
          </Button>
          <Button
            disabled={busy || !dirty || subtitleIssues.length > 0}
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
              busy || !timeline?.tracks.length || dirty || sourcesChanged || subtitleIssues.length > 0
            }
            locale={locale}
            preview={previewAsset?.url && previewAsset.kind === "image" ? { url: previewAsset.url, fit: selectedTrack?.imageFit ?? "contain" } : undefined}
            onRender={render}
          />
        </div>
      </header>
      {dirty && <p role="status" className="mt-3 text-xs text-status-warning">{locale === "en" ? "Unsaved timeline or subtitle changes" : "时间线或字幕有未保存修改"}</p>}
      {subtitleIssues.length > 0 && <p role="alert" className="mt-3 text-xs text-destructive">{locale === "en" ? "Fix subtitle timing before saving or exporting: " : "保存或导出前请修正字幕时间："}{subtitleIssues.map(issue => issue.message).join("；")}</p>}

      {sourcesChanged && <section className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 p-3">
        <p className="min-w-0 flex-1 text-xs leading-6">
          {locale === "en" ? "Adopted shot media changed. Refresh references before rendering; edit order and timing are preserved." : "镜头采用的素材已变化。更新引用后再导出，现有剪辑顺序、时长和裁剪会保留。"}
          {Boolean(sourceSync?.incompatibleIds.length) && <span className="block text-destructive">{locale === "en" ? "Some tracks were removed or resegmented. Rebuild or edit those tracks before rendering." : "部分镜头已删除或分段已变化，请重新编排这些镜头或重建时间线后再导出。"}</span>}
        </p>
        <Button size="sm" variant="outline" disabled={busy || !sourceSync?.changedIds.length} onClick={refreshTimelineMedia}>{locale === "en" ? "Refresh adopted media" : "更新已采用素材"}</Button>
      </section>}
      <Dialog open={subtitleResetOpen} onOpenChange={setSubtitleResetOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locale === "en" ? "Replan subtitle timing" : "重新分配字幕时间"}</DialogTitle>
            <DialogDescription>{locale === "en" ? "This replaces manual subtitle in/out points with timings based on the current shot lengths, reading estimates, and recorded audio durations. Save the timeline to apply." : "这会按当前镜头长度、阅读估计和已测音频时长替换手动字幕入出点。保存时间线后生效。"}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setSubtitleResetOpen(false)}>{locale === "en" ? "Cancel" : "取消"}</Button><Button onClick={resetSubtitleTiming}>{locale === "en" ? "Replan" : "重新分配"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={rebuildOpen} onOpenChange={setRebuildOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{text.rebuild}</DialogTitle><DialogDescription>{locale === "en" ? "Rebuilding replaces shot order, timing and trims. To keep your edit, use Refresh adopted media instead." : "重建会替换镜头顺序、时长和裁剪设置。保留现有剪辑请使用“更新已采用素材”。"}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setRebuildOpen(false)}>{locale === "en" ? "Cancel" : "取消"}</Button><Button disabled={busy} onClick={() => void buildTimeline()}>{text.rebuild}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

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
      ) : timeline && data ? (
        <Tabs
          className="gap-0"
          onValueChange={setActiveWorkspaceTab}
          value={activeWorkspaceTab}
        >
          <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b py-1 text-xs">
            <TabsList
              aria-label={text.title}
              className="h-8 max-w-full shrink-0 justify-start gap-3 overflow-x-auto px-0"
              variant="line"
            >
              <TabsTrigger className="px-2" value="timeline">
                {text.timelineTab}
              </TabsTrigger>
              <TabsTrigger className="px-2" value="post">
                {text.postTab}
              </TabsTrigger>
            </TabsList>
            {activeWorkspaceTab === "timeline" ? (
              <div className="ml-auto flex flex-wrap items-center gap-3">
                <span className="whitespace-nowrap font-semibold">
                  {text.timelineDuration} · {timeline.duration.toFixed(1)} {text.seconds}
                </span>
                <label className="flex items-center gap-2 text-muted-foreground">
                  <ZoomIn className="size-3.5" />
                  <span className="sr-only">{text.timelineZoom}</span>
                  <input
                    aria-label={text.timelineZoom}
                    className="w-20 accent-foreground sm:w-24"
                    max={64}
                    min={18}
                    onChange={(event) => setPixelsPerSecond(Number(event.target.value))}
                    step={2}
                    type="range"
                    value={pixelsPerSecond}
                  />
                </label>
              </div>
            ) : null}
          </div>

          <TabsContent className="min-w-0" keepMounted value="timeline">
            <div className="border-b">
              <TimelineEditor
                locale={locale}
                onChange={setTimeline}
                onSelect={setSelectedTrackId}
                pixelsPerSecond={pixelsPerSecond}
                selectedTrackId={selectedTrack?.id ?? ""}
                subtitles={subtitles}
                timeline={timeline}
              />
              <div className="grid min-w-0 @min-[48rem]:grid-cols-[minmax(0,1.2fr)_minmax(300px,1fr)]">
                <section className="min-w-0 py-3 @min-[48rem]:pr-4">
                  <h2 className="mb-2 text-sm font-semibold">{text.preview}</h2>
                  <div
                    className="mx-auto w-full overflow-hidden rounded-md border bg-muted/30"
                    style={{ maxWidth: `min(100%, calc(clamp(160px, calc(100dvh - 540px), 320px) * ${previewRatio}))` }}
                  >
                    <AspectRatio ratio={previewRatio}>
                      {previewAsset?.url && previewAsset.kind === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={text.preview}
                          className="size-full bg-black"
                          style={{ objectFit: selectedTrack?.imageFit === "crop" ? "cover" : "contain" }}
                          src={previewAsset.url}
                          onLoad={event => {
                            const image = event.currentTarget;
                            setMeasuredImages(previous => ({ ...previous, [previewAsset.id]: { width: image.naturalWidth, height: image.naturalHeight } }));
                          }}
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
                  {selectedTrack && previewAsset?.kind === "image" && <ImageFramingControl locale={locale} ratio={snapshot.project.config.videoRatio}
                    metadata={measuredImages[previewAsset.id] ? { ...previewAsset.metadata, imageInspection: measuredImages[previewAsset.id] } : previewAsset.metadata}
                    value={selectedTrack.imageFit ?? "contain"}
                    onChange={imageFit => setTimeline(updateTimelineTrackSettings(timeline, selectedTrack.id, { imageFit }))} />}
                </section>

                <aside className="min-w-0 border-t py-3 @min-[48rem]:border-t-0 @min-[48rem]:border-l @min-[48rem]:pl-4">
                  <h2 className="text-sm font-semibold">{text.review}</h2>
                  {selectedTrack ? (
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 border-y py-2 text-xs">
                      <div className="flex min-w-0 items-baseline justify-between gap-2">
                        <dt className="text-xs text-muted-foreground">{text.shot}</dt>
                        <dd className="font-mono font-medium">
                          {String(selectedTrack.shotIndex + 1).padStart(2, "0")}
                        </dd>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2">
                        <dt className="text-xs text-muted-foreground">{text.range}</dt>
                        <dd className="font-mono font-medium">
                          {selectedTrack.start.toFixed(1)}–{selectedTrack.end.toFixed(1)}s
                        </dd>
                      </div>
                      <div className="flex min-w-0 items-baseline justify-between gap-2">
                        <dt className="text-xs text-muted-foreground">{text.media}</dt>
                        <dd className="font-medium">{selectedTrack.type === "image" ? text.image : text.video}</dd>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2">
                        <dt className="text-xs text-muted-foreground">{text.transition}</dt>
                        <dd className="font-medium">
                          {selectedTrack.transition === "fade" ? text.fade : text.cut}
                        </dd>
                      </div>
                    </dl>
                  ) : null}

                  <section className="mt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">{text.subtitles}</h3>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setSubtitleResetOpen(true)}>{locale === "en" ? "Replan timings" : "重排字幕时间"}</Button>
                    </div>
                    <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{locale === "en" ? "Uses reading time or measured audio; manual timings stay until replanned." : "按阅读量或实测音频分配，手动时间需主动重排。"}</p>
                    {selectedSubtitles.length ? (
                      <SubtitleEditor locale={locale} subtitles={subtitles} visibleIds={new Set(selectedSubtitles.map(cue => cue.id))} duration={timeline.duration} onChange={setSubtitles} voiceLines={subtitleVoiceLines} />
                    ) : (
                      <p className="mt-2 border-y py-4 text-sm text-muted-foreground">
                        {text.noSubtitles}
                      </p>
                    )}
                  </section>
                </aside>
              </div>
            </div>
          </TabsContent>

          <TabsContent className="min-w-0" keepMounted value="post">
            <div className="grid min-w-0 border-b 2xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
              <div className="min-w-0 2xl:pr-6">
                <PostMasterPanel
                  aspectRatio={snapshot.project.config.videoRatio}
                  catalog={data.deliverables}
                  episodeId={episode.id}
                  episodeName={episode.name}
                  frameRate={24}
                  language={locale === "en" ? "en" : "zh-CN"}
                  locale={locale}
                  onCompleted={refreshAll}
                  projectId={projectId}
                  resolution={snapshot.project.config.videoResolution}
                  subtitles={subtitles}
                  timeline={timeline}
                />
              </div>
              <div className="min-w-0 border-t 2xl:border-t-0 2xl:border-l 2xl:pl-6">
                <OutputPreview
                  assets={data.assets}
                  busyTaskId={busyTaskId}
                  editor={data.production.editorProject}
                  locale={locale}
                  onTaskAction={controlTask}
                  task={renderTask}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>
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
        <div className="bg-muted/30">
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
