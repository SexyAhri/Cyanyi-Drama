import {
  Braces,
  CheckCircle2,
  CircleDashed,
  FileText,
  Gauge,
  ListChecks,
} from "lucide-react";

import type { EpisodeRecord } from "@/lib/projects/types";

import { formatStudioDate, getStageCopy, getStudioCopy } from "../i18n";
import {
  getTasksForStage,
  getWorkflowForStage,
  runtimeStatusToStageStatus,
} from "../stage-state";
import type {
  StudioLocale,
  StudioStageState,
  WorkspaceSnapshot,
} from "../types";
import { mediaTaskLabel, workflowStepLabel } from "../workflow-labels";
import { StatusIndicator } from "./status-indicator";

export function StageOverview({
  episode,
  locale,
  snapshot,
  stage,
}: {
  episode?: EpisodeRecord;
  locale: StudioLocale;
  snapshot: WorkspaceSnapshot;
  stage: StudioStageState;
}) {
  const copy = getStudioCopy(locale);
  const stageCopy = getStageCopy(locale, stage.id);
  const episodeTasks = snapshot.tasks.filter(
    (task) => !episode || task.episodeId === episode.id,
  );
  const episodeWorkflows = snapshot.workflows.filter(
    (workflow) => !episode || workflow.episodeId === episode.id,
  );
  const workflow = getWorkflowForStage(episodeWorkflows, stage.id);
  const tasks = getTasksForStage(episodeTasks, stage.id);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-7 sm:py-8">
      <header className="flex flex-col gap-3 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {episode
              ? `${String(episode.episodeNumber).padStart(2, "0")} · ${episode.name}`
              : copy.selectEpisode}
          </p>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
            {stageCopy.title}
          </h1>
        </div>
        <StatusIndicator locale={locale} status={stage.status} />
      </header>

      <section
        aria-label={copy.stageStatus}
        className="grid border-b sm:grid-cols-3"
      >
        <Metric
          icon={FileText}
          label={copy.sourceText}
          value={
            episode?.novelText ? episode.novelText.length.toLocaleString() : "0"
          }
        />
        <Metric
          icon={ListChecks}
          label={copy.workflowRuns}
          value={String(episodeWorkflows.length)}
        />
        <Metric
          icon={Gauge}
          label={copy.mediaTasks}
          value={String(episodeTasks.length)}
        />
      </section>

      <section className="border-b py-6">
        <div className="mb-4 flex items-center gap-2">
          <Braces className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{copy.projectFormat}</h2>
        </div>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <Spec label={copy.ratio} value={snapshot.project.config.videoRatio} />
          <Spec
            label={copy.resolution}
            value={snapshot.project.config.videoResolution}
          />
          <Spec
            label={copy.artStyle}
            value={snapshot.project.config.artStyle}
          />
        </dl>
      </section>

      {workflow ? (
        <WorkflowSection locale={locale} workflow={workflow} />
      ) : null}

      {tasks.length ? <TaskSection locale={locale} tasks={tasks} /> : null}

      {!workflow && !tasks.length ? (
        <div className="flex min-h-48 items-center justify-center border-b py-8 text-sm text-muted-foreground">
          <div className="flex flex-col items-center gap-2 text-center">
            <CircleDashed className="size-5" />
            <p>
              {stage.id === "writing" || stage.id === "storyboard"
                ? copy.noWorkflow
                : copy.noTasks}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-h-24 items-center gap-3 border-b py-4 last:border-b-0 sm:border-r sm:border-b-0 sm:px-4 sm:first:pl-0 sm:last:border-r-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 text-lg font-semibold">{value}</dd>
      </div>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed pb-2 sm:block">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium sm:mt-1">{value}</dd>
    </div>
  );
}

function WorkflowSection({
  locale,
  workflow,
}: {
  locale: StudioLocale;
  workflow: WorkspaceSnapshot["workflows"][number];
}) {
  const copy = getStudioCopy(locale);
  return (
    <section className="border-b py-6">
      <div className="flex items-center gap-2">
        <ListChecks className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{copy.workflow}</h2>
        <StatusIndicator
          className="ml-auto"
          locale={locale}
          status={runtimeStatusToStageStatus(workflow.status)}
        />
      </div>
      <div className="mt-4 divide-y border-y">
        {workflow.steps.map((step) => (
          <div className="flex min-w-0 items-center gap-3 py-3" key={step.id}>
            <span className="w-6 shrink-0 font-mono text-[10px] text-muted-foreground">
              {String(step.index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {workflowStepLabel(locale, step.key)}
            </span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {step.attempt}/{step.maxAttempts}
            </span>
            <StatusIndicator
              locale={locale}
              status={runtimeStatusToStageStatus(step.status)}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end text-[11px] text-muted-foreground">
        <span className="shrink-0">
          {formatStudioDate(locale, workflow.updatedAt)}
        </span>
      </div>
    </section>
  );
}

function TaskSection({
  locale,
  tasks,
}: {
  locale: StudioLocale;
  tasks: WorkspaceSnapshot["tasks"];
}) {
  const copy = getStudioCopy(locale);
  return (
    <section className="border-b py-6">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{copy.taskProgress}</h2>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {tasks.length}
        </span>
      </div>
      <div className="mt-4 divide-y border-y">
        {tasks.slice(0, 20).map((task) => (
          <div className="py-3" key={task.id}>
            <div className="flex min-w-0 items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {mediaTaskLabel(locale, task.targetType, task.kind)}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {task.progress}%
              </span>
              <StatusIndicator
                locale={locale}
                status={runtimeStatusToStageStatus(task.status)}
              />
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground transition-[width]"
                style={{
                  width: `${Math.min(Math.max(task.progress, 0), 100)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
