import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/server/prisma";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { stableSpanId, type TraceContext } from "./trace-context";

export async function resolveWorkflowTraceParent(input: {
  userId: string;
  runId: string;
  stepId?: string;
}): Promise<TraceContext | null> {
  const run = await prisma.workflowRun.findFirst({
    where: { id: input.runId, userId: input.userId },
    select: { id: true, traceId: true, spanId: true },
  });
  if (!run) return null;
  if (!input.stepId)
    return {
      traceId: run.traceId,
      spanId: run.spanId,
      workflowRunId: run.id,
    };
  const step = await prisma.workflowStep.findFirst({
    where: { id: input.stepId, runId: run.id },
    select: { id: true, traceId: true, spanId: true },
  });
  if (!step || step.traceId !== run.traceId) return null;
  return {
    traceId: step.traceId,
    spanId: step.spanId,
    parentSpanId: run.spanId,
    workflowRunId: run.id,
    workflowStepId: step.id,
  };
}

export async function getExecutionTrace(userId: string, traceId: string) {
  const normalized = traceId.trim();
  if (!normalized || normalized.length > 64) return null;
  const [run, tasks, channels] = await Promise.all([
    prisma.workflowRun.findFirst({
      where: { traceId: normalized, userId },
      include: {
        steps: { orderBy: { stepIndex: "asc" } },
        events: { orderBy: { createdAt: "asc" }, take: 500 },
        stepAttempts: { orderBy: { createdAt: "asc" }, take: 500 },
        artifacts: {
          orderBy: { createdAt: "asc" },
          take: 500,
        },
      },
    }),
    prisma.mediaTask.findMany({
      where: { traceId: normalized, userId },
      orderBy: { createdAt: "asc" },
      include: {
        events: { orderBy: { createdAt: "asc" }, take: 500 },
        assets: { orderBy: { createdAt: "asc" } },
      },
      take: 500,
    }),
    prisma.channel.findMany({
      where: accessibleChannelWhere(userId),
      select: { id: true, name: true },
      take: 500,
    }),
  ]);
  if (!run && !tasks.length) return null;

  const spans: ExecutionSpan[] = [];
  const channelNames = new Map(
    channels.map((channel) => [channel.id, channel.name]),
  );
  if (run) {
    spans.push({
      spanId: run.spanId,
      kind: "workflow_run",
      name: run.workflowType,
      status: run.status,
      startedAt: requiredIso(run.startedAt ?? run.createdAt),
      completedAt: optionalIso(run.completedAt),
      attributes: {
        runId: run.id,
        projectId: run.projectId,
        episodeId: run.episodeId,
        targetType: run.targetType,
        targetId: run.targetId,
        workflowVersion: run.workflowVersion,
        ...traceErrorAttributes(run.error),
      },
    });
    for (const step of run.steps)
      spans.push({
        spanId: step.spanId,
        parentSpanId: step.parentSpanId,
        kind: "workflow_step",
        name: step.stepKey,
        status: step.status,
        startedAt: requiredIso(step.startedAt ?? step.createdAt),
        completedAt: optionalIso(step.completedAt),
        attributes: {
          stepId: step.id,
          stepType: step.stepType,
          stepIndex: step.stepIndex,
          attempt: step.attempt,
          maxAttempts: step.maxAttempts,
          ...traceErrorAttributes(step.error),
        },
      });
    for (const attempt of run.stepAttempts) {
      const parent = run.steps.find((step) => step.id === attempt.stepId);
      const executionInput = workflowAttemptExecutionInput(attempt.input);
      const channelId = stringField(executionInput.channelId);
      spans.push({
        spanId: stableSpanId("workflow-attempt", attempt.id),
        parentSpanId: parent?.spanId,
        kind: "workflow_attempt",
        name: `attempt-${attempt.attempt}`,
        status: attempt.status,
        startedAt: requiredIso(attempt.startedAt ?? attempt.createdAt),
        completedAt: optionalIso(attempt.finishedAt),
        attributes: {
          attemptId: attempt.id,
          provider:
            channelNames.get(attempt.provider ?? channelId) ??
            attempt.provider ??
            channelId,
          model: attempt.modelKey ?? stringField(executionInput.model),
          inputHash: attempt.inputHash,
          usage: attempt.usageJson,
          errorCode: attempt.errorCode,
          error: attempt.errorMessage,
        },
      });
    }
    for (const artifact of run.artifacts) {
      const parent = run.steps.find((step) => step.id === artifact.stepId);
      for (const [index, prompt] of promptTraces(artifact.payload).entries())
        spans.push({
          spanId: stableSpanId("prompt", `${artifact.id}:${index}`),
          parentSpanId: parent?.spanId,
          kind: "prompt",
          name: stringField(prompt.promptId) || "prompt",
          status: "succeeded",
          startedAt: requiredIso(artifact.createdAt),
          completedAt: requiredIso(artifact.createdAt),
          attributes: prompt,
        });
      const artifactSummary = traceableArtifactSummary(artifact.payload);
      if (artifactSummary)
        spans.push({
          spanId: stableSpanId("workflow-artifact", artifact.id),
          parentSpanId: parent?.spanId,
          kind: "workflow_artifact",
          name: artifactSpanName(artifact.artifactType, artifactSummary),
          status: artifactSummary.success ? "succeeded" : "failed",
          startedAt: requiredIso(artifact.createdAt),
          completedAt: requiredIso(artifact.createdAt),
          attributes: {
            artifactId: artifact.id,
            artifactType: artifact.artifactType,
            refId: artifact.refId,
            ...artifactSummary,
          },
        });
    }
  }
  for (const task of tasks)
    spans.push({
      spanId: task.spanId,
      parentSpanId: task.parentSpanId ?? undefined,
      kind: "media_task",
      name: `${task.kind}:${task.targetType ?? "media"}`,
      status: task.status,
      startedAt: requiredIso(task.startedAt ?? task.createdAt),
      completedAt: optionalIso(task.completedAt),
      attributes: {
        taskId: task.id,
        workflowRunId: task.workflowRunId,
        workflowStepId: task.workflowStepId,
        projectId: task.projectId,
        episodeId: task.episodeId,
        provider: task.provider,
        protocol: task.protocol,
        model: task.model,
        progress: task.progress,
        assetIds: task.assets.map((asset) => asset.id),
      },
    });

  const latestRunStartEventId = run?.events
    .filter((event) => event.type === "running")
    .at(-1)?.id;
  const latestStepStartEventIds = new Map<string, string>();
  for (const event of run?.events ?? [])
    if (event.type === "step_running" && event.stepId)
      latestStepStartEventIds.set(event.stepId, event.id);

  return {
    traceId: normalized,
    rootSpanId: run?.spanId ?? tasks.find((task) => !task.parentSpanId)?.spanId ?? tasks[0]?.spanId,
    spans: spans.sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    events: [
      ...(run?.events.map((event) => {
        const step = run.steps.find((item) => item.id === event.stepId);
        const isCurrentStart =
          (event.type === "running" &&
            event.id === latestRunStartEventId &&
            run.status === "running") ||
          (event.type === "step_running" &&
            !!event.stepId &&
            event.id === latestStepStartEventIds.get(event.stepId) &&
            step?.status === "running");
        return {
          source: "workflow" as const,
          id: event.id,
          spanId: step?.spanId ?? run.spanId,
          type: event.type,
          status: workflowEventDisplayStatus(
            event.type,
            event.status,
            isCurrentStart,
          ),
          message: event.message,
          createdAt: event.createdAt.toISOString(),
        };
      }) ?? []),
      ...tasks.flatMap((task) =>
        task.events.map((event) => ({
          source: "media_task" as const,
          id: event.id,
          spanId: task.spanId,
          type: event.type,
          status: event.status,
          message: event.message,
          createdAt: event.createdAt.toISOString(),
        })),
      ),
    ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

type ExecutionSpan = {
  spanId: string;
  parentSpanId?: string;
  kind:
    | "workflow_run"
    | "workflow_step"
    | "workflow_attempt"
    | "workflow_artifact"
    | "prompt"
    | "media_task";
  name: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  attributes: Record<string, unknown>;
};

function promptTraces(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, Prisma.JsonValue>;
  const values = Array.isArray(record.promptTraces) ? record.promptTraces : [record];
  return values.filter(
    (item): item is Prisma.JsonObject =>
      !!item && typeof item === "object" && !Array.isArray(item) && "promptId" in item,
  );
}

function workflowAttemptExecutionInput(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, Prisma.JsonValue>;
  const run =
    record.run && typeof record.run === "object" && !Array.isArray(record.run)
      ? record.run
      : {};
  const step =
    record.step &&
    typeof record.step === "object" &&
    !Array.isArray(record.step)
      ? record.step
      : {};
  return { ...run, ...step };
}

function traceableArtifactSummary(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, Prisma.JsonValue>;
  if (typeof record.success !== "boolean") return null;
  const summary: Record<string, string | number | boolean | null> = {
    success: record.success,
  };
  for (const key of [
    "clipId",
    "clipIndex",
    "sceneCount",
    "reused",
    "degraded",
    "error",
    "fallbackReason",
    "inputHash",
  ]) {
    const field = record[key];
    if (
      typeof field === "string" ||
      typeof field === "number" ||
      typeof field === "boolean" ||
      field === null
    )
      summary[key] = field;
  }
  return summary;
}

function artifactSpanName(
  artifactType: string,
  summary: Record<string, string | number | boolean | null>,
) {
  return typeof summary.clipIndex === "number"
    ? `${artifactType} #${summary.clipIndex + 1}`
    : artifactType;
}

function workflowEventDisplayStatus(
  type: string,
  status: string | null,
  isCurrentStart: boolean,
) {
  if (type === "running" || type === "step_running")
    return isCurrentStart ? "running" : "succeeded";
  return [
    "created",
    "artifact_committed",
    "retry_requested",
    "step_retry_requested",
    "cancel_requested",
  ].includes(type)
    ? "succeeded"
    : status;
}

function stringField(value: unknown) {
  return typeof value === "string" ? value : "";
}

function traceErrorAttributes(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, Prisma.JsonValue>;
  return {
    errorCode: stringField(record.code),
    error: stringField(record.message),
  };
}

function requiredIso(value: Date) {
  return value.toISOString();
}

function optionalIso(value: Date | null | undefined) {
  return value?.toISOString();
}
