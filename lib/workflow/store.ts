import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import {
  createWorkflowStepTraceContext,
  createWorkflowTraceContext,
} from "@/lib/observability/trace-context";
import { prisma } from "@/lib/server/prisma";
import { resolveProductionConfiguration } from "@/lib/production-configuration/store";
import { configurationSnapshotSchema } from "@/lib/production-configuration/contract";
import { assertPreviewConfiguration } from "@/lib/production-configuration/execution";
import {
  assertWorkflowAction,
  assertWorkflowDefinition,
  type WorkflowRunDefinition,
  type WorkflowRunStatus,
} from "./contract";
import {
  downstreamRetryStepKeys,
  workflowRetryStepKeys,
} from "./retry-scope";
import { getWorkflowTemplate } from "./registry";

const include = {
  steps: { orderBy: { stepIndex: "asc" as const } },
  events: { orderBy: { createdAt: "desc" as const }, take: 200 },
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
  workflowVersion: true,
  input: true,
  targetType: true,
  targetId: true,
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
      dependsOn: true,
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
  const workflowInput = definition.input && typeof definition.input === "object" && !Array.isArray(definition.input)
    ? definition.input as Record<string, unknown> : {};
  const productionConfiguration = await resolveProductionConfiguration(definition.userId, {
    projectId: definition.projectId, episodeId: definition.episodeId ?? undefined,
    ...(targetType === "storyboard_panel" && definition.episodeId ? { panelId: targetId } : {}),
  });
  const normalizedWorkflowType = definition.workflowType.trim();
  const registeredTemplate = getWorkflowTemplate(normalizedWorkflowType);
  // Always replace caller-supplied context, including through the generic workflow API.
  // Step inputs are persisted once; retries never reread edited shot facts or adopted assets.
  const executionSteps = await Promise.all(definition.steps.map(async (step) => {
    if (!["design_storyboard_media_prompt", "review_storyboard_video"].includes(step.type)) return step;
    const stepInput = step.input && typeof step.input === "object" && !Array.isArray(step.input)
      ? step.input as Record<string, unknown> : {};
    const merged = { ...workflowInput, ...stepInput };
    if (!definition.episodeId || typeof merged.panelId !== "string") throw new Error("WORKFLOW_PANEL_REQUIRED");
    const { captureStoryboardPromptContext } = await import("@/lib/media/storyboard-prompt-design");
    const capturedContext = await captureStoryboardPromptContext({
      userId: definition.userId, projectId: definition.projectId, episodeId: definition.episodeId, panelId: merged.panelId,
    });
    return { ...step, input: { ...stepInput, capturedContext } };
  }));
  assertWorkflowDefinition(executionSteps);
  const orchestrationSnapshot = registeredTemplate
    ? {
        templateType: registeredTemplate.type,
        templateVersion: registeredTemplate.version,
        steps: executionSteps.map((step) => ({
          key: step.key,
          type: step.type,
          dependsOn: [...(step.dependsOn ?? [])],
          artifactTypes: [...(step.artifactTypes ?? [])],
          requiredArtifactTypes: [...(registeredTemplate.steps.find((templateStep) => templateStep.key === step.key)?.requiredArtifactTypes ?? [])],
          retryable: step.retryable ?? true,
          maxAttempts: step.maxAttempts ?? definition.maxAttempts ?? 3,
        })),
      }
    : undefined;
  const requestedConcurrency = workflowInput.concurrency;
  assertPreviewConfiguration(productionConfiguration, definition.expectedConfigurationHash);
  const concurrency = typeof requestedConcurrency === "number" && Number.isFinite(requestedConcurrency)
    ? Math.max(1, Math.min(8, Math.floor(requestedConcurrency)))
    : productionConfiguration.workflow.concurrency;
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
        workflowVersion: registeredTemplate?.version ?? 1,
        targetType,
        targetId,
        activeDedupeKey,
        input: toJson({
          ...workflowInput,
          concurrency,
          productionConfiguration,
          ...(orchestrationSnapshot ? { orchestrationSnapshot } : {}),
        }),
        steps: {
          create: executionSteps.map((step, index) => {
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
              stepCount: executionSteps.length,
              targetType,
              targetId,
              ...(workflowInput.regeneratedFromRunId ? { resetKeys: executionSteps.map(step => step.key), retryMode: "restart" } : {}),
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
  episodeId?: string,
) {
  const rows = await prisma.workflowRun.findMany({
    where: { userId, projectId, ...(episodeId ? { episodeId } : {}) },
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
  const [recent, active] = await Promise.all([
    prisma.workflowRun.findMany({ where: { userId, projectId }, orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100), select: summarySelect }),
    prisma.workflowRun.findMany({ where: { userId, projectId, status: { in: ACTIVE_WORKFLOW_STATUSES } },
      orderBy: { createdAt: "desc" }, select: summarySelect }),
  ]);
  const rows = [...new Map([...recent, ...active].map(row => [row.id, row])).values()]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
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
  if (status === "paused") {
    const row = await prisma.$transaction(async (tx) => {
      await tx.workflowRun.update({
        where: { id: runId },
        data: {
          status,
          heartbeatAt: now,
          cancelRequestedAt: null,
          completedAt: null,
          activeDedupeKey: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        },
      });
      await tx.workflowStep.updateMany({
        where: { runId, status: "running" },
        data: { status: "pending", completedAt: null, updatedAt: now },
      });
      await tx.workflowStepAttempt.updateMany({
        where: { runId, status: "running" },
        data: {
          status: "paused",
          errorCode: "WORKFLOW_PAUSED",
          errorMessage: "工作流已暂停。",
          finishedAt: now,
          updatedAt: now,
        },
      });
      await tx.workflowEvent.create({
        data: { runId, type: status, status, message },
      });
      return tx.workflowRun.findUnique({ where: { id: runId }, include });
    });
    return row ? toRun(row) : null;
  }
  const row = await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status,
      heartbeatAt: now,
      updatedAt: now,
      ...(status === "running" ? { startedAt: current.startedAt ?? now } : {}),
      ...(status === "queued" ? { activeDedupeKey } : {}),
      ...(status === "succeeded" || status === "failed" || status === "canceled"
        ? {
            completedAt: now,
            activeDedupeKey: null,
            leaseOwner: null,
            leaseExpiresAt: null,
          }
        : {}),
      ...(status === "queued"
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
  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    await tx.workflowRun.update({
      where: { id: runId },
      data: {
        status: "canceled",
        cancelRequestedAt: now,
        completedAt: now,
        activeDedupeKey: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      },
    });
    await tx.workflowStep.updateMany({
      where: { runId, status: "running" },
      data: { status: "paused", completedAt: now, updatedAt: now },
    });
    await tx.workflowStepAttempt.updateMany({
      where: { runId, status: "running" },
      data: {
        status: "canceled",
        errorCode: "WORKFLOW_CANCELED",
        errorMessage: "工作流已取消。",
        finishedAt: now,
        updatedAt: now,
      },
    });
    await tx.workflowEvent.create({
      data: { runId, type: "cancel_requested", status: "canceled" },
    });
    return tx.workflowRun.findUnique({ where: { id: runId }, include });
  });
  return row ? toRun(row) : null;
}

export async function retryWorkflowRun(userId: string, runId: string, mode?: "continue" | "restart") {
  const current = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    include: { steps: true },
  });
  if (!current || !["failed", "blocked"].includes(current.status)) return null;
  const resetKeys = workflowRetryStepKeys(current.steps.map((step) => ({
    stepKey: step.stepKey,
    stepIndex: step.stepIndex,
    status: step.status,
    dependsOn: parseStringArray(step.dependsOn),
  })));
  const retryMode = mode ?? getRetryMode(current.input);
  const activeDedupeKey = buildRunDedupeKey(current);
  if (await hasConflictingActiveRun(runId, activeDedupeKey)) return null;
  const resetStepIds = current.steps
    .filter((step) => resetKeys.includes(step.stepKey))
    .map((step) => step.id);
  await prisma.$transaction([
    prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: "queued",
        activeDedupeKey,
        output: Prisma.DbNull,
        error: Prisma.DbNull,
        leaseOwner: null,
        leaseExpiresAt: null,
        queuedAt: new Date(),
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
    ...(retryMode === "restart"
      ? [
          prisma.workflowArtifact.deleteMany({
            where: {
              runId,
              stepId: { in: resetStepIds },
            },
          }),
          prisma.workflowCheckpoint.deleteMany({
            where: { runId, stepKey: { in: resetKeys } },
          }),
        ]
      : []),
    prisma.workflowEvent.create({
      data: {
        runId,
        type: "retry_requested",
        status: "queued",
        payload: toJson({ resetKeys, retryMode }),
      },
    }),
  ]);
  return getWorkflowRun(userId, runId);
}

export async function retryWorkflowStep(
  userId: string,
  runId: string,
  stepKey: string,
  mode?: "continue" | "restart",
) {
  const current = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    include: { steps: true },
  });
  if (!current || ["running", "canceled"].includes(current.status)) return null;
  const target = current.steps.find((step) => step.stepKey === stepKey);
  if (!target || !isWorkflowStepManuallyRetryable(target)) return null;
  const retryMode = mode ?? getRetryMode(current.input);
  const resetKeys = downstreamRetryStepKeys(current.steps.map((step) => ({
    stepKey: step.stepKey,
    dependsOn: parseStringArray(step.dependsOn),
  })), stepKey);
  const activeDedupeKey = buildRunDedupeKey(current);
  if (await hasConflictingActiveRun(runId, activeDedupeKey)) return null;
  const resetStepIds = current.steps
    .filter((step) => resetKeys.includes(step.stepKey))
    .map((step) => step.id);
  await prisma.$transaction([
    prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: "queued",
        activeDedupeKey,
        output: Prisma.DbNull,
        error: Prisma.DbNull,
        leaseOwner: null,
        leaseExpiresAt: null,
        queuedAt: new Date(),
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
    ...(retryMode === "restart"
      ? [
          prisma.workflowArtifact.deleteMany({
            where: { runId, stepId: { in: resetStepIds } },
          }),
          prisma.workflowCheckpoint.deleteMany({
            where: { runId, stepKey: { in: resetKeys } },
          }),
        ]
      : []),
    prisma.workflowEvent.create({
      data: {
        runId,
        stepId: target.id,
        type: "step_retry_requested",
        status: "queued",
        payload: toJson({ stepKey, resetKeys, retryMode }),
      },
    }),
  ]);
  return getWorkflowRun(userId, runId);
}

