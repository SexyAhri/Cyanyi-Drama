import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import {
  createWorkflowStepTraceContext,
  createWorkflowTraceContext,
} from "@/lib/observability/trace-context";
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

const summarySelect = {
  id: true,
  traceId: true,
  spanId: true,
  projectId: true,
  episodeId: true,
  workflowType: true,
  status: true,
  error: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
  steps: {
    orderBy: { stepIndex: "asc" as const },
    select: {
      id: true,
      stepKey: true,
      stepType: true,
      stepIndex: true,
      status: true,
      attempt: true,
      maxAttempts: true,
      retryable: true,
      error: true,
      startedAt: true,
      completedAt: true,
    },
  },
} as const;

const ACTIVE_WORKFLOW_STATUSES: WorkflowRunStatus[] = [
  "queued",
  "running",
  "canceling",
  "paused",
];

export async function createWorkflowRun(definition: WorkflowRunDefinition) {
  const result = await createOrReuseWorkflowRun(definition);
  return result?.workflow ?? null;
}

export async function createOrReuseWorkflowRun(
  definition: WorkflowRunDefinition,
) {
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
  const targetType =
    definition.targetType?.trim() ||
    (definition.episodeId ? "episode" : "project");
  const targetId =
    definition.targetId?.trim() || definition.episodeId || definition.projectId;
  const activeDedupeKey = buildActiveWorkflowDedupeKey({
    userId: definition.userId,
    projectId: definition.projectId,
    workflowType: definition.workflowType,
    targetType,
    targetId,
  });
  const existing = await findReusableWorkflowRun(activeDedupeKey);
  if (existing) return { workflow: toRun(existing), reused: true };
  const runTrace = createWorkflowTraceContext(definition.id);

  try {
    const row = await prisma.workflowRun.create({
      data: {
        id: definition.id,
        userId: definition.userId,
        traceId: runTrace.traceId,
        spanId: runTrace.spanId,
        projectId: definition.projectId,
        episodeId: definition.episodeId ?? null,
        workflowType: definition.workflowType.trim(),
        targetType,
        targetId,
        activeDedupeKey,
        input: toJson(definition.input),
        steps: {
          create: definition.steps.map((step, index) => {
            const stepId = randomUUID();
            const trace = createWorkflowStepTraceContext({
              runId: definition.id,
              stepId,
              parent: runTrace,
            });
            return {
              id: stepId,
              traceId: trace.traceId,
              spanId: trace.spanId,
              parentSpanId: trace.parentSpanId!,
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
            };
          }),
        },
        events: {
          create: {
            type: "created",
            status: "queued",
            payload: toJson({
              stepCount: definition.steps.length,
              targetType,
              targetId,
            }),
          },
        },
      },
      include,
    });
    return { workflow: toRun(row), reused: false };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await findReusableWorkflowRun(activeDedupeKey);
      if (raced) return { workflow: toRun(raced), reused: true };
    }
    throw error;
  }
}

async function findReusableWorkflowRun(activeDedupeKey: string) {
  return prisma.workflowRun.findFirst({
    where: {
      activeDedupeKey,
      status: { in: ACTIVE_WORKFLOW_STATUSES },
    },
    orderBy: { updatedAt: "desc" },
    include,
  });
}

export function buildActiveWorkflowDedupeKey(input: {
  userId: string;
  projectId: string;
  workflowType: string;
  targetType: string;
  targetId: string;
}) {
  const canonical = [
    input.userId,
    input.projectId,
    input.workflowType,
    input.targetType,
    input.targetId,
  ]
    .map((value) => value.trim().toLowerCase())
    .join("\u0000");
  return createHash("sha256").update(canonical).digest("hex");
}

export async function getWorkflowRun(userId: string, runId: string) {
  const row = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    include,
  });
  return row ? toRun(row) : null;
}

