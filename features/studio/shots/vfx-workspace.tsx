"use client";

import {
  Ban,
  CheckCircle2,
  GitBranch,
  History,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { VFX_QC_KEYS } from "@/lib/production/vfx-contract";

import { controlStudioMediaTask, transitionStudioDeliverable } from "../api";
import { StatusIndicator } from "../components/status-indicator";
import { runtimeStatusToStageStatus } from "../stage-state";
import type {
  ProductionDeliverableCatalog,
  ProjectMediaAsset,
  StudioLocale,
  StudioModelOption,
  StudioSelectionContext,
  StudioStoryboardPanel,
  WorkspaceSnapshot,
} from "../types";
import { DeliverableConfirmDialog } from "../production/deliverable-dialogs";
import { getProductionCopy, productionLabel } from "../production/copy";
import { VfxShotPackageDialog } from "./vfx-shot-package-dialog";
import { VfxTaskDialog } from "./vfx-task-dialog";
import {
  getCurrentVfxShotVersion,
  getLatestVfxTask,
  getVfxPipelineState,
  getVfxQcReadiness,
  getVfxShotVersions,
} from "./vfx-view-model";

export function VfxWorkspace({
  assets,
  catalog,
  episodeId,
  imageModels,
  locale,
  onContextChange,
  onRefresh,
  panels,
  projectId,
  snapshot,
  videoModels,
}: {
  assets: ProjectMediaAsset[];
  catalog: ProductionDeliverableCatalog;
  episodeId: string;
  imageModels: StudioModelOption[];
  locale: StudioLocale;
  onContextChange: (selection?: StudioSelectionContext) => void;
  onRefresh: () => Promise<unknown> | void;
  panels: StudioStoryboardPanel[];
  projectId: string;
  snapshot: WorkspaceSnapshot;
  videoModels: StudioModelOption[];
}) {
  const copy = getProductionCopy(locale);
  const [selectedPanelId, setSelectedPanelId] = useState(panels[0]?.id ?? "");
  const [busyTaskId, setBusyTaskId] = useState("");
  const panel = panels.find((item) => item.id === selectedPanelId) ?? panels[0];
  const versions = useMemo(
    () => (panel ? getVfxShotVersions(catalog.deliverables, panel.id) : []),
    [catalog.deliverables, panel],
  );
  const current = getCurrentVfxShotVersion(versions);
  const vfxShotCount = panels.filter((item) =>
    getCurrentVfxShotVersion(getVfxShotVersions(catalog.deliverables, item.id)),
  ).length;

  useEffect(() => {
    if (!panel) return onContextChange(undefined);
    onContextChange(
      current
        ? {
            id: current.deliverable.id,
            kind: "deliverable",
            label: current.deliverable.title,
            metadata: {
              department: "vfx",
              panelId: panel.id,
              version: current.deliverable.version,
            },
          }
        : {
            id: panel.id,
            kind: "panel",
            label: `${copy.nonVfxShots} ${panel.panelIndex + 1}`,
            metadata: { department: "shot" },
          },
    );
  }, [copy.nonVfxShots, current, onContextChange, panel]);

  async function controlTask(taskId: string, action: "cancel" | "retry") {
    setBusyTaskId(taskId);
    try {
      await controlStudioMediaTask(taskId, action);
      toast.success(copy.updated);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setBusyTaskId("");
    }
  }

  if (!panel) return null;

  const shotPackage = current?.package ?? null;
  const pipeline = getVfxPipelineState(
    shotPackage,
    snapshot.tasks,
    panel.id,
    current?.deliverable.id,
  );
  const elementTask = getLatestVfxTask(
    snapshot.tasks,
    panel.id,
    "element",
    current?.deliverable.id,
  );
  const compositeTask = getLatestVfxTask(
    snapshot.tasks,
    panel.id,
    "composite",
    current?.deliverable.id,
  );
  const scopedAssets = assets.filter(
    (asset) =>
      asset.sourceTargetId === panel.id ||
      asset.references.some(
        (reference) =>
          reference.entityId === panel.id ||
          reference.entityId === current?.deliverable.id,
      ),
  );

  return (
    <div className="grid min-h-144 border-y lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="border-b lg:border-r lg:border-b-0">
        <div className="flex h-11 items-center justify-between border-b px-3">
          <span className="text-xs font-semibold">{copy.vfxBreakdown}</span>
          <Badge variant="outline">
            {vfxShotCount}/{panels.length}
          </Badge>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5 lg:max-h-[calc(100dvh-18rem)]">
          {panels.map((item) => {
            const itemCurrent = getCurrentVfxShotVersion(
              getVfxShotVersions(catalog.deliverables, item.id),
            );
            return (
              <button
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  item.id === panel.id ? "bg-muted" : "hover:bg-muted/60",
                )}
                key={item.id}
                onClick={() => setSelectedPanelId(item.id)}
                type="button"
              >
                <span className="w-7 shrink-0 font-mono text-[11px] text-muted-foreground">
                  {String(item.panelIndex + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {item.shotType || item.description || copy.nonVfxShots}
                </span>
                {itemCurrent ? (
                  <Badge className="shrink-0" variant="secondary">
                    VFX
                  </Badge>
                ) : null}
              </button>
            );
          })}
        </div>
      </aside>

      <section className="min-w-0 p-4 sm:p-6">
        <header className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {copy.vfxShotPackage} ·{" "}
              {String(panel.panelIndex + 1).padStart(2, "0")}
            </p>
            <h2 className="mt-1 text-base font-semibold">
              {panel.shotType || panel.description || copy.nonVfxShots}
            </h2>
            {shotPackage ? (
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                {shotPackage.summary}
              </p>
            ) : null}
          </div>
          <VfxShotPackageDialog
            assets={assets}
            catalog={catalog}
            current={current}
            episodeId={episodeId}
            locale={locale}
            onCompleted={onRefresh}
            panel={panel}
            projectId={projectId}
          />
        </header>

        {!current || !shotPackage ? (
          <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <GitBranch className="size-6" />
            <p className="max-w-md text-sm leading-6">
              {vfxShotCount ? copy.notVfxShot : copy.noVfxShots}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b py-4">
              <Badge variant="outline">
                {productionLabel(locale, "vfxCategories", shotPackage.category)}
              </Badge>
              <Badge variant="outline">
                {copy.vfxComplexity} ·{" "}
                {productionLabel(
                  locale,
                  "vfxComplexities",
                  shotPackage.complexity,
                )}
              </Badge>
              <Badge variant="outline">{shotPackage.colorSpace}</Badge>
              <Badge variant="secondary">v{current.deliverable.version}</Badge>
            </div>

            <section className="border-b py-5">
              <div className="mb-3 flex items-center gap-2">
                <GitBranch className="size-4" />
                <h3 className="text-sm font-semibold">
                  {copy.dependencyGraph}
                </h3>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">
                <PipelineNode
                  label={copy.plate}
                  locale={locale}
                  status={pipeline.plate}
                />
                <PipelineNode
                  label={copy.element}
                  locale={locale}
                  status={pipeline.element}
                  task={elementTask}
                />
                <PipelineNode
                  label={copy.composite}
                  locale={locale}
                  status={pipeline.composite}
                  task={compositeTask}
                />
                <PipelineNode
                  label={copy.shotQc}
                  locale={locale}
                  status={pipeline.qc}
                />
              </div>
            </section>

            <section className="grid gap-5 border-b py-5 xl:grid-cols-3">
              <RequirementList
                label={copy.plateRequirements}
                lines={shotPackage.plate.requirements}
              />
              <RequirementList
                label={copy.elementRequirements}
                lines={shotPackage.elements.requirements}
              />
              <RequirementList
                label={copy.compositeNotes}
                lines={shotPackage.compositeNotes}
              />
              <RequirementList
                label={copy.trackingRequirements}
                lines={shotPackage.trackingRequirements}
              />
              <RequirementList
                label={copy.matteRequirements}
                lines={shotPackage.matteRequirements}
              />
              <div>
                <p className="text-xs font-semibold">{copy.vfxSources}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {copy.plate} · {shotPackage.plate.assetIds.length}
                  <br />
                  {copy.element} · {shotPackage.elements.assetIds.length}
                  <br />
                  {copy.sources} · {scopedAssets.length}
                </p>
              </div>
            </section>

            <section className="border-b py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">{copy.pipeline}</h3>
                <div className="flex flex-wrap gap-2">
                  {pipeline.element !== "blocked" ? (
                    <VfxTaskDialog
                      episodeId={episodeId}
                      imageModels={imageModels}
                      locale={locale}
                      onCompleted={onRefresh}
                      projectId={projectId}
                      stage="element"
                      version={current}
                      videoModels={videoModels}
                    />
                  ) : null}
                  {pipeline.composite !== "blocked" ? (
                    <VfxTaskDialog
                      episodeId={episodeId}
                      imageModels={imageModels}
                      locale={locale}
                      onCompleted={onRefresh}
                      projectId={projectId}
                      stage="composite"
                      version={current}
                      videoModels={videoModels}
                    />
                  ) : null}
                </div>
              </div>
              <div className="mt-3 divide-y border-y">
                <TaskRow
                  busy={busyTaskId === elementTask?.id}
                  label={copy.element}
                  locale={locale}
                  onAction={controlTask}
                  task={elementTask}
                />
                <TaskRow
                  busy={busyTaskId === compositeTask?.id}
                  label={copy.composite}
                  locale={locale}
                  onAction={controlTask}
                  task={compositeTask}
                />
              </div>
            </section>

            <QcSection locale={locale} shotPackage={shotPackage} />

            <section className="py-5">
              <div className="mb-3 flex items-center gap-2">
                <History className="size-4" />
                <h3 className="text-sm font-semibold">{copy.versionHistory}</h3>
              </div>
              <div className="divide-y border-y">
                {versions.map((version) => (
                  <div
                    className="flex flex-wrap items-center gap-3 py-3"
                    key={version.deliverable.id}
                  >
                    <span className="font-mono text-xs">
                      v{version.deliverable.version}
                    </span>
                    <Badge variant="outline">
                      {productionLabel(
                        locale,
                        "statuses",
                        version.deliverable.status,
                      )}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {version.package?.summary ?? version.deliverable.title}
                    </span>
                    {version.deliverable.status === "superseded" ? (
                      <DeliverableConfirmDialog
                        description={copy.confirmRestore}
                        disabled={false}
                        icon={<RotateCcw className="size-4" />}
                        label={copy.restoreVersion}
                        locale={locale}
                        onConfirm={async () => {
                          await transitionStudioDeliverable(
                            projectId,
                            version.deliverable.id,
                            { action: "restore" },
                          );
                          toast.success(copy.restored);
                          await onRefresh();
                        }}
                        variant="outline"
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </section>
    </div>
  );
}

function PipelineNode({
  label,
  locale,
  status,
  task,
}: {
  label: string;
  locale: StudioLocale;
  status: string;
  task?: WorkspaceSnapshot["tasks"][number];
}) {
  return (
    <div className="min-h-20 border px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{label}</span>
        {task ? (
          <StatusIndicator
            compact
            locale={locale}
            status={runtimeStatusToStageStatus(task.status)}
          />
        ) : null}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {productionLabel(locale, "vfxTaskStatuses", status)}
      </p>
    </div>
  );
}

function RequirementList({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold">{label}</p>
      {lines.length ? (
        <ul className="mt-2 space-y-1.5 text-sm leading-5 text-muted-foreground">
          {lines.map((line) => (
            <li key={line}>· {line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
}

function TaskRow({
  busy,
  label,
  locale,
  onAction,
  task,
}: {
  busy: boolean;
  label: string;
  locale: StudioLocale;
  onAction: (taskId: string, action: "cancel" | "retry") => Promise<void>;
  task?: WorkspaceSnapshot["tasks"][number];
}) {
  const copy = getProductionCopy(locale);
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-3 py-2.5">
      <span className="w-24 text-sm font-medium">{label}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {task ? `${task.model} · ${task.progress}%` : "—"}
      </span>
      {task?.error ? (
        <span className="max-w-xs truncate text-xs text-destructive">
          {task.error.message}
        </span>
      ) : null}
      {task && ["queued", "running"].includes(task.status) ? (
        <Button
          disabled={busy}
          onClick={() => void onAction(task.id, "cancel")}
          size="sm"
          variant="outline"
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Ban className="size-4" />
          )}
          {copy.cancel}
        </Button>
      ) : null}
      {task?.status === "failed" && task.error?.retryable ? (
        <Button
          disabled={busy}
          onClick={() => void onAction(task.id, "retry")}
          size="sm"
          variant="outline"
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <RotateCcw className="size-4" />
          )}
          {copy.retry}
        </Button>
      ) : null}
    </div>
  );
}

function QcSection({
  locale,
  shotPackage,
}: {
  locale: StudioLocale;
  shotPackage: NonNullable<
    ReturnType<typeof getCurrentVfxShotVersion>
  >["package"];
}) {
  const copy = getProductionCopy(locale);
  if (!shotPackage) return null;
  const readiness = getVfxQcReadiness(shotPackage);
  return (
    <section className="border-b py-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4" />
          <h3 className="text-sm font-semibold">{copy.shotQc}</h3>
        </div>
        <Badge variant={readiness.isReady ? "secondary" : "outline"}>
          {readiness.complete}/{readiness.total}
        </Badge>
      </div>
      <div className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {VFX_QC_KEYS.map((key) => {
          const check = shotPackage.qc[key];
          return (
            <div className="flex items-start gap-2 border-t pt-3" key={key}>
              {check.status === "pass" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-status-success" />
              ) : (
                <TriangleAlert
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-muted-foreground",
                    check.status === "fail" && "text-destructive",
                  )}
                />
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium">
                  {productionLabel(locale, "vfxQc", key)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {check.note ||
                    productionLabel(locale, "vfxQcStatuses", check.status)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
