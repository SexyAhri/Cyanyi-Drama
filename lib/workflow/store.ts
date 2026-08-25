import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/server/prisma";
import {
  assertWorkflowAction,
  assertWorkflowDefinition,
  type WorkflowRunDefinition,
  type WorkflowRunStatus,
} from "./contract";

const include = {
  steps: { orderBy: { stepIndex: "asc" as const } },
  events: { orderBy: { createdAt: "asc" as const }, take: 200 },
  checkpoints: { orderBy: { createdAt: "asc" as const }, take: 200 },
  stepAttempts: { orderBy: { createdAt: "asc" as const }, take: 200 },
} as const;

export async function createWorkflowRun(definition: WorkflowRunDefinition) {
  assertWorkflowDefinition(definition.steps);
  const ownsProject = await prisma.project.count({
    where: { id: definition.projectId, userId: definition.userId },
  });
  if (!ownsProject) return null;
  if (
    definition.episodeId &&
    !(await prisma.episode.count({
      where: {
        id: definition.episodeId,
        projectId: definition.projectId,
        project: { userId: definition.userId },
      },
    }))
  )
    return null;
  const row = await prisma.workflowRun.create({
    data: {
      id: definition.id,
      userId: definition.userId,
      projectId: definition.projectId,
      episodeId: definition.episodeId ?? null,
      workflowType: definition.workflowType,
      input: toJson(definition.input),
      steps: {
        create: definition.steps.map((step, index) => ({
          id: randomUUID(),
          stepKey: step.key.trim(),
          stepType: step.type.trim(),
          stepIndex: index,
          dependsOn: toJson(step.dependsOn ?? []),
          artifactTypes: toJson(step.artifactTypes ?? []),
          retryable: step.retryable ?? true,
          failureMode: step.failureMode ?? "fail_run",
          maxAttempts: Math.max(
            1,
            step.maxAttempts ?? definition.maxAttempts ?? 3,
          ),
          input: toJson(step.input),
        })),
      },
      events: {
        create: {
          type: "created",
          status: "queued",
          payload: toJson({ stepCount: definition.steps.length }),
        },
      },
    },
    include,
  });
  return toRun(row);
}

export async function getWorkflowRun(userId: string, runId: string) {
  const row = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    include,
  });
  return row ? toRun(row) : null;
}

export async function listWorkflowRuns(
  userId: string,
  projectId: string,
  limit = 50,
) {
  const rows = await prisma.workflowRun.findMany({
    where: { userId, projectId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    include,
  });
  return rows.map(toRun);
}

export async function updateWorkflowRunStatus(
  userId: string,
  runId: string,
  status: WorkflowRunStatus,
  message?: string,
) {
  const current = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
  });
  if (!current) return null;
  const currentStatus = current.status as WorkflowRunStatus;
  if (status === "paused") assertWorkflowAction("pause", currentStatus);
  if (status === "queued" && message === "resume_requested") {
    assertWorkflowAction("resume", currentStatus);
  }
  const now = new Date();
  const row = await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status,
      heartbeatAt: now,
      updatedAt: now,
      ...(status === "running" ? { startedAt: current.startedAt ?? now } : {}),
      ...(status === "succeeded" || status === "failed" || status === "canceled"
        ? { completedAt: now }
        : {}),
      ...(status === "paused" || status === "queued"
        ? { cancelRequestedAt: null, completedAt: null }
        : {}),
    },
    include,
  });
  await prisma.workflowEvent.create({
    data: { runId, type: status, status, message },
  });
  return toRun(row);
}

export async function requestWorkflowCancel(userId: string, runId: string) {
  const current = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    select: { status: true },
  });
  if (!current || !["queued", "running", "paused"].includes(current.status))
    return null;
  const now = new Date();
  const row = await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status: "canceled",
      cancelRequestedAt: now,
      completedAt: now,
      updatedAt: now,
    },
    include,
  });
  await prisma.workflowEvent.create({
    data: { runId, type: "cancel_requested", status: "canceled" },
  });
  return toRun(row);
}

export async function retryWorkflowRun(userId: string, runId: string) {
  const current = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    include: { steps: true },
  });
  if (!current || !["failed", "blocked"].includes(current.status)) return null;
  const exhausted = current.steps.some(
    (step) =>
      ["failed", "blocked"].includes(step.status) &&
      step.attempt >= step.maxAttempts,
  );
  if (exhausted) return null;
  const resetKeys = resolveRetryStepKeys(current.steps);
  const resetStepIds = current.steps
    .filter((step) => resetKeys.includes(step.stepKey))
    .map((step) => step.id);
  await prisma.$transaction([
    prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: "queued",
        error: Prisma.DbNull,
        completedAt: null,
        cancelRequestedAt: null,
        updatedAt: new Date(),
      },
    }),
    prisma.workflowStep.updateMany({
      where: { runId, stepKey: { in: resetKeys } },
      data: {
        status: "pending",
        error: Prisma.DbNull,
        completedAt: null,
        updatedAt: new Date(),
      },
    }),
    prisma.workflowArtifact.deleteMany({
      where: { runId, stepId: { in: resetStepIds } },
    }),
    prisma.workflowCheckpoint.deleteMany({
      where: { runId, stepKey: { in: resetKeys } },
    }),
    prisma.workflowEvent.create({
      data: {
        runId,
        type: "retry_requested",
        status: "queued",
        payload: toJson({ resetKeys }),
      },
    }),
  ]);
  return getWorkflowRun(userId, runId);
}

