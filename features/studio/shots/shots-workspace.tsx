"use client";

import {
  Ban,
  Clapperboard,
  ImagePlus,
  Images,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Upload,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MediaTask } from "@/lib/media/task-contract";
import { cn } from "@/lib/utils";

import {
  controlStudioMediaTask,
  loadStudioProjectAssets,
  loadStudioStoryboard,
  selectStudioPanelMedia,
  uploadStudioPanelMedia,
} from "../api";
import { StatusIndicator } from "../components/status-indicator";
import { getStudioCopy } from "../i18n";
import { runtimeStatusToStageStatus } from "../stage-state";
import type {
  ProjectMediaAsset,
  StudioLocale,
  StudioModelOption,
  StudioStoryboardData,
  StudioStoryboardPanel,
  WorkspaceSnapshot,
} from "../types";
import { BatchGenerationDialog, PanelGenerationDialog } from "./generation-dialogs";
import { ShotCandidateGrid } from "./shot-candidates";
import {
  buildShotMediaCandidates,
  latestPanelTasks,
  type ShotMediaCandidate,
  type ShotMediaKind,
} from "./shot-view-model";

export function ShotsWorkspace({
  episode,
  imageModels,
  locale,
  onRefresh,
  snapshot,
  videoModels,
}: {
  episode: WorkspaceSnapshot["project"]["episodes"][number];
  imageModels: StudioModelOption[];
  locale: StudioLocale;
  onRefresh: () => Promise<unknown> | void;
  snapshot: WorkspaceSnapshot;
  videoModels: StudioModelOption[];
}) {
  const copy = getStudioCopy(locale);
  const [storyboardData, setStoryboardData] =
    useState<StudioStoryboardData | null>(null);
  const [assets, setAssets] = useState<ProjectMediaAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [kind, setKind] = useState<ShotMediaKind>("image");
  const [selectedPanelId, setSelectedPanelId] = useState("");
  const [checkedPanelIds, setCheckedPanelIds] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState("");
  const [batchAction, setBatchAction] = useState<"cancel" | "retry" | "">("");
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const projectId = snapshot.project.id;
  const revision = snapshot.tasks
    .map((task) => `${task.id}:${task.status}:${task.updatedAt}`)
    .join("|");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const [nextStoryboard, nextAssets] = await Promise.all([
          loadStudioStoryboard(projectId, episode.id, signal),
          loadStudioProjectAssets(projectId, signal),
        ]);
        if (!signal?.aborted) {
          setStoryboardData(nextStoryboard);
          setAssets(nextAssets);
        }
        return nextStoryboard;
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
  }, [load, revision]);

  const panels = useMemo(
    () => storyboardData?.storyboard?.panels ?? [],
    [storyboardData?.storyboard?.panels],
  );
  const selectedPanel =
    panels.find((panel) => panel.id === selectedPanelId) ?? panels[0];

  useEffect(() => {
    if (!panels.length) {
      setSelectedPanelId("");
      setCheckedPanelIds([]);
      return;
    }
    if (!panels.some((panel) => panel.id === selectedPanelId)) {
      setSelectedPanelId(panels[0].id);
    }
    setCheckedPanelIds((current) =>
      current.filter((id) => panels.some((panel) => panel.id === id)),
    );
  }, [panels, selectedPanelId]);

  const candidates = useMemo(
    () =>
      selectedPanel
        ? buildShotMediaCandidates(selectedPanel, kind, assets, snapshot.tasks)
        : [],
    [assets, kind, selectedPanel, snapshot.tasks],
  );
  const checkedPanels = panels.filter((panel) =>
    checkedPanelIds.includes(panel.id),
  );
  const latestCheckedTasks = latestPanelTasks(
    checkedPanelIds,
    kind,
    snapshot.tasks,
  );
  const failedTasks = latestCheckedTasks.filter(
    (task) => task.status === "failed",
  );
  const checkedIds = new Set(checkedPanelIds);
  const activeTasks = snapshot.tasks.filter(
    (task) =>
      task.targetType === "storyboard_panel" &&
      Boolean(task.targetId && checkedIds.has(task.targetId)) &&
      task.kind === kind &&
      ["queued", "running"].includes(task.status),
  );
  const models = kind === "image" ? imageModels : videoModels;

  async function refreshAll() {
    await Promise.all([load(), onRefresh()]);
  }

  async function upload(file: File) {
    if (!selectedPanel) return;
    setIsUploading(true);
    try {
      await uploadStudioPanelMedia(
        projectId,
        episode.id,
        selectedPanel.id,
        file,
        kind,
      );
      toast.success(copy.mediaUploaded);
      await refreshAll();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : copy.actionFailed,
      );
    } finally {
      setIsUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  async function selectCandidate(candidate: ShotMediaCandidate) {
    if (!selectedPanel || !candidate.assetId) return;
    setIsSelecting(true);
    try {
      await selectStudioPanelMedia(
        projectId,
        selectedPanel.id,
        candidate.assetId,
        kind,
      );
      toast.success(copy.assetSelected);
      await refreshAll();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : copy.actionFailed,
      );
    } finally {
      setIsSelecting(false);
    }
  }

  async function controlTask(task: MediaTask, action: "cancel" | "retry") {
    setBusyTaskId(task.id);
    try {
      await controlStudioMediaTask(task.id, action);
      toast.success(action === "cancel" ? copy.taskCanceled : copy.taskRetried);
      await refreshAll();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : copy.actionFailed,
      );
    } finally {
      setBusyTaskId("");
    }
  }

  async function controlBatch(action: "cancel" | "retry") {
    const targets = action === "cancel" ? activeTasks : failedTasks;
    if (!targets.length) return;
    setBatchAction(action);
    try {
      const results = await Promise.allSettled(
        targets.map((task) => controlStudioMediaTask(task.id, action)),
      );
      const completed = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      if (completed) {
        toast.success(
          (action === "cancel" ? copy.tasksCanceled : copy.tasksRetried).replace(
            "{count}",
            String(completed),
          ),
        );
      }
      if (completed !== results.length) toast.error(copy.actionFailed);
      await refreshAll();
    } finally {
      setBatchAction("");
    }
  }

  if (isLoading && !storyboardData) {
    return (
      <div className="flex h-full min-h-96 items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }

  if (!storyboardData || error) {
    return (
      <div className="flex min-h-96 flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-sm text-destructive">{error ?? copy.loadFailed}</p>
        <Button onClick={() => void load()} type="button" variant="outline">
          {copy.retry}
        </Button>
      </div>
    );
  }

  const allChecked =
    panels.length > 0 && checkedPanelIds.length === panels.length;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-7 sm:py-7">
      <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {String(episode.episodeNumber).padStart(2, "0")} · {episode.name}
          </p>
          <h1 className="mt-1 text-xl font-semibold">{copy.shotWorkspace}</h1>
        </div>
        {checkedPanels.length ? (
          <div className="flex flex-wrap items-center gap-2">
            {activeTasks.length ? (
              <Button
                disabled={Boolean(batchAction)}
                onClick={() => void controlBatch("cancel")}
                size="sm"
                type="button"
                variant="outline"
              >
                {batchAction === "cancel" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Ban className="size-4" />
                )}
                {copy.cancelActive} · {activeTasks.length}
              </Button>
            ) : null}
            {failedTasks.length ? (
              <Button
                disabled={Boolean(batchAction)}
                onClick={() => void controlBatch("retry")}
                size="sm"
                type="button"
                variant="outline"
              >
                {batchAction === "retry" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                {copy.retryFailed} · {failedTasks.length}
              </Button>
            ) : null}
            <BatchGenerationDialog
              allPanels={panels}
              episodeId={episode.id}
              kind={kind}
              locale={locale}
              models={models}
              onCompleted={refreshAll}
              panels={checkedPanels}
              projectId={projectId}
              trigger={
                <Button size="sm" type="button">
                  {kind === "image" ? (
                    <Images className="size-4" />
                  ) : (
                    <Video className="size-4" />
                  )}
                  {kind === "image"
                    ? copy.generateSelectedImages
                    : copy.generateSelectedVideos}
                  <span aria-hidden="true">·</span>
                  {checkedPanels.length}
                </Button>
              }
            />
          </div>
        ) : null}
      </header>

      {!panels.length ? (
        <div className="flex min-h-96 flex-col items-center justify-center gap-3 border-b text-center text-muted-foreground">
          <Clapperboard className="size-6" />
          <p className="max-w-md text-sm leading-6">{copy.noStoryboard}</p>
        </div>
      ) : (
        <Tabs
          className="min-w-0 py-5"
          onValueChange={(value) => setKind(value as ShotMediaKind)}
          value={kind}
        >
          <TabsList variant="line">
            <TabsTrigger value="image">
              <Images />
              {copy.images}
            </TabsTrigger>
            <TabsTrigger value="video">
              <Video />
              {copy.videos}
            </TabsTrigger>
          </TabsList>

          {(["image", "video"] as const).map((mediaKind) => (
            <TabsContent className="mt-4" key={mediaKind} value={mediaKind}>
              <div className="grid min-h-[34rem] border-y lg:grid-cols-[17rem_minmax(0,1fr)]">
                <aside className="border-b lg:border-r lg:border-b-0">
                  <label className="flex h-10 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
                    <Checkbox
                      aria-label={copy.selectedCount}
                      checked={allChecked}
                      onCheckedChange={(checked) =>
                        setCheckedPanelIds(
                          checked ? panels.map((panel) => panel.id) : [],
                        )
                      }
                    />
                    {copy.selectedCount} · {checkedPanelIds.length}
                  </label>
                  <div className="max-h-72 overflow-y-auto p-1.5 lg:max-h-[calc(100dvh-18rem)]">
                    {panels.map((panel) => (
                      <PanelRow
                        checked={checkedPanelIds.includes(panel.id)}
                        isSelected={panel.id === selectedPanel?.id}
                        key={panel.id}
                        kind={mediaKind}
                        locale={locale}
                        onCheckedChange={(checked) =>
                          setCheckedPanelIds((current) =>
                            checked
                              ? [...new Set([...current, panel.id])]
                              : current.filter((id) => id !== panel.id),
                          )
                        }
                        onSelect={() => setSelectedPanelId(panel.id)}
                        panel={panel}
                        tasks={snapshot.tasks}
                      />
                    ))}
                  </div>
                </aside>

                {selectedPanel ? (
                  <section className="min-w-0 p-4 sm:p-5">
                    <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold">
                          {copy.panel} {String(selectedPanel.panelIndex + 1).padStart(2, "0")}
                          {selectedPanel.shotType ? ` · ${selectedPanel.shotType}` : ""}
                        </h2>
                        {selectedPanel.description ? (
                          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                            {selectedPanel.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <input
                          accept={mediaKind === "image" ? "image/*" : "video/*"}
                          className="sr-only"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void upload(file);
                          }}
                          ref={uploadInputRef}
                          type="file"
                        />
                        <Button
                          disabled={isUploading}
                          onClick={() => uploadInputRef.current?.click()}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {isUploading ? (
                            <LoaderCircle className="size-4 animate-spin" />
                          ) : mediaKind === "image" ? (
                            <ImagePlus className="size-4" />
                          ) : (
                            <Upload className="size-4" />
                          )}
                          {mediaKind === "image"
                            ? copy.uploadImage
                            : copy.uploadVideo}
                        </Button>
                        <PanelGenerationDialog
                          episodeId={episode.id}
                          kind={mediaKind}
                          locale={locale}
                          models={mediaKind === "image" ? imageModels : videoModels}
                          onCompleted={refreshAll}
                          panel={selectedPanel}
                          panels={panels}
                          projectId={projectId}
                          trigger={
                            <Button size="sm" type="button">
                              <Sparkles className="size-4" />
                              {mediaKind === "image"
                                ? copy.generateImage
                                : copy.generateVideo}
                            </Button>
                          }
                        />
                      </div>
                    </header>
                    <div className="pt-5">
                      <div className="mb-3 flex items-center gap-2">
                        <h3 className="text-sm font-semibold">{copy.candidates}</h3>
                        <Badge variant="outline">{candidates.length}</Badge>
                      </div>
                      <ShotCandidateGrid
                        busyTaskId={busyTaskId}
                        candidates={candidates}
                        isSelecting={isSelecting}
                        locale={locale}
                        onSelect={(candidate) => void selectCandidate(candidate)}
                        onTaskAction={(task, action) =>
                          void controlTask(task, action)
                        }
                      />
                    </div>
                  </section>
                ) : null}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

function PanelRow({
  checked,
  isSelected,
  kind,
  locale,
  onCheckedChange,
  onSelect,
  panel,
  tasks,
}: {
  checked: boolean;
  isSelected: boolean;
  kind: ShotMediaKind;
  locale: StudioLocale;
  onCheckedChange: (checked: boolean) => void;
  onSelect: () => void;
  panel: StudioStoryboardPanel;
  tasks: MediaTask[];
}) {
  const copy = getStudioCopy(locale);
  const task = latestPanelTasks([panel.id], kind, tasks)[0];
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1",
        isSelected && "bg-muted",
      )}
    >
      <Checkbox
        aria-label={`${copy.panel} ${panel.panelIndex + 1}`}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
      <button
        className="min-w-0 flex-1 px-1 py-2 text-left"
        onClick={onSelect}
        type="button"
      >
        <span className="block truncate text-sm font-medium">
          {copy.panel} {String(panel.panelIndex + 1).padStart(2, "0")}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
          {panel.shotType || panel.description || copy.panelDescription}
        </span>
      </button>
      {task ? (
        <StatusIndicator
          compact
          locale={locale}
          status={runtimeStatusToStageStatus(task.status)}
        />
      ) : null}
    </div>
  );
}
