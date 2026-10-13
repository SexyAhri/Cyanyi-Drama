"use client";

import { Ban, LoaderCircle, Pause, Play, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { StatusIndicator } from "../components/status-indicator";
import { ModelSelect } from "../components/model-select";
import { formatStudioDate, getStudioCopy } from "../i18n";
import { runtimeStatusToStageStatus } from "../stage-state";
import type {
  StudioLocale,
  StudioModelOption,
  WorkflowRunSummary,
} from "../types";
import { workflowStepLabel } from "../workflow-labels";

const ADAPTATION_STEPS = [
  { key: "adapt_episode", type: "adapt_episode", execution: "ai" },
] as const;

const PLACEMENT_STEPS = [
  {
    key: "organize_production_script",
    type: "organize_production_script",
    execution: "ai",
  },
] as const;

type WorkflowAction = "cancel" | "retry" | "pause" | "resume";

export function WritingFlowPanel({
  hasProductionScript,
  hasStructuredScript,
  isPackageSource,
  onReusePackage,
  canReusePackage,
  analysisModelId,
  models,
  onAnalysisModelChange,
  adaptationWorkflow,
  canStartPlacement,
  isActing,
  locale,
  onControl,
  onStartPlacement,
  placementWorkflow,
}: {
  hasProductionScript: boolean;
  hasStructuredScript: boolean;
  isPackageSource: boolean;
  onReusePackage: () => void;
  canReusePackage: boolean;
  analysisModelId: string;
  models: StudioModelOption[];
  onAnalysisModelChange: (value: string) => void;
  adaptationWorkflow?: WorkflowRunSummary;
  canStartPlacement: boolean;
  isActing: boolean;
  locale: StudioLocale;
  onControl: (runId: string, action: WorkflowAction) => void;
  onStartPlacement: () => void;
  placementWorkflow?: WorkflowRunSummary;
}) {
  const copy = getStudioCopy(locale);
  const activeWorkflow = [adaptationWorkflow, placementWorkflow]
    .filter((workflow): workflow is WorkflowRunSummary => Boolean(workflow))
    .find((workflow) =>
      ["queued", "running", "canceling", "paused"].includes(workflow.status),
    );
  const failedWorkflow = [placementWorkflow, adaptationWorkflow].find(
    (workflow) => workflow && ["failed", "blocked"].includes(workflow.status),
  );
  const controllableWorkflow = activeWorkflow ?? failedWorkflow;
  const workflowActive = Boolean(activeWorkflow);

  return (
    <aside className="border-t py-5 xl:min-h-0 xl:overflow-y-auto xl:border-t-0 xl:border-l xl:pl-6">
      <div className="xl:sticky xl:top-0">
        <h2 className="text-sm font-semibold">{copy.writingFlow}</h2>

        <div className="mt-4 space-y-5">
          <WorkflowBlock
            locale={locale}
            plannedSteps={adaptationWorkflow?.workflowType === "original-episode-generation"
              ? [{ key: "generate_original_episode", type: "generate_original_episode", execution: "ai" }]
              : ADAPTATION_STEPS}
            completed={hasProductionScript}
            title={isPackageSource ? (locale === "en" ? "Adopted original screenplay" : "原创制作剧本已采用") : copy.adaptationFlow}
            workflow={adaptationWorkflow}
          />
          <WorkflowBlock
            locale={locale}
            plannedSteps={PLACEMENT_STEPS}
            completed={hasStructuredScript}
            title={copy.placementFlow}
            workflow={placementWorkflow}
          />
        </div>

        <div className="mt-5 space-y-2 border-t pt-5">
          {hasProductionScript && <p className="text-xs leading-5 text-muted-foreground">
            {locale === "en" ? "Continue with the active screenplay. Rewriting is optional." : "直接使用当前制作剧本，无需再次改编。"}
          </p>}
          {isPackageSource && !hasStructuredScript && !workflowActive ? (
            <Button className="w-full" disabled={isActing || !canReusePackage} onClick={onReusePackage}>
              {locale === "en" ? "Sync existing package material" : "同步已有场次、提示词与台词"}
            </Button>
          ) : null}
          <ModelSelect
            models={models}
            value={analysisModelId}
            onChange={onAnalysisModelChange}
            placeholder={
              locale === "en" ? "AI organization model" : "AI 整理模型"
            }
            ariaLabel={
              locale === "en" ? "AI organization model" : "AI 整理模型"
            }
            disabled={isActing || workflowActive}
          />
          {!workflowActive ? (
            <Button
              className="w-full"
              variant={hasStructuredScript || isPackageSource ? "outline" : "default"}
              disabled={isActing || !canStartPlacement}
              onClick={onStartPlacement}
              type="button"
            >
              {isActing ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : placementWorkflow ? (
                <RotateCcw className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
              {hasStructuredScript ? (locale === "en" ? "Reorganize screenplay (optional)" : "重新整理剧本（可选）") : isPackageSource ? (locale === "en" ? "AI reorganization (optional)" : "AI 重新整理（可选）") : copy.startAnalysis}
            </Button>
          ) : null}
          <WorkflowActions
            disabled={isActing}
            locale={locale}
            onAction={(action) => {
              if (controllableWorkflow)
                onControl(controllableWorkflow.id, action);
            }}
            status={controllableWorkflow?.status}
          />
        </div>
      </div>
    </aside>
  );
}

function WorkflowBlock({
  completed = false,
  locale,
  plannedSteps,
  title,
  workflow,
}: {
  completed?: boolean;
  locale: StudioLocale;
  plannedSteps: readonly {
    key: string;
    type: string;
    execution: "ai" | "local";
  }[];
  title: string;
  workflow?: WorkflowRunSummary;
}) {
  const copy = getStudioCopy(locale);
  const steps = workflow?.steps.length
    ? workflow.steps.map((step) => ({
        ...step,
        execution:
          workflow.execution ??
          (isAiStep(workflow.workflowType) ? "ai" : "local"),
      }))
    : plannedSteps.map((step, index) => ({
        ...step,
        id: `planned-${step.key}`,
        index,
        status: "pending",
      }));

  return (
    <section>
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold">
          {title}
        </h3>
        <StatusIndicator
          locale={locale}
          status={
            workflow && ["queued", "running", "paused", "canceling"].includes(workflow.status)
              ? runtimeStatusToStageStatus(workflow.status)
              : completed ? "completed" : "not_started"
          }
        />
      </div>
      {completed && !workflow?.steps.some(step => ["queued", "running", "paused"].includes(step.status)) ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {locale === "en" ? "Existing production material is ready to reuse." : "已有制作内容，直接复用，无需再次生成。"}
        </p>
      ) : <div className="mt-2 divide-y border-y">
        {steps.map((step) => (
          <div className="flex min-w-0 items-center gap-2 py-2.5" key={step.id}>
            <span className="w-5 shrink-0 font-mono text-[10px] text-muted-foreground">
              {String(step.index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {workflowStepLabel(locale, step.type || step.key)}
            </span>
            <Badge className="px-1.5 text-[10px]" variant="outline">
              {completed && !workflow ? (locale === "en" ? "Reused" : "已复用") : step.execution === "ai" ? copy.aiExecution : copy.localExecution}
            </Badge>
            <StatusIndicator
              locale={locale}
              status={completed && !workflow ? "completed" : runtimeStatusToStageStatus(step.status)}
            />
          </div>
        ))}
      </div>}
      {workflow ? (
        <p className="mt-2 text-right text-[11px] text-muted-foreground">
          {formatStudioDate(locale, workflow.updatedAt)}
        </p>
      ) : null}
    </section>
  );
}

function isAiStep(workflowType: string) {
  return (
    workflowType === "episode-adaptation" || workflowType === "story-to-script" || workflowType === "episode-preproduction"
  );
}

function WorkflowActions({
  disabled,
  locale,
  onAction,
  status,
}: {
  disabled: boolean;
  locale: StudioLocale;
  onAction: (action: WorkflowAction) => void;
  status?: string;
}) {
  const copy = getStudioCopy(locale);
  if (!status) return null;
  if (status === "failed" || status === "blocked") {
    return (
      <div className="flex gap-2">
        <Button className="flex-1" disabled={disabled} onClick={() => onAction("resume")} type="button" variant="outline">
          <Play className="size-4" />
          {copy.continueWorkflow}
        </Button>
        <Button className="flex-1" disabled={disabled} onClick={() => onAction("retry")} type="button" variant="outline">
          <RotateCcw className="size-4" />
          {copy.retryWorkflow}
        </Button>
      </div>
    );
  }
  if (!["queued", "running", "canceling", "paused"].includes(status))
    return null;
  return (
    <div className="flex gap-2">
      {status === "running" ? (
        <Button
          className="flex-1"
          disabled={disabled}
          onClick={() => onAction("pause")}
          type="button"
          variant="outline"
        >
          <Pause className="size-4" />
          {copy.pauseWorkflow}
        </Button>
      ) : status === "paused" ? (
        <Button
          className="flex-1"
          disabled={disabled}
          onClick={() => onAction("resume")}
          type="button"
          variant="outline"
        >
          <Play className="size-4" />
          {copy.resumeWorkflow}
        </Button>
      ) : null}
      <Button
        className="flex-1"
        disabled={disabled || status === "canceling"}
        onClick={() => onAction("cancel")}
        type="button"
        variant="outline"
      >
        <Ban className="size-4" />
        {copy.cancelWorkflow}
      </Button>
    </div>
  );
}
