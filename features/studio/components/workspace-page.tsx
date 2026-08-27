"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderX, LoaderCircle, RotateCcw, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
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
  SheetClose,
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
import type { StudioSelectionContext, StudioStageId } from "../types";
import { StudioInspector } from "../inspector/studio-inspector";
import { EpisodeSidebar } from "./episode-sidebar";
import { StageNavigation } from "./stage-navigation";
import { StageOverview } from "./stage-overview";
import { WorkspaceTopbar } from "./workspace-topbar";
import { WritingWorkspace } from "../writing/writing-workspace";
import { ProductionControlWorkspace } from "../production-control/production-control-workspace";

export function WorkspacePage({ projectId }: { projectId: string }) {
  const { locale, toggleLocale } = useStudioLocale();
  const wideLayout = useStudioWideLayout();
  const copy = getStudioCopy(locale);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [selection, setSelection] = useState<StudioSelectionContext>();
  const {
    analysisModels,
    audioModels,
    imageModels,
    lipSyncModels,
    videoModels,
  } = useStudioModels();
  const { createEpisode, error, isLoading, isRefreshing, refresh, snapshot } =
    useWorkspace(projectId);

  const requestedEpisodeId = searchParams.get("episode") ?? undefined;
  const requestedStage = searchParams.get("stage") as StudioStageId | null;
  const productionView = searchParams.get("view") === "production";
  const activeStage =
    requestedStage && STUDIO_STAGE_IDS.includes(requestedStage)
      ? requestedStage
      : "writing";
  const fixedHeightWorkspace = ["writing", "assets", "storyboard", "audio"].includes(
    activeStage,
  );
  const selectedEpisode = snapshot
    ? getSelectedEpisode(snapshot.project.episodes, requestedEpisodeId)
    : undefined;
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
    }),
    [activeStage, selectedEpisode?.id, selection],
  );

  useEffect(() => {
    setSelection(undefined);
  }, [activeStage, selectedEpisode?.id]);

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

  function updateSelection(input: {
    episodeId?: string;
    stageId?: StudioStageId;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("view");
    if (input.episodeId) params.set("episode", input.episodeId);
    if (input.stageId) params.set("stage", input.stageId);
    router.replace(`${pathname}?${params}`, { scroll: false });
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
        updateSelection({ episodeId });
        setEpisodesOpen(false);
      }}
      onRefresh={() => refresh()}
      selectedEpisodeId={selectedEpisode?.id}
      snapshot={snapshot}
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
          onOpenActivity={() => setActivityOpen(true)}
          onOpenEpisodes={() => setEpisodesOpen(true)}
          onOpenProduction={() => {
            const params = new URLSearchParams(searchParams.toString());
            if (productionView) params.delete("view");
            else params.set("view", "production");
            router.replace(`${pathname}?${params}`, { scroll: false });
          }}
          onRefresh={() => void refresh()}
          projectName={snapshot.project.name}
        />

        <StageNavigation
          activeStage={activeStage}
          locale={locale}
          onSelect={(stageId) => updateSelection({ stageId })}
          stages={stages}
        />

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-64 shrink-0 border-r lg:block">
            {sidebar}
          </aside>

          <main
            className={
              fixedHeightWorkspace
                ? "min-w-0 flex-1 overflow-y-auto xl:overflow-hidden"
                : "min-w-0 flex-1 overflow-y-auto"
            }
          >
            {productionView ? (
              <ProductionControlWorkspace
                episode={selectedEpisode}
                locale={locale}
                onRefresh={() => refresh()}
                snapshot={snapshot}
                stages={stages}
              />
            ) : selectedStage?.id === "writing" && selectedEpisode ? (
              <WritingWorkspace
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
                episode={selectedEpisode}
                imageModels={imageModels}
                locale={locale}
                onContextChange={setSelection}
                onRefresh={() => refresh()}
                snapshot={snapshot}
              />
            ) : selectedStage?.id === "storyboard" && selectedEpisode ? (
              <StoryboardWorkspace
                episode={selectedEpisode}
                locale={locale}
                models={analysisModels}
                onContextChange={setSelection}
                onRefresh={() => refresh()}
                snapshot={snapshot}
              />
            ) : selectedStage?.id === "shots" && selectedEpisode ? (
              <ShotsWorkspace
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

          <aside className="hidden w-80 shrink-0 border-l xl:block">
            {wideLayout ? (
              <StudioInspector
                context={inspectorContext}
                locale={locale}
                onRefresh={() => refresh()}
                snapshot={snapshot}
              />
            ) : null}
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

        <Sheet onOpenChange={setActivityOpen} open={activityOpen}>
          <SheetContent
            className="w-[min(90vw,24rem)] gap-0 p-0"
            showCloseButton={false}
            side="right"
          >
            <SheetHeader className="flex h-12 shrink-0 flex-row items-center justify-between border-b px-3 py-0">
              <SheetTitle className="text-sm">
                {copy.productionActivity}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {copy.productionActivity}
              </SheetDescription>
              <SheetClose
                render={
                  <Button
                    aria-label={copy.close}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                <X className="size-4" />
              </SheetClose>
            </SheetHeader>
            {activityOpen ? (
              <StudioInspector
                context={inspectorContext}
                locale={locale}
                onRefresh={() => refresh()}
                snapshot={snapshot}
              />
            ) : null}
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  );
}
