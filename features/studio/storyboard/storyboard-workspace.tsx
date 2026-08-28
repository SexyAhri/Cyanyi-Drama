"use client";

import {
  Ban,
  CircleCheck,
  Clapperboard,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  ListChecks,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Merge,
  TriangleAlert,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { ModelSelect } from "../components/model-select";
import { StatusIndicator } from "../components/status-indicator";
import { getStudioCopy } from "../i18n";
import { getProductionCopy } from "../production/copy";
import { DepartmentDeliverablesWorkspace } from "../production/department-deliverables";
import {
  getWorkflowForStage,
  getWorkflowContentRevision,
  runtimeStatusToStageStatus,
} from "../stage-state";
import type {
  StudioLocale,
  StudioModelOption,
  StudioSelectionContext,
  StudioStoryboardData,
  StudioStoryboardPanel,
  WorkspaceSnapshot,
} from "../types";
import { PanelEditorDialog } from "./panel-editor-dialog";
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

type StoryboardTab = "shots" | "previs" | "shot_list" | "animatic";

export function StoryboardWorkspace({
  episode,
  locale,
  models,
  onContextChange,
  onRefresh,
  snapshot,
}: {
  episode: WorkspaceSnapshot["project"]["episodes"][number];
  locale: StudioLocale;
  models: StudioModelOption[];
  onContextChange: (selection?: StudioSelectionContext) => void;
  onRefresh: () => Promise<unknown> | void;
  snapshot: WorkspaceSnapshot;
}) {
  const copy = getStudioCopy(locale);
  const productionCopy = getProductionCopy(locale);
  const [data, setData] = useState<StudioStoryboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [selectedPanelId, setSelectedPanelId] = useState("");
  const [modelId, setModelId] = useState("");
  const [tab, setTab] = useState<StoryboardTab>("shots");
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

  useEffect(() => {
    if (models.some((model) => model.id === modelId)) return;
    const configured = models.find(
      (model) => model.modelId === snapshot.project.config.storyboardModel,
    );
    setModelId(configured?.id ?? models[0]?.id ?? "");
  }, [modelId, models, snapshot.project.config.storyboardModel]);

  const panels = useMemo(
    () => data?.storyboard?.panels ?? [],
    [data?.storyboard?.panels],
  );
  const selectedPanel =
    panels.find((panel) => panel.id === selectedPanelId) ?? panels[0];

  useEffect(() => {
    if (tab !== "shots") return;
    onContextChange(
      selectedPanel
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
  }, [copy.panel, onContextChange, selectedPanel, tab]);

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
    const model = models.find((item) => item.id === modelId);
    if (!model) return;
    setIsActing(true);
    try {
      const result = await startStudioStoryboardWorkflow(
        projectId,
        episode.id,
        {
          channelId: model.channelId,
          model: model.modelId,
          locale: locale === "en" ? "en" : "zh",
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

  async function approveReview() {
    if (!data?.storyboard || data.contentReview.blockingIssueCount) return;
    await savePanels(data.storyboard.panels, "ready");
  }

  const workflowActive = workflow
    ? ["queued", "running", "canceling", "paused"].includes(workflow.status)
    : false;

  if (isLoading && !data) {
    return (
      <div className="flex h-full min-h-96 items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-7 sm:py-7 xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden">
      <header className="flex shrink-0 flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {String(episode.episodeNumber).padStart(2, "0")} · {episode.name}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold">
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
        {tab === "shots" ? (
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <ModelSelect
              ariaLabel={copy.storyboardModel}
              className="h-8 sm:w-64"
              disabled={isActing || workflowActive}
              models={models}
              onChange={setModelId}
              placeholder={copy.storyboardModel}
              value={modelId}
            />
            <WorkflowButtons
              disabled={isActing}
              hasWorkflow={Boolean(workflow)}
              locale={locale}
              modelReady={Boolean(modelId)}
              onAction={controlWorkflow}
              onStart={startWorkflow}
              status={workflow?.status}
            />
          </div>
        ) : null}
      </header>

      <Tabs
        className="min-w-0 pt-4 xl:min-h-0 xl:flex-1 xl:overflow-hidden"
        onValueChange={(value) => setTab(value as StoryboardTab)}
        value={tab}
      >
        <TabsList
          className="max-w-full shrink-0 overflow-x-auto"
          variant="line"
        >
          <TabsTrigger value="shots">
            <Clapperboard className="size-4" />
            {productionCopy.shotDesign}
          </TabsTrigger>
          <TabsTrigger value="previs">
            <FileCheck2 className="size-4" />
            {productionCopy.previsDepartment}
          </TabsTrigger>
          <TabsTrigger value="shot_list">
            <ListChecks className="size-4" />
            {productionCopy.shotList}
          </TabsTrigger>
          <TabsTrigger value="animatic">
            <Video className="size-4" />
            {productionCopy.animatic}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          className="mt-4 xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden"
          value="shots"
        >
          {!models.length ? (
            <p className="border-b py-3 text-xs text-destructive">
              {copy.noAnalysisModels}
            </p>
          ) : null}
          {error ? (
            <div className="flex items-center justify-between gap-3 border-b py-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button onClick={() => void load()} size="sm" variant="outline">
                {copy.retry}
              </Button>
            </div>
          ) : null}

          {data?.storyboard ? (
            <ContentReviewOverview
              data={data}
              isActing={isActing}
              locale={locale}
              onApprove={approveReview}
            />
          ) : null}

          {data?.continuityIssues.length ? (
            <ContinuityOverview data={data} locale={locale} />
          ) : data?.storyboard ? (
            <div className="flex items-center gap-2 border-b py-3 text-xs text-status-success">
              <CircleCheck className="size-4" />
              {copy.continuityClear}
            </div>
          ) : null}

          {!panels.length ? (
            <div className="flex min-h-96 flex-col items-center justify-center gap-3 border-b text-center text-muted-foreground">
              <Clapperboard className="size-6" />
              <p className="max-w-md text-sm leading-6">{copy.noStoryboard}</p>
            </div>
          ) : (
            <div className="grid min-h-152 border-b lg:grid-cols-[18rem_minmax(0,1fr)] xl:min-h-0 xl:flex-1 xl:overflow-hidden">
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
        </TabsContent>

        <TabsContent
          className="mt-4 xl:min-h-0 xl:overflow-y-auto"
          value="previs"
        >
          {tab === "previs" ? (
            <DepartmentDeliverablesWorkspace
              defaultType="directors_treatment"
              departments={["previs"]}
              episodeId={episode.id}
              locale={locale}
              onContextChange={onContextChange}
              projectId={projectId}
              title={productionCopy.previsDepartment}
            />
          ) : null}
        </TabsContent>
        <TabsContent
          className="mt-4 xl:min-h-0 xl:overflow-y-auto"
          value="shot_list"
        >
          {tab === "shot_list" ? (
            <DepartmentDeliverablesWorkspace
              defaultType="shot_list"
              departments={["previs"]}
              episodeId={episode.id}
              locale={locale}
              onContextChange={onContextChange}
              projectId={projectId}
              title={productionCopy.shotList}
              types={[
                "blocking",
                "shot_list",
                "cinematography_plan",
                "performance_plan",
                "previs",
              ]}
            />
          ) : null}
        </TabsContent>
        <TabsContent
          className="mt-4 xl:min-h-0 xl:overflow-y-auto"
          value="animatic"
        >
          {tab === "animatic" ? (
            <DepartmentDeliverablesWorkspace
              defaultType="animatic"
              departments={["previs"]}
              episodeId={episode.id}
              locale={locale}
              onContextChange={onContextChange}
              projectId={projectId}
              title={productionCopy.animatic}
              types={["animatic"]}
            />
          ) : null}
        </TabsContent>
      </Tabs>
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
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const description = panel.description || copy.panelDescription;
  const canExpandDescription = description.length > 180;
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
        };

  useEffect(() => {
    setDescriptionExpanded(false);
  }, [panel.id]);

  return (
    <section className="min-w-0 p-4 sm:p-6 xl:min-h-0 xl:overflow-y-auto">
      <header className="flex items-start justify-between gap-4 border-b pb-4">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">
            {copy.panel} {String(panel.panelIndex + 1).padStart(2, "0")}
          </p>
          <h2 className="mt-1 text-base font-semibold">
            {panel.shotType || copy.panelDescription}
          </h2>
          <p
            className={cn(
              "mt-1 text-xs",
              readiness.isReady ? "text-status-success" : "text-status-warning",
            )}
          >
            {readiness.isReady
              ? copy.previsReady
              : copy.previsIncomplete.replace(
                  "{count}",
                  String(readiness.missing.length),
                )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            disabled={!canSplit}
            onClick={() => void onSplit(panel.id)}
            size="sm"
            title={tools.split}
            type="button"
            variant="outline"
          >
            <Scissors className="size-4" />
            <span className="hidden sm:inline">{tools.split}</span>
          </Button>
          <Button
            disabled={!canMerge}
            onClick={() => void onMerge(panel.id)}
            size="sm"
            title={tools.merge}
            type="button"
            variant="outline"
          >
            <Merge className="size-4" />
            <span className="hidden sm:inline">{tools.merge}</span>
          </Button>
          <PanelEditorDialog locale={locale} onSave={onSave} panel={panel} />
        </div>
      </header>

      <div className="max-w-4xl border-b py-4">
        <p
          className={cn(
            "whitespace-pre-wrap text-sm leading-6 text-foreground/90",
            canExpandDescription && !descriptionExpanded && "line-clamp-5",
          )}
        >
          {description}
        </p>
        {canExpandDescription ? (
          <Button
            className="mt-1.5 h-7 px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => setDescriptionExpanded((expanded) => !expanded)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {descriptionExpanded ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
            {descriptionExpanded
              ? copy.collapseDescription
              : copy.expandDescription}
          </Button>
        ) : null}
      </div>

      <div className="border-b py-4">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="font-semibold">{copy.previsReadiness}</span>
          <span className="font-mono text-muted-foreground">
            {readiness.complete}/{readiness.total}
          </span>
        </div>
        <div
          aria-label={copy.previsReadiness}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemax={readiness.total}
          aria-valuemin={0}
          aria-valuenow={readiness.complete}
        >
          <div
            className={cn(
              "h-full bg-status-warning transition-[width]",
              readiness.isReady && "bg-status-success",
            )}
            style={{
              width: `${(readiness.complete / readiness.total) * 100}%`,
            }}
          />
        </div>
        {readiness.missing.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] text-muted-foreground">
              {copy.missingSpecifications}
            </span>
            {readiness.missing.map((key) => (
              <Badge key={key} variant="outline">
                {previsSpecLabel(copy, key)}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <dl className="grid gap-x-6 gap-y-4 border-b py-5 sm:grid-cols-2 xl:grid-cols-3">
        <PanelSpec
          label={tools.scene}
          value={
            panel.sceneNumber === null ? null : String(panel.sceneNumber + 1)
          }
        />
        <PanelSpec label={copy.location} value={panel.locationName} />
        <PanelSpec label={copy.composition} value={photography.composition} />
        <PanelSpec label={copy.focalLength} value={photography.focalLength} />
        <PanelSpec
          label={copy.cameraPosition}
          value={photography.cameraPosition}
        />
        <PanelSpec label={copy.cameraAngle} value={photography.camera} />
        <PanelSpec label={copy.cameraMove} value={panel.cameraMove} />
        <PanelSpec label={copy.lighting} value={photography.lighting} />
        <PanelSpec label={copy.depthOfField} value={photography.depthOfField} />
        <PanelSpec label={copy.colorTone} value={photography.colorTone} />
        <PanelSpec
          label={copy.duration}
          value={
            panel.durationSeconds
              ? `${panel.durationSeconds} ${copy.seconds}`
              : null
          }
        />
        <PanelSpec label={copy.cast} value={panel.characters.join(" · ")} />
        <PanelSpec label={copy.propAssets} value={panel.props.join(" · ")} />
        <PanelSpec label={copy.subtitle} value={panel.subtitleText} />
        <PanelSpec label={tools.speaker} value={panel.speakingCharacter} />
        <PanelSpec label={tools.lipSync} value={panel.lipSyncText} />
        <PanelSpec label={tools.voiceover} value={panel.voiceoverText} />
      </dl>

      <section className="grid gap-5 border-b py-5 md:grid-cols-2">
        <StateDetails label={tools.startState} state={panel.startState} />
        <StateDetails label={tools.endState} state={panel.endState} />
      </section>

      {panel.motionBeats.length ? (
        <section className="border-b py-5">
          <h3 className="text-sm font-semibold">{tools.motionBeats}</h3>
          <ol className="mt-3 divide-y border-y">
            {panel.motionBeats.map((beat, index) => (
              <li
                className="grid gap-2 py-3 text-sm sm:grid-cols-[5rem_minmax(0,1fr)]"
                key={`${String(beat.startSecond)}-${String(beat.endSecond)}-${index}`}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {String(beat.startSecond ?? "?")}-
                  {String(beat.endSecond ?? "?")}s
                </span>
                <span className="space-y-1">
                  <span className="block">{String(beat.action ?? "-")}</span>
                  <span className="block text-xs text-muted-foreground">
                    {String(beat.camera ?? "-")}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {Object.keys(panel.worldContext).length ? (
        <section className="border-b py-5">
          <h3 className="text-sm font-semibold">{tools.worldContext}</h3>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <PanelSpec label={tools.realm} value={recordText(panel.worldContext.realm)} />
            <PanelSpec label={tools.technique} value={recordText(panel.worldContext.technique)} />
            <PanelSpec label={tools.powerRule} value={recordText(panel.worldContext.powerRule)} />
            <PanelSpec label={tools.environmentScale} value={recordText(panel.worldContext.environmentScale)} />
          </dl>
        </section>
      ) : null}

      {panel.vfxCues.length || panel.sfxCues.length ? (
        <section className="grid gap-6 border-b py-5 lg:grid-cols-2">
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
            time={(cue) => `${String(cue.startSecond ?? "?")}-${String(cue.endSecond ?? "?")}s`}
          />
        </section>
      ) : null}

      {panel.characters.length ? (
        <section className="border-b py-5">
          <h3 className="text-sm font-semibold">{copy.actingDirection}</h3>
          <div className="mt-3 divide-y border-y">
            {panel.characters.map((character) => {
              const direction = acting.find((item) => item.name === character);
              return (
                <div
                  className="grid gap-3 py-3 sm:grid-cols-[10rem_repeat(3,minmax(0,1fr))]"
                  key={character}
                >
                  <p className="text-sm font-medium">{character}</p>
                  <PanelSpec label={copy.emotion} value={direction?.emotion} />
                  <PanelSpec label={copy.action} value={direction?.action} />
                  <PanelSpec
                    label={copy.expression}
                    value={direction?.expression}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {issues.length ? (
        <div className="space-y-2 py-5">
          <h3 className="text-sm font-semibold">{copy.continuity}</h3>
          {issues.map((issue, index) => (
            <Alert
              key={`${issue.code}-${index}`}
              variant={issue.severity === "error" ? "destructive" : "default"}
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
      ) : null}

      {panel.sourceEvidence.length ? (
        <div className="border-t py-5">
          <h3 className="text-sm font-semibold">{copy.sourceEvidence}</h3>
          <div className="mt-2 space-y-2">
            {panel.sourceEvidence.map((evidence) => (
              <p
                className="border-l-2 pl-3 text-sm leading-6 text-muted-foreground"
                key={evidence}
              >
                {evidence}
              </p>
            ))}
          </div>
        </div>
      ) : null}
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
                    {cueLabel(locale, recordText(cue.phase) || recordText(cue.type) || recordText(cue.category))}
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

function ContentReviewOverview({
  data,
  isActing,
  locale,
  onApprove,
}: {
  data: StudioStoryboardData;
  isActing: boolean;
  locale: StudioLocale;
  onApprove: () => Promise<unknown> | void;
}) {
  const review = data.contentReview;
  const approved = data.storyboard?.status === "ready";
  const text =
    locale === "zh-CN"
      ? {
          title: "内容审核",
          clear: "原文事件、台词、时长与连续状态检查通过",
          approved: "推演内容已人工确认",
          coverage: "原文事件覆盖",
          issues: "待修复",
          inferences: "有依据的合理推演",
          approve: "确认推演并通过",
          blocked: "修复阻断项后才能通过",
          evidence: "依据",
          rationale: "理由",
          performance: "表演细节",
          continuity: "连续性姿态",
          production_detail: "制作细节",
        }
      : {
          title: "Content review",
          clear:
            "Source events, dialogue, timing, and continuity checks passed",
          approved: "Inferred details approved",
          coverage: "Source event coverage",
          issues: "Needs correction",
          inferences: "Grounded inferences",
          approve: "Approve inferences",
          blocked: "Resolve blocking items before approval",
          evidence: "Evidence",
          rationale: "Rationale",
          performance: "Performance detail",
          continuity: "Continuity blocking",
          production_detail: "Production detail",
        };
  const hasDetails = review.issues.length > 0 || review.inferences.length > 0;

  return (
    <details className="border-b py-3" open={review.blockingIssueCount > 0}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
          {review.blockingIssueCount ? (
            <TriangleAlert className="size-4 shrink-0 text-status-warning" />
          ) : (
            <FileCheck2 className="size-4 shrink-0 text-status-success" />
          )}
          <span className="truncate">
            {text.title} ·{" "}
            {approved && review.inferences.length ? text.approved : text.clear}
          </span>
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {text.coverage} {review.coverage.covered}/{review.coverage.total}
        </span>
      </summary>
      {hasDetails ? (
        <div className="mt-4 space-y-5 pl-6">
          {review.issues.length ? (
            <section>
              <h3 className="text-xs font-semibold">
                {text.issues} · {review.issues.length}
              </h3>
              <div className="mt-2 divide-y border-y">
                {review.issues.map((issue, index) => (
                  <p
                    className="py-2 text-xs leading-5 text-muted-foreground"
                    key={`${issue.clipId}-${issue.code}-${index}`}
                  >
                    <strong className="mr-2 font-medium text-foreground">
                      {issue.panelIndex === null
                        ? issue.code
                        : `${issue.code} · ${String(issue.panelIndex + 1).padStart(2, "0")}`}
                    </strong>
                    {issue.message}
                  </p>
                ))}
              </div>
            </section>
          ) : null}
          {review.inferences.length ? (
            <section>
              <h3 className="text-xs font-semibold">
                {text.inferences} · {review.inferences.length}
              </h3>
              <div className="mt-2 divide-y border-y">
                {review.inferences.map((inference, index) => (
                  <div
                    className="py-3 text-xs leading-5"
                    key={`${inference.clipId}-${inference.sceneNumber}-${index}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {text[inference.inferenceType]}
                      </Badge>
                      <span className="font-mono text-muted-foreground">
                        {Math.round(inference.confidence * 100)}%
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm">{inference.text}</p>
                    <p className="mt-1 text-muted-foreground">
                      {text.rationale}：{inference.rationale}
                    </p>
                    <p className="text-muted-foreground">
                      {text.evidence}：{inference.evidence.join(" · ")}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {data.storyboard?.status === "review_required" ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={isActing || review.blockingIssueCount > 0}
                onClick={() => void onApprove()}
                size="sm"
                type="button"
              >
                <FileCheck2 className="size-4" />
                {text.approve}
              </Button>
              {review.blockingIssueCount ? (
                <p className="text-xs text-status-warning">{text.blocked}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function ContinuityOverview({
  data,
  locale,
}: {
  data: StudioStoryboardData;
  locale: StudioLocale;
}) {
  const copy = getStudioCopy(locale);
  return (
    <details className="border-b py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
        <TriangleAlert className="size-4 text-status-warning" />
        {copy.continuityIssues.replace(
          "{count}",
          String(data.continuityIssues.length),
        )}
      </summary>
      <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pl-6">
        {data.continuityIssues.map((issue, index) => (
          <p
            className="text-xs leading-5 text-muted-foreground"
            key={`${issue.clipId}-${issue.code}-${index}`}
          >
            <strong className="font-medium text-foreground">
              {issue.entityName || issue.code}
            </strong>{" "}
            {issue.message}
          </p>
        ))}
      </div>
    </details>
  );
}

function WorkflowButtons({
  disabled,
  hasWorkflow,
  locale,
  modelReady,
  onAction,
  onStart,
  status,
}: {
  disabled: boolean;
  hasWorkflow: boolean;
  locale: StudioLocale;
  modelReady: boolean;
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
        <Button disabled={disabled || !modelReady} onClick={onStart} size="sm">
          <Play className="size-4" />
          {copy.rerunStoryboard}
        </Button>
      </div>
    );
  }
  return (
    <Button disabled={disabled || !modelReady} onClick={onStart} size="sm">
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
