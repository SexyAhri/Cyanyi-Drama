import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import {
  generateProjectAssetVisualProfile,
  type VisualDesignTargetType,
} from "@/lib/assets/visual-design";
import {
  extractCharacterReferenceDescription,
  extractProjectVisualAssets,
} from "@/lib/assets/visual-extraction";
import { adaptEpisodeSource } from "@/lib/episodes/adaptation";
import { splitEpisodesWithAi } from "@/lib/episodes/split";
import { analyzeManuscript } from "@/lib/episodes/manuscript-analysis";
import { generateOriginalEpisode } from "@/lib/production/original-episode-generation";
import { designStoryboardMediaPrompt, type StoryboardPromptContext } from "@/lib/media/storyboard-prompt-design";
import { reviewStoryboardVideo } from "@/lib/media/storyboard-video-review";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import {
  parseNovelAndPersist,
  type NovelParseInput,
} from "@/lib/novel/parser-runtime";
import { buildEpisodeStoryboard } from "@/lib/novel/script-to-storyboard-runtime";
import { organizeEpisodeProductionScript } from "@/lib/novel/production-script-organizer";
import { splitEpisodeIntoClips } from "@/lib/novel/story-to-script-runtime";
import {
  assembleEpisodeScreenplays,
  generateEpisodeScreenplayBeats,
  generateEpisodeScreenplayDialogue,
  generateEpisodeScreenplayEffects,
  generateEpisodeScreenplayNarration,
} from "@/lib/novel/staged-screenplay-runtime";
import { prisma } from "@/lib/server/prisma";
import { withModelBilling } from "@/lib/billing/context";
import type { WorkflowRequestUpdate } from "./request-events";
import {
  resolveFailedDependencyBlockers,
  runWorkflowStepWave,
  scheduleRunnableWorkflowSteps,
} from "./scheduler";
import { configurationSnapshotSchema } from "@/lib/production-configuration/contract";
import { classifyProviderFailure } from "@/lib/providers/failure-classification";
import { resolveProductionConfiguration } from "@/lib/production-configuration/store";
import { withProductionConfiguration } from "@/lib/production-configuration/context";
import { designEpisodeVoicePerformance } from "@/lib/voice/design";
import { analyzeEpisodeVoices } from "@/lib/voice/analyze";
import { notifyWorkflowActionRequired, notifyWorkflowTerminal } from "@/lib/notifications/execution-notifications";
import {
  assertWorkflowRunActive,
  WorkflowControlError,
  withWorkflowRunLease,
} from "./lease";

export async function processWorkflowJob(
  runId: string,
  userId: string,
  workerId = `workflow_${process.pid}_${randomUUID()}`,
) {
  const leased = await withWorkflowRunLease({
    runId,
    userId,
    workerId,
    run: () => processClaimedWorkflowJob(runId, userId, workerId),
  });
  if (!leased.claimed) return false;
  if (leased.result === "requeue") {
    const run = await prisma.workflowRun.findFirst({
      where: { id: runId, userId, status: "queued" },
      select: { projectId: true },
    });
    if (run)
      await enqueueWorkflowJob({
        runId,
        userId,
        projectId: run.projectId,
        maxAttempts: 1,
      });
  }
  return true;
}