function getRetryMode(input: Prisma.JsonValue | null) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return "restart" as const;
  const snapshot = configurationSnapshotSchema.safeParse(
    (input as Record<string, unknown>).productionConfiguration,
  );
  return snapshot.success ? snapshot.data.workflow.retryMode : "restart";
}

export function isWorkflowStepManuallyRetryable(step: {
  status: string;
  attempt: number;
  maxAttempts: number;
  retryable: boolean;
}) {
  if (["failed", "blocked"].includes(step.status)) return true;
  return step.retryable && step.attempt < step.maxAttempts;
}

type Row = Prisma.WorkflowRunGetPayload<{ include: typeof include }>;
type SummaryRow = Prisma.WorkflowRunGetPayload<{
  select: typeof summarySelect;
}>;

function toRunSummary(row: SummaryRow) {
  const input = row.input as Record<string, unknown> | null;
  return {
    id: row.id,
    traceId: row.traceId,
    spanId: row.spanId,
    projectId: row.projectId,
    episodeId: row.episodeId ?? undefined,
    workflowType: row.workflowType,
    workflowVersion: row.workflowVersion,
    execution:
      row.workflowType === "story-to-script"
        ? input?.channelId && input?.model
          ? ("ai" as const)
          : ("local" as const)
        : undefined,
    targetType: row.targetType ?? undefined,
    targetId: row.targetId ?? undefined,
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
      dependsOn: parseStringArray(step.dependsOn),
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
    events: [...row.events].reverse().map((event) => ({
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

async function hasConflictingActiveRun(runId: string, activeDedupeKey: string) {
  return Boolean(
    await prisma.workflowRun.count({
      where: { id: { not: runId }, activeDedupeKey },
    }),
  );
}
