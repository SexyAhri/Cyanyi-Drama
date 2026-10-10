"use client";

import {
  Ban,
  CircleCheck,
  Clapperboard,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Merge,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import {
  controlStudioWorkflow,
  loadStudioStoryboard,
  saveStudioStoryboard,
  startStudioStoryboardWorkflow,
} from "../api";
import { StatusIndicator } from "../components/status-indicator";
import { ModelSelect } from "../components/model-select";
import { getStudioCopy } from "../i18n";
import {
  getWorkflowForStage,
  getWorkflowContentRevision,
  runtimeStatusToStageStatus,
} from "../stage-state";
import type {
  StudioLocale,
  StudioSelectionContext,
  StudioStoryboardData,
  StudioStoryboardPanel,
  WorkspaceSnapshot,
  StudioModelOption,
} from "../types";
import { PanelEditorDialog } from "./panel-editor-dialog";
import { DirectorReviewPanel } from "./director-review-panel";
import { StoryboardProgressPanel } from "./storyboard-progress-panel";
import {
  getPanelContinuityIssues,
  mergeStoryboardPanelWithNext,
  replaceStoryboardPanel,
  splitStoryboardPanel,
} from "./storyboard-view-model";
import {
  getPrevisReadiness,
  parseActingDirections,
  parsePhotographyRules,
  type PrevisSpecKey,
} from "./previs-view-model";

export function StoryboardWorkspace({
  focusedPanelId,
  analysisModelId,
  models,
  onAnalysisModelChange,
  episode,
  locale,
  onContextChange,
  onRefresh,
  snapshot,
}: {
  focusedPanelId?: string;
  analysisModelId: string;
  models: StudioModelOption[];
  onAnalysisModelChange: (id: string) => void;
  episode: WorkspaceSnapshot["project"]["episodes"][number];
  locale: StudioLocale;
  onContextChange: (selection?: StudioSelectionContext) => void;
  onRefresh: () => Promise<unknown> | void;
  snapshot: WorkspaceSnapshot;
}) {
  const copy = getStudioCopy(locale);
  const [data, setData] = useState<StudioStoryboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [selectedPanelId, setSelectedPanelId] = useState("");
  const [showSaved, setShowSaved] = useState(false);
  useEffect(() => {
    if (focusedPanelId) setSelectedPanelId(focusedPanelId);
  }, [focusedPanelId]);
  const projectId = snapshot.project.id;
  const workflows = snapshot.workflows.filter(
    (workflow) => workflow.episodeId === episode.id,
  );
  const workflow = getWorkflowForStage(workflows, "storyboard");
  const workflowRevision = getWorkflowContentRevision(workflow);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const result = await loadStudioStoryboard(
          projectId,
          episode.id,
          signal,
        );
        if (!signal?.aborted) setData(result);
        return result;
      } catch (requestError) {
        if (!signal?.aborted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : copy.loadFailed,
          );
        }
        return null;
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [copy.loadFailed, episode.id, projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    void load(controller.signal);
    return () => controller.abort();
  }, [load, workflowRevision]);
  const progressActive = ["queued", "running", "canceling"].includes(
    data?.progress?.status ?? workflow?.status ?? "",
  );
  useEffect(() => {
    if (!progressActive) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (controller.signal.aborted) return;
      await load(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [load, progressActive]);
  useEffect(() => {
    setShowSaved(false);
  }, [episode.id, workflow?.id]);

  const panels = useMemo(
    () => data?.storyboard?.panels ?? [],
    [data?.storyboard?.panels],
  );
  const selectedPanel =
    panels.find((panel) => panel.id === selectedPanelId) ?? panels[0];
  const showProgress =
    !!data?.progress &&
    (progressActive ||
      data.progress.completedPanels > 0 ||
      data.progress.status === "paused") &&
    !showSaved;
  const focusedOnce = useRef("");
  useEffect(() => {
    if (
      focusedPanelId &&
      focusedOnce.current !== focusedPanelId &&
      panels.some((panel) => panel.id === focusedPanelId)
    ) {
      focusedOnce.current = focusedPanelId;
      setSelectedPanelId(focusedPanelId);
    }
  }, [focusedPanelId, panels]);

  useEffect(() => {
    onContextChange(
      selectedPanel && !showProgress
        ? {
            id: selectedPanel.id,
            kind: "panel",
            label: `${copy.panel} ${String(selectedPanel.panelIndex + 1).padStart(2, "0")}`,
            metadata: {
              duration: selectedPanel.durationSeconds ?? 0,
              shotType: selectedPanel.shotType ?? "",
            },
          }
        : undefined,
    );
  }, [copy.panel, onContextChange, selectedPanel, showProgress]);

  useEffect(() => {
    if (!panels.length) {
      setSelectedPanelId("");
      return;
    }
    if (!panels.some((panel) => panel.id === selectedPanelId)) {
      setSelectedPanelId(panels[0].id);
    }
  }, [panels, selectedPanelId]);

  async function refreshAll() {
    await Promise.all([load(), onRefresh()]);
  }

  async function startWorkflow() {
    const model = models.find((item) => item.id === analysisModelId);
    if (!model) {
      toast.error(
        locale === "zh-CN"
          ? "请先选择导演分析模型"
          : "Select a director model first",
      );
      return;
    }
    setIsActing(true);
    try {
      const result = await startStudioStoryboardWorkflow(
        projectId,
        episode.id,
        {
          locale: locale === "en" ? "en" : "zh",
          channelId: model.channelId,
          model: model.modelId,
        },
      );
      toast.success(result.reused ? copy.workflowReused : copy.workflowStarted);
      await refreshAll();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : copy.actionFailed,
      );
    } finally {
      setIsActing(false);
    }
  }

  async function controlWorkflow(
    action: "cancel" | "retry" | "pause" | "resume",
  ) {
    if (!workflow) return;
    setIsActing(true);
    try {
      await controlStudioWorkflow(workflow.id, action);
      await refreshAll();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : copy.actionFailed,
      );
    } finally {
      setIsActing(false);
    }
  }

  async function savePanel(nextPanel: StudioStoryboardPanel) {
    if (!data?.storyboard) return;
    return savePanels(
      replaceStoryboardPanel(data.storyboard.panels, nextPanel),
      data.storyboard.status,
    );
  }

  async function savePanels(
    nextPanels: StudioStoryboardPanel[],
    status: string,
  ) {
    if (!data?.storyboard) return;
    try {
      const result = await saveStudioStoryboard(projectId, episode.id, {
        status,
        sourceHash: data.storyboard.sourceHash,
        panels: nextPanels,
      });
      setData((current) =>
        current ? { ...current, storyboard: result.storyboard } : current,
      );
      toast.success(copy.panelSaved);
      await onRefresh();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : copy.actionFailed,
      );
      throw requestError;
    }
  }

  async function splitPanel(panelId: string) {
    if (!data?.storyboard) return;
    const panels = splitStoryboardPanel(data.storyboard.panels, panelId);
    if (!panels) return;
    await savePanels(panels, "review_required");
  }

  async function mergePanel(panelId: string) {
    if (!data?.storyboard) return;
    const panels = mergeStoryboardPanelWithNext(
      data.storyboard.panels,
      panelId,
    );
    if (!panels) return;
    await savePanels(panels, "review_required");
  }

  if (isLoading && !data) {
    return (
      <div className="flex h-full min-h-96 items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-7 sm:py-7 xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden">
      <header className="flex shrink-0 flex-col gap-4 border-b pb-5 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {String(episode.episodeNumber).padStart(2, "0")} · {episode.name}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="break-keep text-xl font-semibold">
              {copy.storyboardWorkspace}
            </h1>
            {workflow ? (
              <StatusIndicator
                locale={locale}
                status={runtimeStatusToStageStatus(workflow.status)}
              />
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {data?.progress && panels.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowSaved((value) => !value)}
            >
              {showSaved
                ? locale === "en"
                  ? "Generation progress"
                  : "返回生成进度"
                : locale === "en"
                  ? "Previous production shots"
                  : "查看已有正式分镜"}
            </Button>
          )}
          <ModelSelect
            models={models}
            value={analysisModelId}
            onChange={onAnalysisModelChange}
            placeholder={locale === "zh-CN" ? "导演模型" : "Director model"}
            className="w-52"
            disabled={isActing || workflow?.status === "running"}
          />
          <WorkflowButtons
            disabled={isActing || !analysisModelId}
            hasWorkflow={Boolean(workflow)}
            locale={locale}
            onAction={controlWorkflow}
            onStart={startWorkflow}
            status={workflow?.status}
          />
        </div>
      </header>

      <div className="shrink-0 border-b py-3 text-xs leading-6 text-muted-foreground">
        {locale === "zh-CN"
          ? "导演流程：结构化剧本 → 按场次并行拆镜与表演设计 → 汇总审核 → 问题场次定向修复 → 分镜确认。原文台词与说话人逐条关联，已完成场次即时展示；视频使用无声画面，配音与口型在声音阶段处理。"
          : "Director flow: structured screenplay → parallel scene planning and performance design → consolidated review → targeted scene repair → storyboard confirmation. Completed scenes appear immediately; original dialogue is linked precisely. Speech and lip sync are produced separately."}
      </div>
      {data?.storyboard?.status === "director_review_required" ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b py-3 text-sm">
          <p className="text-destructive">
            {locale === "zh-CN"
              ? "导演审核仍有未解决问题。请检查分镜，确认后才能生成媒体；审核记录在任务产物中。"
              : "Director review requires attention. Inspect the shots before confirming them for media generation."}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={isActing}
            onClick={() => void savePanels(panels, "ready")}
          >
            {locale === "zh-CN"
              ? "已检查，确认分镜"
              : "Confirm reviewed storyboard"}
          </Button>
        </div>
      ) : null}
      <DirectorReviewPanel
        value={selectedPanel?.actingNotes?.directorReview}
        locale={locale}
      />

      <div className="min-w-0 pt-4 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:overflow-hidden">
        {error ? (
          <div className="flex items-center justify-between gap-3 border-b py-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button onClick={() => void load()} size="sm" variant="outline">
              {copy.retry}
            </Button>
          </div>
        ) : null}

        {showProgress && data?.progress ? (
          <>
            <StoryboardProgressPanel
              key={data.progress.runId}
              progress={data.progress}
              locale={locale}
            />
          </>
        ) : !panels.length ? (
          <div className="flex min-h-96 flex-col items-center justify-center gap-3 border-b text-center text-muted-foreground">
            <Clapperboard className="size-6" />
            <p className="max-w-md text-sm leading-6">{copy.noStoryboard}</p>
          </div>
        ) : (
          <div className="grid min-h-152 border-b lg:grid-cols-[15rem_minmax(0,1fr)] xl:min-h-0 xl:flex-1 xl:overflow-hidden">
            <aside className="border-b lg:border-r lg:border-b-0 xl:flex xl:min-h-0 xl:flex-col">
              <div className="flex h-11 items-center justify-between border-b px-3">
                <h2 className="text-xs font-semibold">
                  {copy.storyboardPanels}
                </h2>
                <Badge variant="secondary">{panels.length}</Badge>
              </div>
              <div className="max-h-80 overflow-y-auto p-1.5 xl:max-h-none xl:flex-1">
                {panels.map((panel) => {
                  const issues = getPanelContinuityIssues(
                    panel,
                    data?.continuityIssues ?? [],
                  );
                  const readiness = getPrevisReadiness(panel, issues);
                  return (
                    <button
                      className={cn(
                        "grid h-16 w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        panel.id === selectedPanel?.id
                          ? "bg-muted"
                          : "hover:bg-muted/60",
                      )}
                      key={panel.id}
                      onClick={() => setSelectedPanelId(panel.id)}
                      type="button"
                    >
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {String(panel.panelIndex + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {panel.shotType || copy.panel}
                        </span>
                        <span
                          className="mt-1 block truncate text-xs text-muted-foreground"
                          title={panelListMetadata(panel, copy.seconds)}
                        >
                          {panelListMetadata(panel, copy.seconds)}
                        </span>
                      </span>
                      <Badge
                        className={cn(
                          "shrink-0 font-mono text-[10px]",
                          readiness.isReady &&
                            "border-status-success/30 text-status-success",
                        )}
                        variant="outline"
                      >
                        {readiness.complete}/{readiness.total}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </aside>

            {selectedPanel ? (
              <PanelDetails
                canMerge={Boolean(
                  mergeStoryboardPanelWithNext(panels, selectedPanel.id),
                )}
                canSplit={(selectedPanel.durationSeconds ?? 0) >= 2}
                issues={getPanelContinuityIssues(
                  selectedPanel,
                  data?.continuityIssues ?? [],
                )}
                locale={locale}
                onMerge={mergePanel}
                onSave={savePanel}
                onSplit={splitPanel}
                panel={selectedPanel}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function panelListMetadata(panel: StudioStoryboardPanel, secondsLabel: string) {
  return [
    panel.locationName,
    panel.cameraMove,
    panel.durationSeconds ? `${panel.durationSeconds} ${secondsLabel}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function PanelDetails({
  canMerge,
  canSplit,
  issues,
  locale,
  onMerge,
  onSave,
  onSplit,
  panel,
}: {
  canMerge: boolean;
  canSplit: boolean;
  issues: StudioStoryboardData["continuityIssues"];
  locale: StudioLocale;
  onMerge: (panelId: string) => Promise<unknown> | void;
  onSave: (panel: StudioStoryboardPanel) => Promise<unknown> | void;
  onSplit: (panelId: string) => Promise<unknown> | void;
  panel: StudioStoryboardPanel;
}) {
  const copy = getStudioCopy(locale);
  const photography = parsePhotographyRules(panel.photographyRules);
  const acting = parseActingDirections(panel.actingNotes);
  const readiness = getPrevisReadiness(panel, issues);
  const description = panel.description || copy.panelDescription;
  const tools =
    locale === "zh-CN"
      ? {
          split: "拆分镜头",
          merge: "与下一镜合并",
          scene: "场次",
          speaker: "口型角色",
          lipSync: "口型文本",
          voiceover: "画外音",
          startState: "镜头开始状态",
          endState: "镜头结束状态",
          motionBeats: "关键动作节拍",
          worldContext: "世界观与战力约束",
          realm: "当前境界",
          technique: "功法 / 招式",
          powerRule: "威力与限制",
          environmentScale: "场景尺度",
          vfxCues: "VFX 时间点",
          sfxCues: "SFX / Foley 时间点",
          overview: "镜头概览",
          actionPerformance: "动作与表演",
          cameraDesign: "摄影设计",
          generationPrompts: "生成提示",
          continuity: "连续性",
          dialogue: "对白与声音",
          imagePrompt: "图片提示词",
          videoPrompt: "视频提示词",
          sourceEvidence: "原文依据",
          noContinuityIssues: "当前镜头未发现连续性问题",
        }
      : {
          split: "Split shot",
          merge: "Merge with next",
          scene: "Scene",
          speaker: "Lip-sync speaker",
          lipSync: "Lip-sync text",
          voiceover: "Voice-over",
          startState: "Start state",
          endState: "End state",
          motionBeats: "Key motion beats",
          worldContext: "World and power constraints",
          realm: "Current realm",
          technique: "Technique / skill",
          powerRule: "Power rule and limit",
          environmentScale: "Environment scale",
          vfxCues: "Timed VFX cues",
          sfxCues: "Timed SFX / Foley cues",
          overview: "Shot overview",
          actionPerformance: "Action & performance",
          cameraDesign: "Camera design",
          generationPrompts: "Generation prompts",
          continuity: "Continuity",
          dialogue: "Dialogue & sound",
          imagePrompt: "Image prompt",
          videoPrompt: "Video prompt",
          sourceEvidence: "Source evidence",
          noContinuityIssues: "No continuity issues found for this shot",
        };

  return (
    <section className="min-w-0 p-4 sm:p-5 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
      <header className="flex shrink-0 flex-col gap-3 border-b pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="font-mono text-sm text-muted-foreground">
              {String(panel.panelIndex + 1).padStart(2, "0")}
            </span>
            <h2 className="truncate text-lg font-semibold">
              {panel.shotType || copy.panelDescription}
            </h2>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {[
              panel.locationName,
              panel.cameraMove,
              panel.durationSeconds
                ? `${panel.durationSeconds} ${copy.seconds}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "mr-1 text-xs",
              readiness.isReady ? "text-status-success" : "text-status-warning",
            )}
          >
            {readiness.isReady
              ? copy.previsReady
              : `${readiness.complete}/${readiness.total}`}
          </span>
          <Button
            disabled={!canSplit}
            onClick={() => void onSplit(panel.id)}
            size="icon-sm"
            title={tools.split}
            type="button"
            variant="outline"
          >
            <Scissors className="size-4" />
            <span className="sr-only">{tools.split}</span>
          </Button>
          <Button
            disabled={!canMerge}
            onClick={() => void onMerge(panel.id)}
            size="icon-sm"
            title={tools.merge}
            type="button"
            variant="outline"
          >
            <Merge className="size-4" />
            <span className="sr-only">{tools.merge}</span>
          </Button>
          <PanelEditorDialog locale={locale} onSave={onSave} panel={panel} />
        </div>
      </header>

      <Tabs
        className="min-h-[34rem] pt-3 xl:min-h-0 xl:flex-1 xl:overflow-hidden"
        defaultValue="overview"
        key={panel.id}
      >
        <TabsList
          className="max-w-full shrink-0 justify-start overflow-x-auto"
          variant="line"
        >
          <TabsTrigger value="overview">{tools.overview}</TabsTrigger>
          <TabsTrigger value="action">{tools.actionPerformance}</TabsTrigger>
          <TabsTrigger value="camera">{tools.cameraDesign}</TabsTrigger>
          <TabsTrigger value="prompts">{tools.generationPrompts}</TabsTrigger>
          <TabsTrigger value="continuity">
            {tools.continuity}
            {issues.length ? (
              <Badge variant="secondary">{issues.length}</Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          className="mt-0 min-h-0 overflow-y-auto py-5 pr-2"
          value="overview"
        >
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
            <div className="min-w-0 space-y-6">
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground">
                  {copy.panelDescription}
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-base leading-7">
                  {description}
                </p>
              </section>
              <section className="border-t pt-5">
                <h3 className="text-sm font-semibold">{tools.dialogue}</h3>
                <dl className="mt-3 grid gap-4 sm:grid-cols-2">
                  <PanelSpec label={copy.subtitle} value={panel.subtitleText} />
                  <PanelSpec
                    label={tools.speaker}
                    value={panel.speakingCharacter}
                  />
                  <PanelSpec label={tools.lipSync} value={panel.lipSyncText} />
                  <PanelSpec
                    label={tools.voiceover}
                    value={panel.voiceoverText}
                  />
                </dl>
              </section>
            </div>
            <aside className="border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold">{copy.previsReadiness}</span>
                <span className="font-mono text-muted-foreground">
                  {readiness.complete}/{readiness.total}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full bg-status-warning",
                    readiness.isReady && "bg-status-success",
                  )}
                  style={{
                    width: `${(readiness.complete / readiness.total) * 100}%`,
                  }}
                />
              </div>
              {readiness.missing.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {readiness.missing.map((key) => (
                    <Badge key={key} variant="outline">
                      {previsSpecLabel(copy, key)}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <PanelSpec
                  label={tools.scene}
                  value={
                    panel.sceneNumber === null
                      ? null
                      : String(panel.sceneNumber + 1)
                  }
                />
                <PanelSpec
                  label={copy.duration}
                  value={
                    panel.durationSeconds
                      ? `${panel.durationSeconds} ${copy.seconds}`
                      : null
                  }
                />
                <PanelSpec label={copy.location} value={panel.locationName} />
                <PanelSpec
                  label={copy.cast}
                  value={panel.characters.join(" · ")}
                />
                <PanelSpec
                  label={copy.propAssets}
                  value={panel.props.join(" · ")}
                />
              </dl>
            </aside>
          </div>
        </TabsContent>

        <TabsContent
          className="mt-0 min-h-0 overflow-y-auto py-5 pr-2"
          value="action"
        >
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)]">
            <section>
              <h3 className="text-sm font-semibold">{tools.motionBeats}</h3>
              <ol className="mt-3 divide-y border-y">
                {panel.motionBeats.map((beat, index) => (
                  <li
                    className="grid gap-2 py-3 sm:grid-cols-[5rem_minmax(0,1fr)]"
                    key={`${String(beat.startSecond)}-${String(beat.endSecond)}-${index}`}
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {String(beat.startSecond ?? "?")}-
                      {String(beat.endSecond ?? "?")}s
                    </span>
                    <span>
                      <span className="block text-sm">
                        {String(beat.action ?? "-")}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {String(beat.camera ?? "-")}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h3 className="text-sm font-semibold">{copy.actingDirection}</h3>
              <div className="mt-3 divide-y border-y">
                {panel.characters.map((character) => {
                  const direction = acting.find(
                    (item) => item.name === character,
                  );
                  return (
                    <div className="py-3" key={character}>
                      <p className="text-sm font-medium">{character}</p>
                      <dl className="mt-2 grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                        <PanelSpec
                          label={copy.emotion}
                          value={direction?.emotion}
                        />
                        <PanelSpec
                          label={copy.action}
                          value={direction?.action}
                        />
                        <PanelSpec
                          label={copy.expression}
                          value={direction?.expression}
                        />
                      </dl>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
          <section className="mt-7 grid gap-6 border-t pt-5 md:grid-cols-2">
            <StateDetails label={tools.startState} state={panel.startState} />
            <StateDetails label={tools.endState} state={panel.endState} />
          </section>
        </TabsContent>

        <TabsContent
          className="mt-0 min-h-0 overflow-y-auto py-5 pr-2"
          value="camera"
        >
          <section>
            <h3 className="text-sm font-semibold">{tools.cameraDesign}</h3>
            <dl className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
              <PanelSpec
                label={copy.composition}
                value={photography.composition}
              />
              <PanelSpec
                label={copy.focalLength}
                value={photography.focalLength}
              />
              <PanelSpec
                label={copy.cameraPosition}
                value={photography.cameraPosition}
              />
              <PanelSpec label={copy.cameraAngle} value={photography.camera} />
              <PanelSpec label={copy.cameraMove} value={panel.cameraMove} />
              <PanelSpec label={copy.lighting} value={photography.lighting} />
              <PanelSpec
                label={copy.depthOfField}
                value={photography.depthOfField}
              />
              <PanelSpec label={copy.colorTone} value={photography.colorTone} />
            </dl>
          </section>
          <section className="mt-7 border-t pt-5">
            <h3 className="text-sm font-semibold">{tools.worldContext}</h3>
            <dl className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
              <PanelSpec
                label={tools.realm}
                value={recordText(panel.worldContext.realm)}
              />
              <PanelSpec
                label={tools.technique}
                value={recordText(panel.worldContext.technique)}
              />
              <PanelSpec
                label={tools.powerRule}
                value={recordText(panel.worldContext.powerRule)}
              />
              <PanelSpec
                label={tools.environmentScale}
                value={recordText(panel.worldContext.environmentScale)}
              />
            </dl>
          </section>
        </TabsContent>

        <TabsContent
          className="mt-0 min-h-0 overflow-y-auto py-5 pr-2"
          value="prompts"
        >
          <div className="grid gap-7 lg:grid-cols-2">
            <PromptBlock label={tools.imagePrompt} value={panel.imagePrompt} />
            <PromptBlock label={tools.videoPrompt} value={panel.videoPrompt} />
          </div>
          <section className="mt-7 grid gap-7 border-t pt-5 lg:grid-cols-2">
            <CueList
              cues={panel.vfxCues}
              label={tools.vfxCues}
              locale={locale}
              time={(cue) => `${String(cue.atSecond ?? "?")}s`}
            />
            <CueList
              cues={panel.sfxCues}
              label={tools.sfxCues}
              locale={locale}
              time={(cue) =>
                `${String(cue.startSecond ?? "?")}-${String(cue.endSecond ?? "?")}s`
              }
            />
          </section>
          {panel.sourceEvidence.length ? (
            <section className="mt-7 border-t pt-5">
              <h3 className="text-sm font-semibold">{tools.sourceEvidence}</h3>
              <div className="mt-3 space-y-3">
                {panel.sourceEvidence.map((evidence) => (
                  <p
                    className="border-l-2 pl-3 text-sm leading-6 text-muted-foreground"
                    key={evidence}
                  >
                    {evidence}
                  </p>
                ))}
              </div>
            </section>
          ) : null}
        </TabsContent>

        <TabsContent
          className="mt-0 min-h-0 overflow-y-auto py-5 pr-2"
          value="continuity"
        >
          {issues.length ? (
            <div className="space-y-3">
              {issues.map((issue, index) => (
                <Alert
                  key={`${issue.code}-${index}`}
                  variant={
                    issue.severity === "error" ? "destructive" : "default"
                  }
                >
                  <TriangleAlert />
                  <AlertTitle>{issue.entityName || issue.code}</AlertTitle>
                  <AlertDescription>
                    {issue.message}
                    {issue.suggestedFix ? (
                      <span className="mt-1 block">
                        {copy.suggestedFix}：{issue.suggestedFix}
                      </span>
                    ) : null}
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          ) : (
            <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-status-success">
              <CircleCheck className="size-4" />
              {tools.noContinuityIssues}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

function PromptBlock({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <section className="min-w-0">
      <h3 className="text-sm font-semibold">{label}</h3>
      <p className="mt-3 whitespace-pre-wrap border-y py-4 text-sm leading-6 text-foreground/90">
        {value || "-"}
      </p>
    </section>
  );
}

function PanelSpec({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 wrap-break-word text-sm">{value || "-"}</dd>
    </div>
  );
}

function StateDetails({
  label,
  state,
}: {
  label: string;
  state: Record<string, unknown>;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{label}</h3>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {Object.entries(state).map(([key, value]) => (
          <PanelSpec key={key} label={key} value={String(value)} />
        ))}
      </dl>
    </div>
  );
}

function CueList({
  cues,
  label,
  locale,
  time,
}: {
  cues: Array<Record<string, unknown>>;
  label: string;
  locale: StudioLocale;
  time: (cue: Record<string, unknown>) => string;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{label}</h3>
      {cues.length ? (
        <ol className="mt-3 divide-y border-y">
          {cues.map((cue, index) => (
            <li
              className="grid gap-2 py-3 sm:grid-cols-[5rem_minmax(0,1fr)]"
              key={`${time(cue)}-${index}`}
            >
              <span className="font-mono text-xs text-muted-foreground">
                {time(cue)}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">
                    {cueLabel(
                      locale,
                      recordText(cue.phase) ||
                        recordText(cue.type) ||
                        recordText(cue.category),
                    )}
                  </Badge>
                  {cue.category ? (
                    <span className="text-xs text-muted-foreground">
                      {cueLabel(locale, recordText(cue.category))}
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-sm">
                  {recordText(cue.description) || "-"}
                </span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">-</p>
      )}
    </div>
  );
}

function recordText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function cueLabel(locale: StudioLocale, value?: string) {
  if (!value) return "-";
  const labels: Record<string, readonly [string, string]> = {
    anticipation: ["起手", "Anticipation"],
    charge: ["蓄力", "Charge"],
    release: ["释放", "Release"],
    travel: ["传播 / 交锋", "Travel / exchange"],
    impact: ["命中", "Impact"],
    aftermath: ["受力 / 收势", "Aftermath"],
    skill_energy: ["技能能量", "Skill energy"],
    weapon_trail: ["武器轨迹", "Weapon trail"],
    shockwave: ["冲击波", "Shockwave"],
    explosion_debris: ["爆炸 / 破碎", "Explosion / debris"],
    elemental_spell: ["元素法术", "Elemental spell"],
    speed_afterimage: ["速度线 / 残影", "Speed / afterimage"],
    shield_barrier: ["护盾 / 结界", "Shield / barrier"],
    transformation_summon: ["变身 / 召唤", "Transformation / summon"],
    environment_interaction: ["环境交互", "Environment interaction"],
    foley: ["拟音", "Foley"],
    weapon: ["武器", "Weapon"],
    energy: ["能量", "Energy"],
    environment: ["环境", "Environment"],
    destruction: ["破坏", "Destruction"],
  };
  const label = labels[value];
  return label?.[locale === "en" ? 1 : 0] ?? value.replaceAll("_", " ");
}

function previsSpecLabel(
  copy: ReturnType<typeof getStudioCopy>,
  key: PrevisSpecKey,
) {
  if (key === "cameraMovement") return copy.cameraMove;
  if (key === "performance") return copy.actingDirection;
  return copy[key];
}

function WorkflowButtons({
  disabled,
  hasWorkflow,
  locale,
  onAction,
  onStart,
  status,
}: {
  disabled: boolean;
  hasWorkflow: boolean;
  locale: StudioLocale;
  onAction: (action: "cancel" | "retry" | "pause" | "resume") => void;
  onStart: () => void;
  status?: string;
}) {
  const copy = getStudioCopy(locale);
  if (status === "running") {
    return (
      <div className="flex gap-2">
        <Button
          disabled={disabled}
          onClick={() => onAction("pause")}
          size="sm"
          variant="outline"
        >
          <Pause className="size-4" />
          {copy.pauseWorkflow}
        </Button>
        <Button
          disabled={disabled}
          onClick={() => onAction("cancel")}
          size="sm"
          variant="outline"
        >
          <Ban className="size-4" />
          {copy.cancelWorkflow}
        </Button>
      </div>
    );
  }
  if (status === "queued" || status === "canceling") {
    return (
      <Button
        disabled={disabled || status === "canceling"}
        onClick={() => onAction("cancel")}
        size="sm"
        variant="outline"
      >
        <Ban className="size-4" />
        {copy.cancelWorkflow}
      </Button>
    );
  }
  if (status === "paused") {
    return (
      <div className="flex gap-2">
        <Button
          disabled={disabled}
          onClick={() => onAction("resume")}
          size="sm"
        >
          <Play className="size-4" />
          {copy.resumeWorkflow}
        </Button>
        <Button
          disabled={disabled}
          onClick={() => onAction("cancel")}
          size="sm"
          variant="outline"
        >
          <Ban className="size-4" />
          {copy.cancelWorkflow}
        </Button>
      </div>
    );
  }
  if (status === "failed" || status === "blocked") {
    return (
      <div className="flex gap-2">
        <Button
          disabled={disabled}
          onClick={() => onAction("retry")}
          size="sm"
          variant="outline"
        >
          <RotateCcw className="size-4" />
          {copy.retryWorkflow}
        </Button>
        <Button disabled={disabled} onClick={onStart} size="sm">
          <Play className="size-4" />
          {copy.rerunStoryboard}
        </Button>
      </div>
    );
  }
  return (
    <Button disabled={disabled} onClick={onStart} size="sm">
      {disabled ? (
        <LoaderCircle className="size-4 animate-spin" />
      ) : hasWorkflow ? (
        <RotateCcw className="size-4" />
      ) : (
        <Play className="size-4" />
      )}
      {hasWorkflow ? copy.rerunStoryboard : copy.startStoryboard}
    </Button>
  );
}