async function processClaimedWorkflowJob(
  runId: string,
  userId: string,
  workerId: string,
  options: { stepKey?: string; deferRunSettlement?: boolean } = {},
): Promise<"done" | "requeue"> {
  const run = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    include: {
      steps: { orderBy: { stepIndex: "asc" } },
      events: {
        where: { type: { in: ["retry_requested", "step_retry_requested"] } },
        orderBy: { createdAt: "desc" },
        select: { payload: true },
      },
    },
  });
  if (!run) throw new Error("WORKFLOW_RUN_NOT_FOUND");
  if (run.status === "canceling") {
    await acknowledgeWorkflowCancel(runId, workerId);
    return "done";
  }
  if (["canceled", "paused", "succeeded"].includes(run.status)) return "done";
  const now = new Date();
  const started = await prisma.workflowRun.updateMany({
    where: { id: runId, leaseOwner: workerId, status: { in: ["queued", "running"] } },
    data: {
      status: "running",
      startedAt: run.startedAt ?? now,
      heartbeatAt: now,
      updatedAt: now,
    },
  });
  if (!started.count) throw new WorkflowControlError("lease_lost", runId);
  await prisma.workflowEvent.create({
    data: { runId, type: "running", status: "running" },
  });
  const interruptedStep = run.steps.find((item) => item.status === "running");
  if (!options.stepKey && interruptedStep) {
    await failInterruptedWorkflowSteps({
      runId,
      workerId,
      steps: run.steps.filter((item) => item.status === "running"),
    });
    return "done";
  }
  if (!options.stepKey) {
    const savedConfiguration = configurationSnapshotSchema.safeParse(
      isRecord(run.input) ? run.input.productionConfiguration : undefined,
    );
    if (!savedConfiguration.success && isRecord(run.input) && "productionConfiguration" in run.input)
      throw new Error("WORKFLOW_CONFIGURATION_SNAPSHOT_INVALID");
    const productionConfiguration = savedConfiguration.success
      ? savedConfiguration.data
      : await resolveProductionConfiguration(userId, { projectId: run.projectId, episodeId: run.episodeId ?? undefined });
    if (!savedConfiguration.success) {
      const frozenInput = {
        ...(isRecord(run.input) ? run.input : {}),
        concurrency:
          getNumber(isRecord(run.input) ? run.input.concurrency : undefined) ??
          productionConfiguration.workflow.concurrency,
        productionConfiguration,
      };
      const frozen = await prisma.workflowRun.updateMany({
        where: { id: runId, userId, leaseOwner: workerId, status: "running" },
        data: { input: toInputJson(frozenInput) },
      });
      if (!frozen.count) throw new WorkflowControlError("lease_lost", runId);
      run.input = toInputJson(frozenInput) as Prisma.JsonValue;
    }

    if (run.steps.every((item) => item.status === "succeeded")) {
      const lastStep = run.steps.at(-1);
      await finishRun(runId, userId, workerId, lastStep?.output ?? {});
      return "done";
    }

    const concurrency =
      getNumber(isRecord(run.input) ? run.input.concurrency : undefined) ??
      productionConfiguration.workflow.concurrency;
    const schedule = scheduleRunnableWorkflowSteps(run.steps.map((item) => ({
      stepKey: item.stepKey,
      stepIndex: item.stepIndex,
      stepType: item.stepType,
      status: item.status,
      dependsOn: item.dependsOn,
    })), concurrency);
    if (!schedule.runnable.length) {
      const error = {
        code: "WORKFLOW_DEPENDENCY_BLOCKED",
        message: "没有可执行的工作流步骤；请先完成显示的前置步骤。",
        blockedSteps: schedule.blocked,
      };
      const blockedAt = new Date();
      const blocked = await prisma.$transaction(async (tx) => {
        const owned = await tx.workflowRun.updateMany({
          where: { id: runId, userId, leaseOwner: workerId, status: "running" },
          data: {
            status: "blocked",
            error: toInputJson(error),
            completedAt: blockedAt,
            heartbeatAt: blockedAt,
            activeDedupeKey: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            updatedAt: blockedAt,
          },
        });
        if (!owned.count) return false;
        for (const blocker of schedule.blocked) await tx.workflowStep.updateMany({
          where: { runId, stepKey: blocker.stepKey, status: { in: ["pending", "ready"] } },
          data: {
            status: "blocked",
            error: toInputJson({ code: "WORKFLOW_DEPENDENCY_BLOCKED", blockedSteps: [blocker] }),
            updatedAt: blockedAt,
          },
        });
        return true;
      });
      if (blocked) await prisma.workflowEvent.create({
        data: {
          runId,
          type: "blocked",
          status: "blocked",
          message: error.message,
          payload: error,
        },
      });
      if (blocked && schedule.blocked.length) await Promise.all(schedule.blocked.map((blocker) => {
        const blockedStep = run.steps.find((item) => item.stepKey === blocker.stepKey);
        return prisma.workflowEvent.create({
          data: {
            runId,
            stepId: blockedStep?.id,
            type: "blocked",
            status: "blocked",
            message: `步骤 ${blocker.stepKey} 等待前置步骤：${blocker.waitingOn.map((dependency) => `${dependency.stepKey}（${dependency.status}）`).join("、")}`,
            payload: toInputJson(blocker),
          },
        });
      }));
      return "done";
    }

    const manualGate = schedule.runnable.find((candidate) => candidate.stepType === "manual_gate");
    if (manualGate) {
      const pausedAt = new Date();
      await prisma.workflowRun.updateMany({
        where: { id: runId, userId, leaseOwner: workerId, status: "running" },
        data: { status: "paused", heartbeatAt: pausedAt, updatedAt: pausedAt },
      });
      await prisma.workflowEvent.create({
        data: {
          runId,
          stepId: run.steps.find((item) => item.stepKey === manualGate.stepKey)?.id,
          type: "manual_gate",
          status: "paused",
          message: "Workflow is waiting for an explicit resume.",
        },
      });
      await notifyWorkflowActionRequired({ userId, runId, stepKey: manualGate.stepKey });
      return "done";
    }

    await runWorkflowStepWave(run.steps.map((item) => ({
      stepKey: item.stepKey,
      stepIndex: item.stepIndex,
      stepType: item.stepType,
      status: item.status,
      dependsOn: item.dependsOn,
    })), concurrency, (candidate) =>
      processClaimedWorkflowJob(runId, userId, workerId, {
        stepKey: candidate.stepKey,
        deferRunSettlement: true,
      }),
    );

    const settled = await prisma.workflowRun.findFirst({
      where: { id: runId, userId },
      include: { steps: { orderBy: { stepIndex: "asc" } } },
    });
    if (!settled || settled.leaseOwner !== workerId || settled.status !== "running") return "done";

    const failedStep = settled.steps.find((item) => ["failed", "blocked"].includes(item.status));
    if (failedStep) {
      const failure = failedStep.error && typeof failedStep.error === "object"
        ? failedStep.error as Record<string, unknown>
        : { code: "WORKFLOW_STEP_FAILED", message: `步骤 ${failedStep.stepKey} 失败` };
      const failureBlockers = resolveFailedDependencyBlockers(settled.steps.map((item) => ({
        stepKey: item.stepKey,
        stepIndex: item.stepIndex,
        status: item.status,
        dependsOn: item.dependsOn,
      })));
      const runFailure = { ...failure, failedStepKey: failedStep.stepKey, blockedSteps: failureBlockers };
      const failedAt = new Date();
      const failed = await prisma.$transaction(async (tx) => {
        const owned = await tx.workflowRun.updateMany({
          where: { id: runId, userId, leaseOwner: workerId, status: "running" },
          data: {
            status: "failed",
            error: toInputJson(runFailure),
            completedAt: failedAt,
            heartbeatAt: failedAt,
            activeDedupeKey: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            updatedAt: failedAt,
          },
        });
        if (!owned.count) return false;
        for (const blocker of failureBlockers) await tx.workflowStep.updateMany({
          where: { runId, stepKey: blocker.stepKey, status: { in: ["pending", "ready"] } },
          data: {
            status: "blocked",
            error: toInputJson({ code: "WORKFLOW_DEPENDENCY_BLOCKED", blockedSteps: [blocker] }),
            updatedAt: failedAt,
          },
        });
        return true;
      });
      if (failed) await prisma.workflowEvent.create({
        data: {
          runId,
          stepId: failedStep.id,
          type: "failed",
          status: "failed",
          message: typeof failure.message === "string" ? failure.message : "工作流步骤失败",
          payload: toInputJson(runFailure),
        },
      });
      if (failed) await notifyWorkflowTerminal({ userId, runId, status: "failed" });
      if (failed && failureBlockers.length) await Promise.all(failureBlockers.map((blocker) => {
        const blockedStep = settled.steps.find((item) => item.stepKey === blocker.stepKey);
        return prisma.workflowEvent.create({
          data: {
            runId,
            stepId: blockedStep?.id,
            type: "blocked",
            status: "blocked",
            message: `步骤 ${blocker.stepKey} 等待的前置步骤未完成。`,
            payload: toInputJson(blocker),
          },
        });
      }));
      return "done";
    }

    if (settled.steps.every((item) => item.status === "succeeded")) {
      const lastStep = settled.steps.at(-1);
      await finishRun(runId, userId, workerId, lastStep?.output ?? {});
      return "done";
    }

    const queuedAt = new Date();
    const queued = await prisma.workflowRun.updateMany({
      where: { id: runId, userId, leaseOwner: workerId, status: "running" },
      data: { status: "queued", heartbeatAt: queuedAt, updatedAt: queuedAt },
    });
    return queued.count ? "requeue" : "done";
  }

  const step = options.stepKey
    ? run.steps.find((item) => item.stepKey === options.stepKey && ["pending", "ready"].includes(item.status))
    : findRunnableStep(run.steps);
  if (!step && run.steps.every((item) => item.status === "succeeded")) {
    await finishRun(runId, userId, workerId, {});
    return "done";
  }
  if (!step) {
    await prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: "blocked",
        error: {
          code: "WORKFLOW_DEPENDENCY_BLOCKED",
          message: "没有可执行的工作流步骤",
        },
        completedAt: new Date(),
        heartbeatAt: new Date(),
        activeDedupeKey: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      },
    });
    await prisma.workflowEvent.create({
      data: {
        runId,
        type: "blocked",
        status: "blocked",
        message: "没有可执行的工作流步骤，请检查前置步骤状态。",
      },
    });
    await notifyWorkflowActionRequired({ userId, runId, stepKey: "workflow_dependency_blocked" });
    return "done";
  }
  if (step.stepType === "manual_gate") {
    await prisma.workflowRun.updateMany({
      where: { id: runId, leaseOwner: workerId },
      data: {
        status: "paused",
        heartbeatAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.workflowEvent.create({
      data: {
        runId,
        stepId: step.id,
        type: "manual_gate",
        status: "paused",
        message: "Workflow is waiting for an explicit resume.",
      },
    });
    await notifyWorkflowActionRequired({ userId, runId, stepKey: step.stepKey });
    return "done";
  }
  const attemptNumber = step.attempt + 1;
  const attemptInput = {
    run: run.input ?? null,
    step: step.input ?? null,
  };
  const executionInput = mergedStepInput(run.input, step.input);
  const attemptStartedAt = new Date();
  let workflowAttemptId = "";
  try {
    await prisma.$transaction(async (tx) => {
      const owned = await tx.workflowRun.updateMany({
        where: {
          id: runId,
          userId,
          leaseOwner: workerId,
          status: "running",
          leaseExpiresAt: { gt: attemptStartedAt },
        },
        data: { heartbeatAt: attemptStartedAt, updatedAt: attemptStartedAt },
      });
      if (!owned.count) throw new WorkflowControlError("lease_lost", runId);
      const claimed = await tx.workflowStep.updateMany({
        where: { id: step.id, runId, status: { in: ["pending", "ready"] } },
        data: {
          status: "running",
          attempt: attemptNumber,
          startedAt: step.startedAt ?? attemptStartedAt,
          completedAt: null,
          updatedAt: attemptStartedAt,
        },
      });
      if (!claimed.count) throw new WorkflowControlError("lease_lost", runId);
      const attempt = await tx.workflowStepAttempt.create({
        data: {
          runId,
          stepId: step.id,
          attempt: attemptNumber,
          status: "running",
          provider: getString(executionInput.channelId),
          modelKey: getString(executionInput.model),
          inputHash: hashJson(attemptInput),
          input: attemptInput,
          startedAt: attemptStartedAt,
        },
        select: { id: true },
      });
      workflowAttemptId = attempt?.id ?? "";
    });
  } catch (error) {
    if (error instanceof WorkflowControlError) return "done";
    throw error;
  }
  await prisma.workflowEvent.create({
    data: { runId, stepId: step.id, type: "step_running", status: "running" },
  });
  try {
    await assertWorkflowRunActive({ runId, workerId });
    const savedConfiguration = configurationSnapshotSchema.safeParse(isRecord(run.input) ? run.input.productionConfiguration : undefined);
    if (!savedConfiguration.success && isRecord(run.input) && "productionConfiguration" in run.input)
      throw new Error("WORKFLOW_CONFIGURATION_SNAPSHOT_INVALID");
    const productionConfiguration = savedConfiguration.success ? savedConfiguration.data
      : await resolveProductionConfiguration(userId, { projectId: run.projectId, episodeId: run.episodeId ?? undefined });
    if (!savedConfiguration.success) {
      const frozenInput = {
        ...(isRecord(run.input) ? run.input : {}),
        concurrency:
          getNumber(isRecord(run.input) ? run.input.concurrency : undefined) ??
          productionConfiguration.workflow.concurrency,
        productionConfiguration,
      };
      const frozen = await prisma.workflowRun.updateMany({ where: { id: runId, leaseOwner: workerId }, data: { input: toInputJson(frozenInput) } });
      if (!frozen.count) throw new WorkflowControlError("lease_lost", runId);
      run.input = toInputJson(frozenInput) as Prisma.JsonValue;
    }
    const output = await withModelBilling({ userId, projectId: run.projectId, episodeId: run.episodeId ?? undefined,
      sourceType: "workflow_step_attempt", sourceId: workflowAttemptId }, () =>
      withProductionConfiguration(userId, productionConfiguration, () => runStep(userId, run, step, {
      attempt: attemptNumber,
      reusePreviousResults: shouldReusePreviousResults(run.events, step.stepKey),
      assertActive: () => assertWorkflowRunActive({ runId, workerId }),
      persistArtifact: (artifactType, refId, payload) =>
        persistIncrementalArtifact({
          runId,
          stepId: step.id,
          workerId,
          artifactType,
          refId,
          payload,
        }),
      loadArtifact: (artifactType, refId) =>
        loadIncrementalArtifact({
          runId,
          stepId: step.id,
          artifactType,
          refId,
        }),
      loadRunArtifact: (artifactType, refId) =>
        loadRunArtifact({ runId, artifactType, refId }),
      recordRequest: async (request) => {
        await prisma.workflowEvent.create({
          data: {
            runId,
            stepId: step.id,
            type: `request_${request.status}`,
            status: request.status,
            message: `${request.requestType}${request.targetId ? ` · ${request.targetId}` : ""}`,
            payload: toInputJson(request),
          },
        });
      },
      reportProgress: async message => { await prisma.workflowEvent.create({ data: {
        runId, stepId: step.id, type: "progress", status: "running", message,
      } }); },
    })));
    await assertWorkflowRunActive({ runId, workerId });
    const outputJson = toInputJson(output);
    const outputText = JSON.stringify(output);
    const promptTracePayload = getPromptTracePayload(output);
    const completedAt = new Date();
    await prisma.$transaction(async (tx) => {
      const owned = await tx.workflowRun.updateMany({
        where: {
          id: runId,
          leaseOwner: workerId,
          status: "running",
          leaseExpiresAt: { gt: completedAt },
        },
        data: { heartbeatAt: completedAt, updatedAt: completedAt },
      });
      if (!owned.count) throw new WorkflowControlError("lease_lost", runId);
      await tx.workflowStep.update({
        where: { id: step.id },
        data: {
          status: "succeeded",
          output: outputJson,
          completedAt,
          updatedAt: completedAt,
        },
      });
      await tx.workflowStepAttempt.updateMany({
        where: { stepId: step.id, attempt: attemptNumber },
        data: {
          status: "succeeded",
          outputText,
          usageJson: promptTracePayload,
          finishedAt: completedAt,
          updatedAt: completedAt,
        },
      });
      await tx.workflowCheckpoint.create({
        data: {
          runId,
          stepKey: step.stepKey,
          version: attemptNumber,
          stateJson: outputJson,
          stateBytes: Buffer.byteLength(outputText, "utf8"),
        },
      });
      const artifactTypes = parseStringArray(step.artifactTypes);
      if (artifactTypes.length) {
        const persisted = await tx.workflowArtifact.findMany({
          where: { runId, stepId: step.id, artifactType: { in: artifactTypes } },
          select: { artifactType: true },
        });
        const summaries = completionArtifactTypes(artifactTypes, persisted, Boolean(promptTracePayload));
        if (summaries.length) await tx.workflowArtifact.createMany({
          data: summaries.map((artifactType) => ({
            id: `${run.id}_${step.id}_${artifactType}`
              .replace(/[^a-zA-Z0-9_-]/g, "_")
              .slice(0, 190),
            runId,
            stepId: step.id,
            artifactType,
            payload: getStepArtifactPayload({
              output,
              outputJson,
              artifactType,
              promptTracePayload,
            }),
          })),
          skipDuplicates: true,
        });
      }
    });
    await prisma.workflowEvent.create({
      data: {
        runId,
        stepId: step.id,
        type: "step_succeeded",
        status: "succeeded",
        payload: outputJson,
      },
    });
    await assertWorkflowRunActive({ runId, workerId });
    if (options.deferRunSettlement) return "done";
    const remaining = run.steps.some(
      (item) => item.id !== step.id && item.status !== "succeeded",
    );
    if (remaining) {
      await prisma.workflowRun.updateMany({
        where: { id: runId, leaseOwner: workerId, status: "running" },
        data: {
          status: "queued",
          heartbeatAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return "requeue";
    } else {
      await finishRun(runId, userId, workerId, output);
      return "done";
    }
  } catch (error) {
    if (error instanceof WorkflowControlError) {
      await settleWorkflowControl(
        runId,
        workerId,
        step.id,
        attemptNumber,
        error,
      );
      return "done";
    }
    try {
      await assertWorkflowRunActive({ runId, workerId });
    } catch (control) {
      if (control instanceof WorkflowControlError) {
        await settleWorkflowControl(
          runId,
          workerId,
          step.id,
          attemptNumber,
          control,
        );
        return "done";
      }
      throw control;
    }
    const failureMessage =
      error instanceof Error ? error.message : String(error);
    const retryExhausted = attemptNumber >= step.maxAttempts;
    const failure = {
      code: classifyWorkflowFailureCode(failureMessage),
      message: failureMessage,
      attempt: attemptNumber,
      maxAttempts: step.maxAttempts,
      retryable: step.retryable && !retryExhausted,
      retryExhausted,
    };
    const failedAt = new Date();
    const failed = await prisma.$transaction(async (tx) => {
      if (!options.deferRunSettlement) {
        const owned = await tx.workflowRun.updateMany({
          where: { id: runId, leaseOwner: workerId, status: "running" },
          data: {
            status: "failed",
            error: failure,
            heartbeatAt: failedAt,
            completedAt: failedAt,
            activeDedupeKey: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            updatedAt: failedAt,
          },
        });
        if (!owned.count) return false;
      } else {
        const owned = await tx.workflowRun.count({
          where: { id: runId, leaseOwner: workerId, status: "running" },
        });
        if (!owned) return false;
      }
      await tx.workflowStep.update({
        where: { id: step.id },
        data: {
          status: "failed",
          error: failure,
          completedAt: failedAt,
          updatedAt: failedAt,
        },
      });
      await tx.workflowStepAttempt.updateMany({
        where: { stepId: step.id, attempt: attemptNumber },
        data: {
          status: "failed",
          errorCode: failure.code,
          errorMessage: failure.message,
          ...(getFailedPromptTrace(error) ? { usageJson: { promptTraces: [getFailedPromptTrace(error)!] } } : {}),
          finishedAt: failedAt,
          updatedAt: failedAt,
        },
      });
      return true;
    });
    if (!failed) return "done";
    await prisma.workflowEvent.create({
      data: {
        runId,
        stepId: step.id,
        type: "failed",
        status: "failed",
        message: failure.message,
        payload: failure,
      },
    });
    if (!options.deferRunSettlement) await notifyWorkflowTerminal({ userId, runId, status: "failed" });
    return "done";
  }
}

/** Incremental content already represents these types; a step summary is not another chunk or trace. */
export function completionArtifactTypes(
  declared: string[], persisted: Array<{ artifactType: string }>, hasPromptTrace: boolean,
) {
  const existing = new Set(persisted.map(artifact => artifact.artifactType));
  return declared.filter(type => !existing.has(type) && (type !== "prompt.trace" || hasPromptTrace));
}

export function classifyWorkflowFailureCode(message: string) {
  const category = classifyProviderFailure(message);
  if (category) {
    return {
      authentication: "PROVIDER_AUTHENTICATION",
      content_rejected: "PROVIDER_CONTENT_REJECTED",
      invalid_parameters: "PROVIDER_INVALID_PARAMETERS",
      network: "PROVIDER_TRANSPORT_ERROR",
      output_validation: "OUTPUT_VALIDATION_FAILED",
      quota: "PROVIDER_QUOTA",
      rate_limit: "PROVIDER_RATE_LIMIT",
      timeout: "PROVIDER_TIMEOUT",
      provider_unavailable: "PROVIDER_UNAVAILABLE",
    }[category];
  }
  return "WORKFLOW_STEP_FAILED";
}

async function runStep(
  userId: string,
  run: {
    id: string;
    projectId: string;
    workflowType: string;
    episodeId: string | null;
    input: Prisma.JsonValue | null;
  },
  step: { stepType: string; input: Prisma.JsonValue | null },
  runtime: {
    reportProgress?: (message: string) => Promise<void>;
    attempt: number;
    reusePreviousResults: boolean;
    assertActive: () => Promise<void>;
    persistArtifact: (
      artifactType: string,
      refId: string,
      payload: unknown,
    ) => Promise<void>;
    loadArtifact: (
      artifactType: string,
      refId: string,
    ) => Promise<unknown | null>;
    loadRunArtifact: (
      artifactType: string,
      refId: string,
    ) => Promise<unknown | null>;
    recordRequest?: (request: WorkflowRequestUpdate) => Promise<void>;
  },
) {
  if (step.stepType === "generate_original_episode") {
    const input = mergedStepInput(run.input, step.input);
    const channelId = getString(input.channelId), model = getString(input.model);
    if (!run.episodeId || !channelId || !model) throw new Error("WORKFLOW_ORIGINAL_EPISODE_INPUT_REQUIRED");
    return generateOriginalEpisode({ userId, projectId: run.projectId, episodeId: run.episodeId,
      channelId, model, locale: getString(input.locale) === "en" ? "en" : "zh",
      workflowId: run.id, instructions: getString(input.instructions) }, runtime);
  }
  if (step.stepType === "analyze_manuscript") {
    const input = mergedStepInput(run.input, step.input);
    const manuscriptId = getString(input.manuscriptId), sourceHash = getString(input.sourceHash);
    const channelId = getString(input.channelId), model = getString(input.model);
    if (!manuscriptId || !sourceHash || !channelId || !model) throw new Error("WORKFLOW_MANUSCRIPT_INPUT_REQUIRED");
    return analyzeManuscript({ userId, projectId: run.projectId, manuscriptId, sourceHash,
      channelId, model, locale: getString(input.locale) === "en" ? "en" : "zh" }, runtime);
  }
  if (step.stepType === "design_asset_visual") {
    const input = mergedStepInput(run.input, step.input);
    const channelId = getString(input.channelId);
    const model = getString(input.model);
    const targetId = getString(input.targetId);
    const targetType = getString(input.targetType);
    if (
      !channelId ||
      !model ||
      !targetId ||
      !isVisualDesignTargetType(targetType)
    )
      throw new Error("WORKFLOW_ASSET_VISUAL_DESIGN_INPUT_REQUIRED");
    const result = await generateProjectAssetVisualProfile({
      userId,
      projectId: run.projectId,
      channelId,
      model,
      targetId,
      targetType,
      completeMissing: input.completeMissing === true,
      locale: getString(input.locale) === "en" ? "en" : "zh",
    });
    await runtime.persistArtifact("asset.visual-profile", targetId, result);
    if (result.profile.promptTrace)
      await runtime.persistArtifact(
        "prompt.trace",
        targetId,
        result.profile.promptTrace,
      );
    return {
      ...result,
      promptTraces: result.profile.promptTrace
        ? [result.profile.promptTrace]
        : [],
    };
  }
  if (step.stepType === "extract_visual_assets") {
    const input = mergedStepInput(run.input, step.input);
    const channelId = getString(input.channelId);
    const model = getString(input.model);
    const assetIds = parseStringArray(input.assetIds ?? null);
    if (!channelId || !model || !assetIds.length)
      throw new Error("WORKFLOW_VISUAL_EXTRACTION_INPUT_REQUIRED");
    const result = await extractProjectVisualAssets({
      userId,
      projectId: run.projectId,
      assetIds,
      channelId,
      model,
      kindHint: getString(input.kindHint),
      locale: getString(input.locale) === "en" ? "en" : "zh",
      persist: input.persist === true,
    });
    const targetId = assetIds.join(":");
    await runtime.persistArtifact("asset.visual-extraction", targetId, result);
    await runtime.persistArtifact("asset.visual-extraction.raw", targetId, {
      rawOutput: result.trace.rawOutput,
    });
    await runtime.persistArtifact("prompt.trace", targetId, result.trace);
    return { ...result, promptTraces: [result.trace] };
  }
  if (step.stepType === "extract_character_reference") {
    const input = mergedStepInput(run.input, step.input);
    const channelId = getString(input.channelId);
    const model = getString(input.model);
    const characterId = getString(input.characterId);
    const appearanceId = getString(input.appearanceId);
    const assetIds = parseStringArray(input.assetIds ?? null);
    if (!channelId || !model || !characterId || !assetIds.length)
      throw new Error("WORKFLOW_CHARACTER_REFERENCE_INPUT_REQUIRED");
    const result = await extractCharacterReferenceDescription({
      userId,
      projectId: run.projectId,
      assetIds,
      channelId,
      model,
      characterId,
      appearanceId,
      locale: getString(input.locale) === "en" ? "en" : "zh",
    });
    const targetId = appearanceId ?? characterId;
    await runtime.persistArtifact(
      "asset.character-reference",
      targetId,
      result,
    );
    await runtime.persistArtifact("asset.character-reference.raw", targetId, {
      rawOutput: result.trace.rawOutput,
    });
    await runtime.persistArtifact("prompt.trace", targetId, result.trace);
    return { ...result, promptTraces: [result.trace] };
  }
  if (step.stepType === "review_storyboard_video") {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const input = mergedStepInput(run.input, step.input);
    const channelId = getString(input.channelId), model = getString(input.model), panelId = getString(input.panelId);
    if (!channelId || !model || !panelId) throw new Error("WORKFLOW_VIDEO_REVIEW_INPUT_REQUIRED");
    const result = await reviewStoryboardVideo({ userId, projectId: run.projectId, episodeId: run.episodeId,
      panelId, channelId, model, locale: getString(input.locale) === "en" ? "en" : "zh",
      capturedContext: input.capturedContext as StoryboardPromptContext | undefined });
    await runtime.persistArtifact("storyboard.video-review", panelId, result);
    await runtime.persistArtifact("prompt.trace", panelId, result.trace);
    return { ...result, promptTraces: [result.trace] };
  }
  if (step.stepType === "design_storyboard_media_prompt") {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const input = mergedStepInput(run.input, step.input);
    const channelId = getString(input.channelId);
    const model = getString(input.model);
    const panelId = getString(input.panelId);
    const kind = getString(input.kind);
    const mode = getString(input.mode);
    if (
      !channelId ||
      !model ||
      !panelId ||
      !["image", "video"].includes(kind ?? "")
    )
      throw new Error("WORKFLOW_STORYBOARD_PROMPT_DESIGN_INPUT_REQUIRED");
    const result = await designStoryboardMediaPrompt({
      userId,
      projectId: run.projectId,
      episodeId: run.episodeId,
      panelId,
      channelId,
      model,
      kind: kind as "image" | "video",
      capturedContext: input.capturedContext as StoryboardPromptContext | undefined,
      mode: mode === "first-last" ? "first-last" : "reference",
      currentPrompt: getString(input.currentPrompt),
      locale: getString(input.locale) === "en" ? "en" : "zh",
    });
    await runtime.persistArtifact(
      "storyboard.prompt-design",
      panelId,
      result.design,
    );
    await runtime.persistArtifact("storyboard.prompt-design.raw", panelId, {
      rawOutput: result.rawOutput,
    });
    await runtime.persistArtifact("prompt.trace", panelId, {
      ...result.trace,
      rawOutput: result.rawOutput,
    });
    return {
      ...result,
      promptTraces: [{ ...result.trace, rawOutput: result.rawOutput }],
    };
  }
  if (step.stepType === "adapt_episode") {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const input = mergedStepInput(run.input, step.input);
    const channelId = getString(input.channelId);
    const model = getString(input.model);
    const mode = getString(input.mode);
    if (
      !channelId ||
      !model ||
      !["faithful", "polish", "drama", "custom"].includes(mode ?? "")
    )
      throw new Error("WORKFLOW_ADAPTATION_INPUT_REQUIRED");
    const source = await adaptEpisodeSource({
      userId,
      projectId: run.projectId,
      episodeId: run.episodeId,
      channelId,
      model,
      mode: mode as "faithful" | "polish" | "drama" | "custom",
      instructions: getString(input.instructions),
      locale: getString(input.locale) === "en" ? "en" : "zh",
      hooks: runtime,
    });
    await runtime.persistArtifact("adaptation.source", source.id, { source });
    if (source.promptTrace)
      await runtime.persistArtifact(
        "prompt.trace",
        source.id,
        source.promptTrace,
      );
    return {
      source,
      promptTraces: source.promptTrace ? [source.promptTrace] : [],
    };
  }
  if (step.stepType === "plan_episode_split") {
    const input = mergedStepInput(run.input, step.input);
    const channelId = getString(input.channelId);
    const model = getString(input.model);
    const manuscriptId = getString(input.manuscriptId);
    if (!channelId || !model || !manuscriptId)
      throw new Error("WORKFLOW_EPISODE_SPLIT_INPUT_REQUIRED");
    const manuscript = await prisma.manuscript.findFirst({
      where: {
        id: manuscriptId,
        projectId: run.projectId,
        project: { userId },
      },
      select: { id: true, sourceText: true },
    });
    if (!manuscript) throw new Error("WORKFLOW_MANUSCRIPT_NOT_FOUND");
    const result = await splitEpisodesWithAi({
      userId,
      projectId: run.projectId,
      content: manuscript.sourceText,
      channelId,
      model,
      locale: getString(input.locale) === "en" ? "en" : "zh",
      hooks: runtime,
    });
    const episodes = result.episodes.map((episode) => ({
      ...episode,
      content: "",
    }));
    await runtime.persistArtifact("episode.split-plan", manuscript.id, {
      episodes,
    });
    await runtime.persistArtifact("episode.split-plan.raw", manuscript.id, {
      rawOutput: result.trace.rawOutput,
    });
    await runtime.persistArtifact("prompt.trace", manuscript.id, result.trace);
    return {
      episodes,
      trace: result.trace,
      promptTraces: [result.trace],
    };
  }
  if (step.stepType === "parse_novel") {
    const runInput = isRecord(run.input) ? run.input : {};
    const stepInput = isRecord(step.input) ? step.input : {};
    const input = {
      ...runInput,
      ...stepInput,
      projectId: run.projectId,
      ...(run.episodeId ? { episodeId: run.episodeId } : {}),
    } as Record<string, Prisma.JsonValue>;
    const episodeId = getString(input.episodeId);
    const channelId = getString(input.channelId);
    const model = getString(input.model);
    if (!episodeId || !channelId || !model)
      throw new Error("WORKFLOW_PARSE_INPUT_REQUIRED");
    return parseNovelAndPersist(
      userId,
      {
        projectId: run.projectId,
        episodeId,
        channelId,
        model,
        sourceText: getString(input.sourceText) || undefined,
        locale: getString(input.locale) === "en" ? "en" : "zh",
      } satisfies NovelParseInput,
      runtime,
    );
  }
  if (step.stepType === "split_clips") {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const input = mergedStepInput(run.input, step.input);
    const channelId = getString(input.channelId);
    const model = getString(input.model);
    if (!channelId || !model)
      throw new Error("WORKFLOW_SPLIT_CLIPS_INPUT_REQUIRED");
    return splitEpisodeIntoClips(
      userId,
      {
        projectId: run.projectId,
        episodeId: run.episodeId,
        channelId,
        model,
        locale: getString(input.locale) === "en" ? "en" : "zh",
        sourceText: getString(input.sourceText),
        resumeExisting: runtime.reusePreviousResults && runtime.attempt > 1,
      },
      runtime,
    );
  }
  if (
    [
      "generate_screenplay_beats",
      "generate_screenplay_dialogue",
      "generate_screenplay_narration",
      "generate_screenplay_effects",
      "assemble_screenplay",
    ].includes(step.stepType)
  ) {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const input = mergedStepInput(run.input, step.input);
    const channelId = getString(input.channelId);
    const model = getString(input.model);
    if (!channelId || !model)
      throw new Error("WORKFLOW_SCREENPLAY_INPUT_REQUIRED");
    const stageInput = {
      projectId: run.projectId,
      episodeId: run.episodeId,
      channelId,
      model,
      locale:
        getString(input.locale) === "en" ? ("en" as const) : ("zh" as const),
      concurrency: getNumber(input.concurrency),
      resumeExisting: runtime.reusePreviousResults && runtime.attempt > 1,
    };
    if (step.stepType === "generate_screenplay_beats")
      return generateEpisodeScreenplayBeats(userId, stageInput, runtime);
    if (step.stepType === "generate_screenplay_dialogue")
      return generateEpisodeScreenplayDialogue(userId, stageInput, runtime);
    if (step.stepType === "generate_screenplay_narration")
      return generateEpisodeScreenplayNarration(userId, stageInput, runtime);
    if (step.stepType === "generate_screenplay_effects")
      return generateEpisodeScreenplayEffects(userId, stageInput, runtime);
    return assembleEpisodeScreenplays(userId, stageInput, runtime);
  }
  if (step.stepType === "build_scene_storyboard") {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const input = mergedStepInput(run.input, step.input);
    return buildEpisodeStoryboard(
      userId,
      {
        projectId: run.projectId,
        episodeId: run.episodeId,
        locale: getString(input.locale) === "en" ? "en" : "zh",
        channelId: getString(input.channelId),
        model: getString(input.model),
      },
      runtime,
    );
  }
  if (step.stepType === "organize_production_script") {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const input = mergedStepInput(run.input, step.input);
    return organizeEpisodeProductionScript(
      userId,
      {
        projectId: run.projectId,
        episodeId: run.episodeId,
        sourceText: getString(input.sourceText),
        channelId: getString(input.channelId) ?? "",
        model: getString(input.model) ?? "",
        locale: getString(input.locale) === "en" ? "en" : "zh",
      },
      runtime,
    );
  }
  if (step.stepType === "analyze_episode_voice") {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const input = mergedStepInput(run.input, step.input);
    const channelId = getString(input.channelId);
    const model = getString(input.model);
    if (!channelId || !model)
      throw new Error("WORKFLOW_VOICE_ANALYSIS_INPUT_REQUIRED");
    const result = await analyzeEpisodeVoices({
      userId,
      projectId: run.projectId,
      episodeId: run.episodeId,
      channelId,
      model,
      locale: getString(input.locale) === "en" ? "en" : "zh",
    });
    await runtime.assertActive();
    await runtime.persistArtifact("voice.analysis", run.episodeId, {
      voiceLines: result.voiceLines,
    });
    for (const trace of result.promptTraces)
      await runtime.persistArtifact("prompt.trace", run.episodeId, trace);
    return result;
  }
  if (step.stepType === "design_voice_performance") {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const storyboard = await prisma.storyboard.findUnique({
      where: { episodeId: run.episodeId },
      select: { status: true },
    });
    if (storyboard?.status === "director_review_required")
      throw new Error("请先在分镜工作台确认导演审核，再恢复配音设计任务");
    if (run.workflowType === "episode-preproduction" && !(await prisma.voiceLine.count({ where: { episodeId: run.episodeId } }))) {
      await runtime.persistArtifact("voice.performance-design", run.episodeId, { voiceLines: [], skipped: true, reason: "本集没有需要配音的台词" });
      return { voiceLines: [], skipped: true };
    }
    const input = mergedStepInput(run.input, step.input);
    const channelId = getString(input.channelId);
    const model = getString(input.model);
    if (!channelId || !model)
      throw new Error("WORKFLOW_VOICE_DESIGN_INPUT_REQUIRED");
    const result = await designEpisodeVoicePerformance({
      userId,
      projectId: run.projectId,
      episodeId: run.episodeId,
      channelId,
      model,
      locale: getString(input.locale) === "en" ? "en" : "zh",
      fillMissing: input.fillMissingVoiceDesign === true,
    });
    await runtime.persistArtifact("voice.performance-design", run.episodeId, {
      voiceLines: result.voiceLines,
    });
    await runtime.persistArtifact(
      "voice.performance-design.raw",
      run.episodeId,
      { rawOutput: result.promptTrace.rawOutput },
    );
    await runtime.persistArtifact(
      "prompt.trace",
      run.episodeId,
      result.promptTrace,
    );
    return {
      ...result,
      promptTraces: [result.promptTrace],
    };
  }
  throw new Error(`WORKFLOW_STEP_HANDLER_NOT_IMPLEMENTED:${step.stepType}`);
}

async function failInterruptedWorkflowSteps(input: {
  runId: string;
  workerId: string;
  steps: Array<{
    id: string;
    stepKey: string;
    attempt: number;
    maxAttempts: number;
    retryable: boolean;
  }>;
}) {
  const failedAt = new Date();
  const failure = (step: typeof input.steps[number]) => ({
    code: "WORKFLOW_STEP_INTERRUPTED",
    message: `Worker 中断了正在执行的步骤 ${step.stepKey}，请从该步骤手动重试。`,
    attempt: step.attempt,
    maxAttempts: step.maxAttempts,
    retryable: step.retryable && step.attempt < step.maxAttempts,
    retryExhausted: step.attempt >= step.maxAttempts,
  });
  const failed = await prisma.$transaction(async (tx) => {
    const runFailure = {
      code: "WORKFLOW_STEP_INTERRUPTED",
      message: `Worker 中断了 ${input.steps.length} 个正在执行的步骤，请从失败步骤手动重试。`,
      interruptedSteps: input.steps.map((step) => step.stepKey),
    };
    const owned = await tx.workflowRun.updateMany({
      where: {
        id: input.runId,
        leaseOwner: input.workerId,
        status: "running",
      },
      data: {
        status: "failed",
        error: runFailure,
        heartbeatAt: failedAt,
        completedAt: failedAt,
        activeDedupeKey: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: failedAt,
      },
    });
    if (!owned.count) return false;
    await tx.workflowStep.updateMany({
      where: { runId: input.runId, status: "running" },
      data: {
        status: "failed",
        error: runFailure,
        completedAt: failedAt,
        updatedAt: failedAt,
      },
    });
    await tx.workflowStepAttempt.updateMany({
      where: { runId: input.runId, status: "running" },
      data: {
        status: "failed",
        errorCode: "WORKFLOW_STEP_INTERRUPTED",
        errorMessage: runFailure.message,
        finishedAt: failedAt,
        updatedAt: failedAt,
      },
    });
    return true;
  });
  if (failed) {
    for (const step of input.steps) await prisma.workflowEvent.create({
      data: {
        runId: input.runId,
        stepId: step.id,
        type: "failed",
        status: "failed",
        message: failure(step).message,
        payload: failure(step),
      },
    });
  }
}

function findRunnableStep<
  T extends {
    stepKey: string;
    status: string;
    stepIndex: number;
    dependsOn: Prisma.JsonValue | null;
  },
>(steps: T[]): T | undefined {
  return steps
    .slice()
    .sort((a, b) => a.stepIndex - b.stepIndex)
    .find((step) => {
      if (step.status !== "pending" && step.status !== "ready") return false;
      const dependencies = Array.isArray(step.dependsOn)
        ? step.dependsOn.filter(
            (item): item is string => typeof item === "string",
          )
        : [];
      if (!dependencies.length) return true;
      return dependencies.every((dependency) =>
        steps.some(
          (candidate) =>
            candidate.stepKey === dependency &&
            candidate.status === "succeeded",
        ),
      );
    });
}

function isRecord(value: unknown): value is Record<string, Prisma.JsonValue> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function shouldReusePreviousResults(
  events: Array<{ payload: Prisma.JsonValue | null }>,
  stepKey: string,
) {
  const retry = events.find((event) =>
    isRecord(event.payload) &&
    parseStringArray(event.payload.resetKeys ?? null).includes(stepKey),
  );
  return !retry || !isRecord(retry.payload) || retry.payload.retryMode !== "restart";
}
function getString(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" ? value : undefined;
}
function getNumber(value: Prisma.JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
function isVisualDesignTargetType(
  value: string | undefined,
): value is VisualDesignTargetType {
  return value === "character" || value === "location" || value === "prop";
}
function parseStringArray(value: Prisma.JsonValue | null) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toInputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function getFailedPromptTrace(error: unknown) {
  if (!(error instanceof Error) || !isRecord(error)) return null;
  const trace = error.executionTrace;
  return isUsageTrace(trace) ? trace : null;
}

function isUsageTrace(value: unknown): value is {
  promptId?: string;
  channelId?: string;
  model: string;
  tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
  characterUsage: { inputCharacters: number; outputCharacters: number; totalCharacters: number };
  requestCount: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const trace = value as Record<string, unknown>;
  const usage = trace.characterUsage;
  const tokens = trace.tokenUsage;
  return typeof trace.model === "string" &&
    typeof trace.requestCount === "number" && Number.isSafeInteger(trace.requestCount) &&
    !!usage && typeof usage === "object" && !Array.isArray(usage) &&
    Number.isSafeInteger((usage as Record<string, unknown>).inputCharacters) &&
    Number.isSafeInteger((usage as Record<string, unknown>).outputCharacters) &&
    (tokens === null || (!!tokens && typeof tokens === "object" && !Array.isArray(tokens)));
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function getPromptTracePayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const promptTraces = (value as { promptTraces?: unknown }).promptTraces;
  if (!Array.isArray(promptTraces)) return undefined;
  return toInputJson({ promptTraces });
}

function getStepArtifactPayload(input: {
  output: unknown;
  outputJson: Prisma.InputJsonValue;
  artifactType: string;
  promptTracePayload: Prisma.InputJsonValue | undefined;
}) {
  if (input.artifactType === "prompt.trace" && input.promptTracePayload)
    return input.promptTracePayload;
  if (!input.output || typeof input.output !== "object")
    return input.outputJson;
  const output = input.output as {
    analysis?: Record<string, unknown>;
    clips?: unknown;
    results?: unknown;
  };
  if (input.artifactType.startsWith("analysis.")) {
    const key = input.artifactType.slice("analysis.".length);
    const value = output.analysis?.[key];
    if (value !== undefined) return toInputJson({ [key]: value });
  }
  if (input.artifactType === "clips.split" && output.clips !== undefined)
    return toInputJson({ clips: output.clips });
  if (input.artifactType === "screenplay.clip" && output.results !== undefined)
    return toInputJson({ results: output.results });
  return input.outputJson;
}

function mergedStepInput(
  runInput: Prisma.JsonValue | null,
  stepInput: Prisma.JsonValue | null,
) {
  return {
    ...(isRecord(runInput) ? runInput : {}),
    ...(isRecord(stepInput) ? stepInput : {}),
  };
}

async function persistIncrementalArtifact(input: {
  runId: string;
  stepId: string;
  workerId: string;
  artifactType: string;
  refId: string;
  payload: unknown;
}) {
  const now = new Date();
  const payload = toInputJson(input.payload);
  const id = `workflow_artifact_${createHash("sha256")
    .update(
      `${input.runId}\u0000${input.stepId}\u0000${input.artifactType}\u0000${input.refId}`,
    )
    .digest("hex")}`;
  await prisma.$transaction(async (tx) => {
    const owned = await tx.workflowRun.updateMany({
      where: {
        id: input.runId,
        leaseOwner: input.workerId,
        status: "running",
        leaseExpiresAt: { gt: now },
      },
      data: { heartbeatAt: now, updatedAt: now },
    });
    if (!owned.count) throw new WorkflowControlError("lease_lost", input.runId);
    await tx.workflowArtifact.upsert({
      where: { id },
      create: {
        id,
        runId: input.runId,
        stepId: input.stepId,
        artifactType: input.artifactType,
        refId: input.refId,
        payload,
      },
      update: { payload },
    });
    await tx.workflowEvent.create({
      data: {
        runId: input.runId,
        stepId: input.stepId,
        type: "artifact_committed",
        status: "running",
        payload: toInputJson({
          artifactType: input.artifactType,
          refId: input.refId,
        }),
      },
    });
  });
}

async function loadIncrementalArtifact(input: {
  runId: string;
  stepId: string;
  artifactType: string;
  refId: string;
}) {
  const artifact = await prisma.workflowArtifact.findFirst({
    where: {
      runId: input.runId,
      stepId: input.stepId,
      artifactType: input.artifactType,
      refId: input.refId,
    },
    select: { payload: true },
  });
  return artifact?.payload ?? null;
}

async function loadRunArtifact(input: {
  runId: string;
  artifactType: string;
  refId: string;
}) {
  const artifact = await prisma.workflowArtifact.findFirst({
    where: {
      runId: input.runId,
      artifactType: input.artifactType,
      refId: input.refId,
    },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  return artifact?.payload ?? null;
}

async function finishRun(runId: string, userId: string, workerId: string, output: unknown) {
  const completedAt = new Date();
  const updated = await prisma.workflowRun.updateMany({
    where: { id: runId, leaseOwner: workerId, status: "running" },
    data: {
      status: "succeeded",
      output: output as Prisma.InputJsonValue,
      completedAt,
      heartbeatAt: completedAt,
      activeDedupeKey: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: completedAt,
    },
  });
  if (!updated.count) throw new WorkflowControlError("lease_lost", runId);
  await prisma.workflowEvent.create({
    data: { runId, type: "succeeded", status: "succeeded" },
  });
  await notifyWorkflowTerminal({ userId, runId, status: "succeeded" });
}

async function acknowledgeWorkflowCancel(runId: string, workerId: string) {
  const completedAt = new Date();
  const updated = await prisma.workflowRun.updateMany({
    where: { id: runId, leaseOwner: workerId, status: "canceling" },
    data: {
      status: "canceled",
      completedAt,
      heartbeatAt: completedAt,
      activeDedupeKey: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: completedAt,
    },
  });
  if (updated.count)
    await prisma.workflowEvent.create({
      data: { runId, type: "canceled", status: "canceled" },
    });
}

async function settleWorkflowControl(
  runId: string,
  workerId: string,
  stepId: string,
  attempt: number,
  control: WorkflowControlError,
) {
  if (control.reason === "lease_lost" || control.reason === "terminal") return;
  const now = new Date();
  if (control.reason === "canceled") {
    await prisma.$transaction(async (tx) => {
      const owned = await tx.workflowRun.updateMany({
        where: { id: runId, leaseOwner: workerId, status: "canceling" },
        data: {
          status: "canceled",
          completedAt: now,
          heartbeatAt: now,
          activeDedupeKey: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: now,
        },
      });
      if (!owned.count) return;
      await tx.workflowStep.updateMany({
        where: { id: stepId, status: "running" },
        data: { status: "paused", completedAt: now, updatedAt: now },
      });
      await tx.workflowStepAttempt.updateMany({
        where: { stepId, attempt, status: "running" },
        data: {
          status: "canceled",
          errorCode: "WORKFLOW_CANCELED",
          errorMessage: "工作流已取消。",
          finishedAt: now,
          updatedAt: now,
        },
      });
    });
    await prisma.workflowEvent.create({
      data: { runId, stepId, type: "canceled", status: "canceled" },
    });
    return;
  }
  await prisma.workflowStep.updateMany({
    where: { id: stepId, runId, status: "running" },
    data: { status: "pending", completedAt: null, updatedAt: now },
  });
  await prisma.workflowStepAttempt.updateMany({
    where: { stepId, attempt, status: "running" },
    data: {
      status: "paused",
      errorCode: "WORKFLOW_PAUSED",
      errorMessage: "工作流已暂停。",
      finishedAt: now,
      updatedAt: now,
    },
  });
}