export async function removeTerminalWorkflowRun(userId: string, runId: string) {
  const result = await prisma.workflowRun.deleteMany({
    where: {
      id: runId,
      userId,
      status: { in: ["blocked", "canceled", "failed", "succeeded"] },
    },
  });
  return result.count > 0;
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

export async function listWorkflowRunSummaries(
  userId: string,
  projectId: string,
  limit = 50,
) {
  const rows = await prisma.workflowRun.findMany({
    where: { userId, projectId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: summarySelect,
  });
  return rows.map(toRunSummary);
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
  const activeDedupeKey =
    status === "queued" ? buildRunDedupeKey(current) : null;
  if (
    activeDedupeKey &&
    (await hasConflictingActiveRun(runId, activeDedupeKey))
  )
    return null;
  const now = new Date();
  const row = await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status,
      heartbeatAt: now,
      updatedAt: now,
      ...(status === "running" ? { startedAt: current.startedAt ?? now } : {}),
      ...(status === "queued"
        ? { activeDedupeKey }
        : {}),
      ...(status === "succeeded" || status === "failed" || status === "canceled"
        ? {
            completedAt: now,
            activeDedupeKey: null,
            leaseOwner: null,
            leaseExpiresAt: null,
          }
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
  if (
    !current ||
    !["queued", "running", "canceling", "paused"].includes(current.status)
  )
    return null;
  if (current.status === "canceling") return getWorkflowRun(userId, runId);
  const now = new Date();
  const requiresWorkerAck = current.status === "running";
  const row = await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status: requiresWorkerAck ? "canceling" : "canceled",
      cancelRequestedAt: now,
      completedAt: requiresWorkerAck ? null : now,
      ...(requiresWorkerAck
        ? {}
        : {
            activeDedupeKey: null,
            leaseOwner: null,
            leaseExpiresAt: null,
          }),
      updatedAt: now,
    },
    include,
  });
  await prisma.workflowEvent.create({
    data: {
      runId,
      type: "cancel_requested",
      status: requiresWorkerAck ? "canceling" : "canceled",
    },
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
  const activeDedupeKey = buildRunDedupeKey(current);
  if (await hasConflictingActiveRun(runId, activeDedupeKey)) return null;
  const retryRootIds = current.steps
    .filter((step) => ["failed", "blocked", "running"].includes(step.status))
    .map((step) => step.id);
  const downstreamStepIds = current.steps
    .filter(
      (step) =>
        resetKeys.includes(step.stepKey) && !retryRootIds.includes(step.id),
    )
    .map((step) => step.id);
  await prisma.$transaction([
    prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: "queued",
        activeDedupeKey,
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
      where: {
        runId,
        OR: [
          { stepId: { in: downstreamStepIds } },
          { stepId: { in: retryRootIds }, refId: null },
        ],
      },
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
  phaseRetry?: StoryboardPhaseRetry,
) {
  const current = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    include: { steps: true },
  });
  if (!current || ["running", "canceled"].includes(current.status)) return null;
  const target = current.steps.find((step) => step.stepKey === stepKey);
  if (!target || !target.retryable || target.attempt >= target.maxAttempts)
    return null;
  if (
    phaseRetry &&
    (current.workflowType !== "script-to-storyboard" ||
      target.stepType !== "build_storyboard")
  )
    return null;
  const resetKeys =
    phaseRetry?.phase === "continuity"
      ? [stepKey]
      : resolveDownstreamStepKeys(current.steps, stepKey);
  const activeDedupeKey = buildRunDedupeKey(current);
  if (await hasConflictingActiveRun(runId, activeDedupeKey)) return null;
  const downstreamStepIds = current.steps
    .filter(
      (step) => resetKeys.includes(step.stepKey) && step.stepKey !== stepKey,
    )
    .map((step) => step.id);
  const artifactWhere = buildRetryArtifactWhere({
    runId,
    targetStepId: target.id,
    downstreamStepIds,
    phaseRetry,
    preserveTargetArtifacts: ["failed", "blocked"].includes(target.status),
  });
  await prisma.$transaction([
    prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: "queued",
        activeDedupeKey,
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
      where: artifactWhere,
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
        payload: toJson({ stepKey, resetKeys, phaseRetry }),
      },
    }),
  ]);
  return getWorkflowRun(userId, runId);
}

export const STORYBOARD_RETRY_PHASES = [
  "phase1",
  "phase2",
  "phase2.cine",
  "phase2.acting",
  "phase3",
  "continuity",
] as const;

export type StoryboardRetryPhase = (typeof STORYBOARD_RETRY_PHASES)[number];

export type StoryboardPhaseRetry = {
  refId: string;
  phase: StoryboardRetryPhase;
};