export async function retryWorkflowStep(
  userId: string,
  runId: string,
  stepKey: string,
) {
  const current = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    include: { steps: true },
  });
  if (!current || ["running", "canceled"].includes(current.status)) return null;
  const target = current.steps.find((step) => step.stepKey === stepKey);
  if (!target || !target.retryable || target.attempt >= target.maxAttempts)
    return null;
  const resetKeys = resolveDownstreamStepKeys(current.steps, stepKey);
  const resetStepIds = current.steps
    .filter((step) => resetKeys.includes(step.stepKey))
    .map((step) => step.id);
  await prisma.$transaction([
    prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: "queued",
        error: Prisma.DbNull,
        completedAt: null,
        cancelRequestedAt: null,
        updatedAt: new Date(),
      },
    }),
    prisma.workflowStep.updateMany({
      where: { runId, stepKey: { in: resetKeys } },
      data: {
        status: "pending",
        output: Prisma.DbNull,
        error: Prisma.DbNull,
        completedAt: null,
        updatedAt: new Date(),
      },
    }),
    prisma.workflowArtifact.deleteMany({
      where: { runId, stepId: { in: resetStepIds } },
    }),
    prisma.workflowCheckpoint.deleteMany({
      where: { runId, stepKey: { in: resetKeys } },
    }),
    prisma.workflowEvent.create({
      data: {
        runId,
        stepId: target.id,
        type: "step_retry_requested",
        status: "queued",
        payload: toJson({ stepKey, resetKeys }),
      },
    }),
  ]);
  return getWorkflowRun(userId, runId);
}

function resolveRetryStepKeys(
  steps: Array<{
    stepKey: string;
    status: string;
    dependsOn: Prisma.JsonValue | null;
  }>,
) {
  const reset = new Set(
    steps
      .filter((step) => ["failed", "blocked", "running"].includes(step.status))
      .map((step) => step.stepKey),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of steps) {
      const dependencies = Array.isArray(step.dependsOn)
        ? step.dependsOn.filter(
            (item): item is string => typeof item === "string",
          )
        : [];
      if (
        !reset.has(step.stepKey) &&
        dependencies.some((key) => reset.has(key))
      ) {
        reset.add(step.stepKey);
        changed = true;
      }
    }
  }
  return Array.from(reset);
}

function resolveDownstreamStepKeys(
  steps: Array<{
    stepKey: string;
    dependsOn: Prisma.JsonValue | null;
  }>,
  stepKey: string,
) {
  const reset = new Set([stepKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of steps) {
      const dependencies = parseStringArray(step.dependsOn);
      if (
        !reset.has(step.stepKey) &&
        dependencies.some((key) => reset.has(key))
      ) {
        reset.add(step.stepKey);
        changed = true;
      }
    }
  }
  return Array.from(reset);
}

type Row = Prisma.WorkflowRunGetPayload<{ include: typeof include }>;
function toRun(row: Row) {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    episodeId: row.episodeId ?? undefined,
    workflowType: row.workflowType,
    status: row.status as WorkflowRunStatus,
    input: row.input as Record<string, unknown> | undefined,
    output: row.output as Record<string, unknown> | undefined,
    error: row.error as Record<string, unknown> | undefined,
    workflowVersion: row.workflowVersion,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    heartbeatAt: row.heartbeatAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    steps: row.steps.map((step) => ({
      id: step.id,
      key: step.stepKey,
      type: step.stepType,
      index: step.stepIndex,
      status: step.status,
      attempt: step.attempt,
      maxAttempts: step.maxAttempts,
      input: step.input as Record<string, unknown> | undefined,
      dependsOn: parseStringArray(step.dependsOn),
      artifactTypes: parseStringArray(step.artifactTypes),
      retryable: step.retryable,
      failureMode: step.failureMode,
      output: step.output as Record<string, unknown> | undefined,
      error: step.error as Record<string, unknown> | undefined,
      startedAt: step.startedAt?.toISOString(),
      completedAt: step.completedAt?.toISOString(),
    })),
    events: row.events.map((event) => ({
      id: event.id,
      stepId: event.stepId ?? undefined,
      type: event.type,
      status: event.status ?? undefined,
      message: event.message ?? undefined,
      payload: event.payload as Record<string, unknown> | undefined,
      createdAt: event.createdAt.toISOString(),
    })),
    checkpoints: row.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      stepKey: checkpoint.stepKey,
      version: checkpoint.version,
      state: checkpoint.stateJson as Record<string, unknown>,
      stateBytes: checkpoint.stateBytes,
      createdAt: checkpoint.createdAt.toISOString(),
    })),
    stepAttempts: row.stepAttempts.map((attempt) => ({
      id: attempt.id,
      stepId: attempt.stepId,
      attempt: attempt.attempt,
      status: attempt.status,
      provider: attempt.provider ?? undefined,
      modelKey: attempt.modelKey ?? undefined,
      inputHash: attempt.inputHash ?? undefined,
      input: attempt.input as Record<string, unknown> | undefined,
      outputText: attempt.outputText ?? undefined,
      usage: attempt.usageJson as Record<string, unknown> | undefined,
      errorCode: attempt.errorCode ?? undefined,
      errorMessage: attempt.errorMessage ?? undefined,
      startedAt: attempt.startedAt?.toISOString(),
      finishedAt: attempt.finishedAt?.toISOString(),
    })),
  };
}
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined
    ? undefined
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
}

function parseStringArray(value: Prisma.JsonValue | null) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
