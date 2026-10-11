"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FolderX, LoaderCircle, RotateCcw, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { AuthUser } from "@/lib/server/auth";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";

import { useStudioLocale } from "../hooks/use-studio-locale";
import { useStudioModels } from "../hooks/use-studio-models";
import { useStudioWideLayout } from "../hooks/use-studio-wide-layout";
import { useWorkspace } from "../hooks/use-workspace";
import { getStudioCopy } from "../i18n";
import { AssetsWorkspace } from "../assets/assets-workspace";
import { AudioWorkspace } from "../audio/audio-workspace";
import { DeliveryWorkspace } from "../delivery/delivery-workspace";
import { ShotsWorkspace } from "../shots/shots-workspace";
import { StoryboardWorkspace } from "../storyboard/storyboard-workspace";
import {
  getSelectedEpisode,
  getStudioStageStates,
  STUDIO_STAGE_IDS,
} from "../stage-state";
import type {
  ProductionDeliverableCatalog,
  StudioSelectionContext,
  StudioStageId,
} from "../types";
import { StudioInspector } from "../inspector/studio-inspector";
import { operationErrorMessage } from "../inspector/inspector-view-model";
import { EpisodeSidebar } from "./episode-sidebar";
import { StageNavigation } from "./stage-navigation";
import { DirectorWorkflowBar } from "./director-workflow-bar";
import { StageOverview } from "./stage-overview";
import { WorkspaceTopbar } from "./workspace-topbar";
import { WritingWorkspace } from "../writing/writing-workspace";
import {
  loadStudioDeliverables,
  updateStudioProjectConfig,
  startStudioEpisodePreproduction,
} from "../api";
import { CanvasWorkspace } from "../canvas/canvas-workspace";

