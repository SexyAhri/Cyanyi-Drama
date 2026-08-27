"use client";

import {
  Ban,
  CircleCheck,
  Clapperboard,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  getWorkflowForStage,
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
  replaceStoryboardPanel,
} from "./storyboard-view-model";

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
  const [data, setData] = useState<StudioStoryboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActing, setIsActing] = useState(false);
  const [selectedPanelId, setSelectedPanelId] = useState("");
  const [modelId, setModelId] = useState("");
  const projectId = snapshot.project.id;
  const workflows = snapshot.workflows.filter(
    (workflow) => workflow.episodeId === episode.id,
  );
  const workflow = getWorkflowForStage(workflows, "storyboard");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const result = await loadStudioStoryboard(projectId, episode.id, signal);
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
  }, [load, workflow?.updatedAt]);

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
  }, [copy.panel, onContextChange, selectedPanel]);

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
      const result = await startStudioStoryboardWorkflow(projectId, episode.id, {
        channelId: model.channelId,
        model: model.modelId,
        locale: locale === "en" ? "en" : "zh",
      });
      toast.success(result.reused ? copy.workflowReused : copy.workflowStarted);
      await refreshAll();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : copy.actionFailed,
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
        requestError instanceof Error ? requestError.message : copy.actionFailed,
      );
    } finally {
      setIsActing(false);
    }
  }

  async function savePanel(nextPanel: StudioStoryboardPanel) {
    if (!data?.storyboard) return;
    try {
      const result = await saveStudioStoryboard(projectId, episode.id, {
        status: data.storyboard.status,
        sourceHash: data.storyboard.sourceHash,
        panels: replaceStoryboardPanel(data.storyboard.panels, nextPanel),
      });
      setData((current) =>
        current
          ? { ...current, storyboard: result.storyboard }
          : current,
      );
      toast.success(copy.panelSaved);
      await onRefresh();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : copy.actionFailed,
      );
      throw requestError;
    }
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
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-7 sm:py-7">
      <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {String(episode.episodeNumber).padStart(2, "0")} · {episode.name}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold">{copy.storyboardWorkspace}</h1>
            {workflow ? (
              <StatusIndicator
                locale={locale}
                status={runtimeStatusToStageStatus(workflow.status)}
              />
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
          <label className="grid min-w-0 gap-1 text-xs font-medium sm:w-64">
            {copy.storyboardModel}
            <ModelSelect
              disabled={isActing || workflowActive}
              models={models}
              onChange={setModelId}
              placeholder={copy.storyboardModel}
              value={modelId}
            />
          </label>
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
      </header>

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
        <div className="grid min-h-[38rem] border-b lg:grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="border-b lg:border-r lg:border-b-0">
            <div className="flex h-11 items-center justify-between border-b px-3">
              <h2 className="text-xs font-semibold">{copy.storyboardPanels}</h2>
              <Badge variant="secondary">{panels.length}</Badge>
            </div>
            <div className="max-h-80 overflow-y-auto p-1.5 lg:max-h-[calc(100dvh-17rem)]">
              {panels.map((panel) => {
                const issues = getPanelContinuityIssues(
                  panel,
                  data?.continuityIssues ?? [],
                );
                return (
                  <button
                    className={cn(
                      "flex w-full items-start gap-3 rounded-md px-2.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      panel.id === selectedPanel?.id
                        ? "bg-muted"
                        : "hover:bg-muted/60",
                    )}
                    key={panel.id}
                    onClick={() => setSelectedPanelId(panel.id)}
                    type="button"
                  >
                    <span className="mt-0.5 w-6 shrink-0 font-mono text-[11px] text-muted-foreground">
                      {String(panel.panelIndex + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {panel.shotType || copy.panel}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {panel.description || copy.panelDescription}
                      </span>
                    </span>
                    {issues.length ? (
                      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-warning" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </aside>

          {selectedPanel ? (
            <PanelDetails
              issues={getPanelContinuityIssues(
                selectedPanel,
                data?.continuityIssues ?? [],
              )}
              locale={locale}
              onSave={savePanel}
              panel={selectedPanel}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function PanelDetails({
  issues,
  locale,
  onSave,
  panel,
}: {
  issues: StudioStoryboardData["continuityIssues"];
  locale: StudioLocale;
  onSave: (panel: StudioStoryboardPanel) => Promise<unknown> | void;
  panel: StudioStoryboardPanel;
}) {
  const copy = getStudioCopy(locale);
  return (
    <section className="min-w-0 p-4 sm:p-6">
      <header className="flex items-start justify-between gap-4 border-b pb-4">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">
            {copy.panel} {String(panel.panelIndex + 1).padStart(2, "0")}
          </p>
          <h2 className="mt-1 text-base font-semibold">
            {panel.shotType || copy.panelDescription}
          </h2>
        </div>
        <PanelEditorDialog locale={locale} onSave={onSave} panel={panel} />
      </header>

      <p className="max-w-3xl border-b py-5 text-sm leading-7 text-foreground/90">
        {panel.description || copy.panelDescription}
      </p>

      <dl className="grid gap-x-6 gap-y-4 border-b py-5 sm:grid-cols-2 xl:grid-cols-3">
        <PanelSpec label={copy.location} value={panel.locationName} />
        <PanelSpec label={copy.cameraMove} value={panel.cameraMove} />
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
      </dl>

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
      <dd className="mt-1 break-words text-sm">{value || "-"}</dd>
    </div>
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
          <p className="text-xs leading-5 text-muted-foreground" key={`${issue.clipId}-${issue.code}-${index}`}>
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
        <Button disabled={disabled} onClick={() => onAction("pause")} size="sm" variant="outline">
          <Pause className="size-4" />
          {copy.pauseWorkflow}
        </Button>
        <Button disabled={disabled} onClick={() => onAction("cancel")} size="sm" variant="outline">
          <Ban className="size-4" />
          {copy.cancelWorkflow}
        </Button>
      </div>
    );
  }
  if (status === "queued" || status === "canceling") {
    return (
      <Button disabled={disabled || status === "canceling"} onClick={() => onAction("cancel")} size="sm" variant="outline">
        <Ban className="size-4" />
        {copy.cancelWorkflow}
      </Button>
    );
  }
  if (status === "paused") {
    return (
      <div className="flex gap-2">
        <Button disabled={disabled} onClick={() => onAction("resume")} size="sm">
          <Play className="size-4" />
          {copy.resumeWorkflow}
        </Button>
        <Button disabled={disabled} onClick={() => onAction("cancel")} size="sm" variant="outline">
          <Ban className="size-4" />
          {copy.cancelWorkflow}
        </Button>
      </div>
    );
  }
  if (status === "failed" || status === "blocked") {
    return (
      <Button disabled={disabled} onClick={() => onAction("retry")} size="sm">
        <RotateCcw className="size-4" />
        {copy.retryWorkflow}
      </Button>
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
