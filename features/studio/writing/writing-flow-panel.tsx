"use client";

import { Ban, LoaderCircle, Pause, Play, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { StatusIndicator } from "../components/status-indicator";
import { formatStudioDate, getStudioCopy } from "../i18n";
import { runtimeStatusToStageStatus } from "../stage-state";
import type {
  StudioLocale,
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
    execution: "local",
  },
] as const;

type WorkflowAction = "cancel" | "retry" | "pause" | "resume";

export function WritingFlowPanel({
  adaptationWorkflow,
  canStartPlacement,
  isActing,
  locale,
  onControl,
  onStartPlacement,
  placementWorkflow,
}: {
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
            plannedSteps={ADAPTATION_STEPS}
            title={copy.adaptationFlow}
            workflow={adaptationWorkflow}
          />
          <WorkflowBlock
            locale={locale}
            plannedSteps={PLACEMENT_STEPS}
            title={copy.placementFlow}
            workflow={placementWorkflow}
          />
        </div>

        <div className="mt-5 space-y-2 border-t pt-5">
          {!workflowActive ? (
            <Button
              className="w-full"
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
              {placementWorkflow ? copy.rerunAnalysis : copy.startAnalysis}
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
  locale,
  plannedSteps,
  title,
  workflow,
}: {
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
        execution: isAiStep(workflow.workflowType) ? "ai" : "local",
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
            workflow
              ? runtimeStatusToStageStatus(workflow.status)
              : "not_started"
          }
        />
      </div>
      <div className="mt-2 divide-y border-y">
        {steps.map((step) => (
          <div className="flex min-w-0 items-center gap-2 py-2.5" key={step.id}>
            <span className="w-5 shrink-0 font-mono text-[10px] text-muted-foreground">
              {String(step.index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {workflowStepLabel(locale, step.type || step.key)}
            </span>
            <Badge className="px-1.5 text-[10px]" variant="outline">
              {step.execution === "ai" ? copy.aiExecution : copy.localExecution}
            </Badge>
            <StatusIndicator
              locale={locale}
              status={runtimeStatusToStageStatus(step.status)}
            />
          </div>
        ))}
      </div>
      {workflow ? (
        <p className="mt-2 text-right text-[11px] text-muted-foreground">
          {formatStudioDate(locale, workflow.updatedAt)}
        </p>
      ) : null}
    </section>
  );
}

function isAiStep(workflowType: string) {
  return workflowType === "episode-adaptation";
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
      <Button
        className="w-full"
        disabled={disabled}
        onClick={() => onAction("retry")}
        type="button"
        variant="outline"
      >
        <RotateCcw className="size-4" />
        {copy.retryWorkflow}
      </Button>
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