export function WorkspacePage({
  projectId,
  user,
}: {
  projectId: string;
  user: AuthUser;
}) {
  const { locale, toggleLocale } = useStudioLocale();
  const wideLayout = useStudioWideLayout();
  const copy = getStudioCopy(locale);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [deliverables, setDeliverables] =
    useState<ProductionDeliverableCatalog | null>(null);
  const [canvasSelections, setCanvasSelections] = useState<
    StudioSelectionContext[]
  >([]);
  const selectCanvasNode = useRef<((nodeId: string) => void) | undefined>(
    undefined,
  );
  const editCanvasPanel = useRef<((nodeId: string) => void) | undefined>(
    undefined,
  );
  const [selection, setSelection] = useState<StudioSelectionContext>();
  const [analysisModelId, setAnalysisModelId] = useState("");
  const [startingPreparation, setStartingPreparation] = useState(false);
  const [packageSync, setPackageSync] = useState<{ key: string; error?: string }>({ key: "" });
  const [packageSyncRevision, setPackageSyncRevision] = useState(0);
  const previousWorkflowSteps = useRef<Map<string, string> | null>(null);
  const beforeCanvasLeave = useRef<(() => Promise<boolean>) | undefined>(
    undefined,
  );
  const {
    analysisModels,
    audioModels,
    imageModels,
    lipSyncModels,
    videoModels,
  } = useStudioModels();
  const { createEpisode, error, isLoading, isRefreshing, refresh, snapshot } =
    useWorkspace(projectId);

  const dossierRevision = snapshot?.workflows.filter(run => run.workflowType === "manuscript-analysis" && run.status === "succeeded")
    .map(run => `${run.id}:${run.updatedAt}`).join("|") ?? "";
  useEffect(() => {
    const controller = new AbortController();
    void loadStudioDeliverables(projectId, controller.signal)
      .then((catalog) => {
        if (!controller.signal.aborted) setDeliverables(catalog);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDeliverables(null);
      });
    return () => controller.abort();
  }, [projectId, dossierRevision]);

  async function refreshStudioData() {
    const [result, catalog] = await Promise.all([
      refresh(),
      loadStudioDeliverables(projectId).catch(() => null),
    ]);
    if (catalog) setDeliverables(catalog);
    return result;
  }

  const requestedEpisodeId = searchParams.get("episode") ?? undefined;
  const canvasOpen = searchParams.get("view") === "canvas";
  const inspectorVisible =
    activityOpen || (!canvasOpen && wideLayout && !inspectorCollapsed);
  const requestedStage = searchParams.get("stage") as StudioStageId | null;
  const activeStage =
    requestedStage && STUDIO_STAGE_IDS.includes(requestedStage)
      ? requestedStage
      : "writing";
  const fixedHeightWorkspace = [
    "writing",
    "assets",
    "storyboard",
    "shots",
    "audio",
  ].includes(activeStage);
  const selectedEpisode = snapshot
    ? getSelectedEpisode(snapshot.project.episodes, requestedEpisodeId)
    : undefined;
  const packageEpisodeId = selectedEpisode?.activeSourceKind === "adapted"
    ? selectedEpisode.id : undefined;
  const packageSourceId = selectedEpisode?.activeSourceId;
  const packageSyncKey = `${projectId}:${packageEpisodeId ?? ""}:${packageSourceId ?? ""}:${packageSyncRevision}`;
  const packageSyncPending = Boolean(packageEpisodeId && packageSync.key !== packageSyncKey);
  useEffect(() => {
    if (!packageEpisodeId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(packageEpisodeId)}/reuse-package`, {
          method: "POST", signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "同步策划内容失败");
        await refresh();
        if (!controller.signal.aborted) setPackageSync({ key: packageSyncKey });
      } catch (error) {
        if (!controller.signal.aborted) setPackageSync({ key: packageSyncKey,
          error: error instanceof Error ? error.message : "同步策划内容失败" });
      }
    })();
    return () => controller.abort();
  }, [packageEpisodeId, packageSyncKey, projectId, refresh]);
  const stages = snapshot
    ? getStudioStageStates(snapshot, selectedEpisode?.id)
    : [];
  const selectedStage =
    stages.find((stage) => stage.id === activeStage) ?? stages[0];
  const inspectorContext = useMemo(
    () => ({
      episodeId: selectedEpisode?.id,
      selection,
      stageId: activeStage,
      view: canvasOpen ? ("canvas" as const) : ("workflow" as const),
      canvasNodeId:
        typeof selection?.metadata?.canvasNodeId === "string"
          ? selection.metadata.canvasNodeId
          : undefined,
    }),
    [activeStage, selectedEpisode?.id, selection, canvasOpen],
  );

  useEffect(() => {
    setSelection(undefined);
  }, [activeStage, selectedEpisode?.id]);

  useEffect(() => {
    if (analysisModels.some((model) => model.id === analysisModelId)) return;
    const configured = analysisModels.find(
      (model) => model.modelId === snapshot?.project.config.analysisModel,
    );
    setAnalysisModelId(configured?.id ?? analysisModels[0]?.id ?? "");
  }, [analysisModelId, analysisModels, snapshot?.project.config.analysisModel]);

  function changeAnalysisModel(nextModelId: string) {
    const model = analysisModels.find((item) => item.id === nextModelId);
    if (!model) return;
    setAnalysisModelId(nextModelId);
    void updateStudioProjectConfig(projectId, {
      analysisModel: model.modelId,
    }).catch((requestError) => {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : copy.actionFailed,
      );
    });
  }

  useEffect(() => {
    if (!snapshot) return;
    const current = new Map<string, string>();
    for (const workflow of snapshot.workflows) {
      for (const step of workflow.steps) {
        const state = `${step.status}:${step.attempt}`;
        current.set(step.id, state);
        const previous = previousWorkflowSteps.current?.get(step.id);
        if (
          previous &&
          previous !== state &&
          ["blocked", "failed"].includes(step.status)
        ) {
          const title =
            locale === "zh-CN"
              ? `工作流第 ${step.attempt} 次运行失败，可手动重试`
              : `Workflow run attempt ${step.attempt} failed; manual retry is available`;
          toast.error(title, {
            description: operationErrorMessage(step.error, locale),
            id: `workflow-failure-${step.id}-${step.attempt}`,
          });
        }
      }
    }
    previousWorkflowSteps.current = current;
  }, [locale, snapshot]);

  useEffect(() => {
    if (!snapshot || !selectedEpisode) return;
    if (
      requestedEpisodeId === selectedEpisode.id &&
      requestedStage === activeStage
    ) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("episode", selectedEpisode.id);
    params.set("stage", activeStage);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }, [
    activeStage,
    pathname,
    requestedEpisodeId,
    requestedStage,
    router,
    searchParams,
    selectedEpisode,
    snapshot,
  ]);

  async function updateSelection(input: {
    episodeId?: string;
    stageId?: StudioStageId;
  }) {
    if (beforeCanvasLeave.current && !(await beforeCanvasLeave.current()))
      return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("view");
    if (input.episodeId) params.set("episode", input.episodeId);
    if (input.stageId) params.set("stage", input.stageId);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }

  async function changeCanvasView(open: boolean) {
    if (
      !open &&
      beforeCanvasLeave.current &&
      !(await beforeCanvasLeave.current())
    )
      return;
    const params = new URLSearchParams(searchParams.toString());
    if (open) params.set("view", "canvas");
    else params.delete("view");
    if (selection?.kind === "panel") params.set("panel", selection.id);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }

  async function openPanel(panelId: string) {
    if (beforeCanvasLeave.current && !(await beforeCanvasLeave.current()))
      return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("view");
    params.set("stage", "shots");
    params.set("panel", panelId);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }
  function openActivity() {
    setActivityOpen(true);
  }

  if (isLoading && !snapshot) {
    return (
      <div className="flex h-dvh items-center justify-center gap-2 bg-background text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        {copy.loadingWorkspace}
      </div>
    );
  }

  if (!snapshot || error) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background p-4">
        <Empty className="max-w-lg border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderX />
            </EmptyMedia>
            <EmptyTitle>{copy.projectNotFound}</EmptyTitle>
            <EmptyDescription>{error ?? copy.loadFailed}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => void refresh()} variant="outline">
              <RotateCcw className="size-4" />
              {copy.retry}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const selectedReadiness = selectedEpisode ? snapshot.readiness?.episodes[selectedEpisode.id] : undefined;
  const preparationNeedsReview = Boolean(selectedReadiness?.storyboard && !selectedReadiness.storyboardApproved);
  async function prepareEpisode() {
    if (preparationNeedsReview) {
      await changeCanvasView(false);
      await updateSelection({ stageId: "storyboard" });
      return;
    }
    const model = analysisModels.find(item => item.id === analysisModelId);
    if (!selectedEpisode || !model || startingPreparation) return;
    setStartingPreparation(true);
    try {
      await startStudioEpisodePreproduction(projectId, selectedEpisode.id, {
        channelId: model.channelId, model: model.modelId, locale: locale === "en" ? "en" : "zh",
      });
      toast.success(locale === "en" ? "Preproduction submitted. Review findings in the storyboard workspace before continuing." : "前期制作已提交。若有导演审核问题，请在分镜工作台确认后继续。");
      await refreshStudioData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
      await refreshStudioData();
    }
    finally { setStartingPreparation(false); }
  }

  const sidebar = (
    <EpisodeSidebar
      createEpisode={createEpisode}
      locale={locale}
      models={analysisModels}
      onCreated={(episode) => {
        updateSelection({ episodeId: episode.id, stageId: "writing" });
        setEpisodesOpen(false);
      }}
      onSelect={(episodeId) => {
        updateSelection({ episodeId, stageId: "writing" });
        setEpisodesOpen(false);
      }}
      onRefresh={refreshStudioData}
      selectedEpisodeId={selectedEpisode?.id}
      snapshot={snapshot}
      deliverables={deliverables}
    />
  );

  return (
    <TooltipProvider>
      <div className="flex h-dvh min-h-0 flex-col bg-background">
        <WorkspaceTopbar
          episodeName={selectedEpisode?.name}
          isRefreshing={isRefreshing}
          locale={locale}
          onLocaleChange={toggleLocale}
          onOpenActivity={() => void openActivity()}
          onOpenEpisodes={() => setEpisodesOpen(true)}
          onProjectConfigChange={() => refresh()}
          onRefresh={() => void refresh()}
          projectConfig={snapshot.project.config}
          projectId={projectId}
          projectName={snapshot.project.name}
          user={user}
        />

        <StageNavigation
          activeStage={activeStage}
          locale={locale}
          onSelect={(stageId) => updateSelection({ stageId })}
          stages={stages}
        />
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5">
          <Button
            size="sm"
            variant={!canvasOpen ? "secondary" : "ghost"}
            onClick={() => void changeCanvasView(false)}
          >
            制作流程
          </Button>
          <Button
            size="sm"
            variant={canvasOpen ? "secondary" : "ghost"}
            disabled={!selectedEpisode}
            onClick={() => void changeCanvasView(true)}
          >
            无限画布
          </Button>
          <Button size="sm" variant="outline" disabled={startingPreparation || !selectedEpisode?.novelText || (!preparationNeedsReview && !analysisModelId)}
            onClick={() => void prepareEpisode()}>
            {startingPreparation && <LoaderCircle className="size-3.5 animate-spin" />}
            {preparationNeedsReview ? (locale === "en" ? "Review existing storyboard" : "检查已有分镜草案") : (locale === "en" ? "Continue preproduction" : "继续本集前期制作")}
          </Button>
          {!canvasOpen && selection?.kind === "panel" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void changeCanvasView(true)}
            >
              在画布中打开此镜头
            </Button>
          )}
          <Button
            size="sm"
            variant={inspectorVisible ? "secondary" : "ghost"}
            onClick={() =>
              inspectorVisible
                ? (setActivityOpen(false), setInspectorCollapsed(true))
                : openActivity()
            }
          >
            导演助手与任务
          </Button>
          {!canvasOpen && <DirectorWorkflowBar stage={activeStage} locale={locale} onSelect={(stageId) => updateSelection({ stageId })} compact />}
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside
            className={
              canvasOpen ? "hidden" : "hidden w-64 shrink-0 border-r lg:block"
            }
          >
            {sidebar}
          </aside>

          <main
            className={
              canvasOpen
                ? "min-h-0 min-w-0 flex-1 overflow-hidden"
                : fixedHeightWorkspace
                  ? "min-h-0 min-w-0 flex-1 overflow-y-auto xl:overflow-hidden"
                  : "min-h-0 min-w-0 flex-1 overflow-y-auto"
            }
          >
            {packageSync.error && packageSync.key === packageSyncKey && (
              <div role="alert" className="flex flex-wrap items-center gap-3 border-b px-5 py-3 text-sm">
                <p className="min-w-0 flex-1 text-destructive">{packageSync.error}</p>
                <Button size="sm" variant="outline" onClick={() => setPackageSyncRevision(value => value + 1)}>{copy.retry}</Button>
                <Button size="sm" variant="outline" onClick={() => setActivityOpen(true)}>{locale === "en" ? "View tasks" : "查看制作任务"}</Button>
              </div>
            )}
            {packageSyncPending ? (
              <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
                <LoaderCircle className="size-4 animate-spin" />
                {locale === "en" ? "Connecting existing package material…" : "正在接入已有场次、分镜提示词与台词…"}
              </div>
            ) : canvasOpen && selectedEpisode ? (
              <CanvasWorkspace
                key={selectedEpisode.id}
                projectId={projectId}
                episodeId={selectedEpisode.id}
                imageModels={imageModels}
                videoModels={videoModels}
                lipSyncModels={lipSyncModels}
                snapshot={snapshot}
                locale={locale}
                focusedPanelId={searchParams.get("panel") ?? undefined}
                onContextChange={setSelection}
                onSelectionsChange={setCanvasSelections}
                registerSelectNode={(handler) => {
                  selectCanvasNode.current = handler;
                }}
                registerEditPanel={(handler) => {
                  editCanvasPanel.current = handler;
                }}
                onOpenStage={(stageId) => void updateSelection({ stageId })}
                onOpenPanel={(panelId) => void openPanel(panelId)}
                onRefresh={() => refresh()}
                registerBeforeLeave={(handler) => {
                  beforeCanvasLeave.current = handler;
                }}
              />
            ) : selectedStage?.id === "writing" && selectedEpisode ? (
              <WritingWorkspace
                canContinueOriginal={selectedEpisode.episodeNumber > 1 && Boolean(deliverables?.deliverables.some(row => {
                  const adoption = row.payload.adoption as { episodeIds?: string[] } | undefined;
                  return row.payload.packageFormat === "cyanyi-story-package-v1" && ["approved", "locked"].includes(row.status) &&
                    adoption?.episodeIds?.includes(selectedEpisode.id);
                }))}
                analysisModelId={analysisModelId}
                onAnalysisModelChange={changeAnalysisModel}
                episode={selectedEpisode}
                locale={locale}
                models={analysisModels}
                onContextChange={setSelection}
                onRefresh={() => refresh()}
                snapshot={snapshot}
              />
            ) : selectedStage?.id === "assets" ? (
              <AssetsWorkspace
                analysisModels={analysisModels}
                imageModels={imageModels}
                locale={locale}
                onContextChange={setSelection}
                onRefresh={() => refresh()}
                snapshot={snapshot}
              />
            ) : selectedStage?.id === "storyboard" && selectedEpisode ? (
              <StoryboardWorkspace
                focusedPanelId={searchParams.get("panel") ?? undefined}
                analysisModelId={analysisModelId}
                models={analysisModels}
                onAnalysisModelChange={changeAnalysisModel}
                episode={selectedEpisode}
                locale={locale}
                onContextChange={setSelection}
                onRefresh={() => refresh()}
                snapshot={snapshot}
              />
            ) : selectedStage?.id === "shots" && selectedEpisode ? (
              <ShotsWorkspace
                focusedPanelId={searchParams.get("panel") ?? undefined}
                analysisModels={analysisModels}
                episode={selectedEpisode}
                imageModels={imageModels}
                locale={locale}
                onContextChange={setSelection}
                onRefresh={() => refresh()}
                snapshot={snapshot}
                videoModels={videoModels}
              />
            ) : selectedStage?.id === "audio" && selectedEpisode ? (
              <AudioWorkspace
                analysisModels={analysisModels}
                audioModels={audioModels}
                episode={selectedEpisode}
                lipSyncModels={lipSyncModels}
                locale={locale}
                onContextChange={setSelection}
                onRefresh={() => refresh()}
                snapshot={snapshot}
              />
            ) : selectedStage?.id === "delivery" && selectedEpisode ? (
              <DeliveryWorkspace
                episode={selectedEpisode}
                locale={locale}
                onContextChange={setSelection}
                onRefresh={() => refresh()}
                snapshot={snapshot}
                videoModels={videoModels}
              />
            ) : selectedStage ? (
              <StageOverview
                episode={selectedEpisode}
                locale={locale}
                snapshot={snapshot}
                stage={selectedStage}
              />
            ) : (
              <Empty className="h-full rounded-none border-0">
                <EmptyTitle>{copy.selectEpisode}</EmptyTitle>
              </Empty>
            )}
          </main>

          <aside
            aria-label={
              locale === "en" ? "Director and tasks" : "导演助手与任务"
            }
            className={
              inspectorVisible
                ? "flex h-[48%] min-h-0 w-full shrink-0 flex-col border-t bg-background md:h-auto md:w-80 md:border-t-0 md:border-l xl:w-96"
                : "hidden"
            }
          >
            <header className="flex h-10 shrink-0 items-center justify-between border-b px-3">
              <span className="text-xs font-medium">
                {copy.productionActivity}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={copy.close}
                onClick={() => {
                  setActivityOpen(false);
                  setInspectorCollapsed(true);
                }}
              >
                <X className="size-4" />
              </Button>
            </header>
            <div className="min-h-0 flex-1">
              <StudioInspector
                analysisModelId={analysisModelId}
                context={inspectorContext}
                locale={locale}
                models={analysisModels}
                onAnalysisModelChange={changeAnalysisModel}
                onRefresh={refreshStudioData}
                snapshot={snapshot}
                selections={canvasOpen ? canvasSelections : undefined}
                onEditContext={
                  canvasOpen
                    ? (item) => {
                        const nodeId = item.metadata?.canvasNodeId;
                        if (typeof nodeId === "string")
                          editCanvasPanel.current?.(nodeId);
                      }
                    : undefined
                }
                onSelectContext={(item) => {
                  const nodeId = item.metadata?.canvasNodeId;
                  if (canvasOpen && typeof nodeId === "string")
                    selectCanvasNode.current?.(nodeId);
                }}
                beforeSend={async () =>
                  !canvasOpen ||
                  !beforeCanvasLeave.current ||
                  (await beforeCanvasLeave.current())
                }
              />
            </div>
          </aside>
        </div>

        <Sheet onOpenChange={setEpisodesOpen} open={episodesOpen}>
          <SheetContent className="w-[min(88vw,22rem)] gap-0 p-0" side="left">
            <SheetHeader className="sr-only">
              <SheetTitle>{copy.episodes}</SheetTitle>
              <SheetDescription>{copy.selectEpisode}</SheetDescription>
            </SheetHeader>
            {sidebar}
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}