function buildRetryArtifactWhere(input: {
  runId: string;
  targetStepId: string;
  downstreamStepIds: string[];
  phaseRetry?: StoryboardPhaseRetry;
  preserveTargetArtifacts: boolean;
}): Prisma.WorkflowArtifactWhereInput {
  const targetFilters: Prisma.WorkflowArtifactWhereInput[] =
    input.phaseRetry || input.preserveTargetArtifacts
      ? [{ stepId: input.targetStepId, refId: null }]
      : [{ stepId: input.targetStepId }];
  if (input.phaseRetry) {
    const invalidation = getStoryboardPhaseInvalidation(input.phaseRetry.phase);
    targetFilters.push(
      {
        stepId: input.targetStepId,
        refId: input.phaseRetry.refId,
        artifactType: { in: invalidation.artifactTypes },
      },
      {
        stepId: input.targetStepId,
        artifactType: "prompt.trace",
        refId: {
          in: invalidation.tracePhases.map(
            (phase) => `${input.phaseRetry?.refId}:${phase}`,
          ),
        },
      },
    );
  }
  return {
    runId: input.runId,
    OR: [
      { stepId: { in: input.downstreamStepIds } },
      ...targetFilters,
    ],
  };
}

export function getStoryboardPhaseInvalidation(phase: StoryboardRetryPhase) {
  const ordered = [
    { phase: "phase1", artifactType: "storyboard.clip.phase1" },
    { phase: "phase2.cine", artifactType: "storyboard.clip.phase2.cine" },
    { phase: "phase2.acting", artifactType: "storyboard.clip.phase2.acting" },
    { phase: "phase3", artifactType: "storyboard.clip.phase3" },
    { phase: "continuity", artifactType: "storyboard.clip.continuity" },
  ] as const;
  const included =
    phase === "phase1"
      ? ordered
      : phase === "phase2"
        ? ordered.slice(1)
        : phase === "phase2.cine"
          ? ordered.filter((item) =>
              ["phase2.cine", "phase3", "continuity"].includes(item.phase),
            )
          : phase === "phase2.acting"
            ? ordered.filter((item) =>
                ["phase2.acting", "phase3", "continuity"].includes(item.phase),
              )
            : phase === "phase3"
              ? ordered.slice(3)
              : ordered.slice(4);
  return {
    artifactTypes: included.map((item) => item.artifactType),
    tracePhases: included.map((item) => item.phase),
  };
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
type SummaryRow = Prisma.WorkflowRunGetPayload<{ select: typeof summarySelect }>;

function toRunSummary(row: SummaryRow) {
  return {
    id: row.id,
    traceId: row.traceId,
    spanId: row.spanId,
    projectId: row.projectId,
    episodeId: row.episodeId ?? undefined,
    workflowType: row.workflowType,
    status: row.status,
    error: row.error as Record<string, unknown> | undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    steps: row.steps.map((step) => ({
      id: step.id,
      key: step.stepKey,
      type: step.stepType,
      index: step.stepIndex,
      status: step.status,
      attempt: step.attempt,
      maxAttempts: step.maxAttempts,
      retryable: step.retryable,
      error: step.error as Record<string, unknown> | undefined,
      startedAt: step.startedAt?.toISOString(),
      completedAt: step.completedAt?.toISOString(),
    })),
  };
}

function toRun(row: Row) {
  return {
    id: row.id,
    userId: row.userId,
    traceId: row.traceId,
    spanId: row.spanId,
    projectId: row.projectId,
    episodeId: row.episodeId ?? undefined,
    workflowType: row.workflowType,
    targetType: row.targetType ?? undefined,
    targetId: row.targetId ?? undefined,
    status: row.status as WorkflowRunStatus,
    input: row.input as Record<string, unknown> | undefined,
    output: row.output as Record<string, unknown> | undefined,
    error: row.error as Record<string, unknown> | undefined,
    workflowVersion: row.workflowVersion,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString(),
    heartbeatAt: row.heartbeatAt?.toISOString(),
    leaseExpiresAt: row.leaseExpiresAt?.toISOString(),
    cancelRequestedAt: row.cancelRequestedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    steps: row.steps.map((step) => ({
      id: step.id,
      traceId: step.traceId,
      spanId: step.spanId,
      parentSpanId: step.parentSpanId,
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

function buildRunDedupeKey(run: {
  userId: string;
  projectId: string;
  workflowType: string;
  episodeId: string | null;
  targetType: string | null;
  targetId: string | null;
}) {
  return buildActiveWorkflowDedupeKey({
    userId: run.userId,
    projectId: run.projectId,
    workflowType: run.workflowType,
    targetType: run.targetType || (run.episodeId ? "episode" : "project"),
    targetId: run.targetId || run.episodeId || run.projectId,
  });
}

async function hasConflictingActiveRun(
  runId: string,
  activeDedupeKey: string,
) {
  return Boolean(
    await prisma.workflowRun.count({
      where: { id: { not: runId }, activeDedupeKey },
    }),
  );
}
