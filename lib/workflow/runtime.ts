import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import {
  parseNovelAndPersist,
  type NovelParseInput,
} from "@/lib/novel/parser-runtime";
import { prisma } from "@/lib/server/prisma";
import { saveProductionClips } from "@/lib/production/domain-store";
import { analyzeEpisodeVoices } from "@/lib/voice/analyze";
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
): Promise<"done" | "requeue"> {
  const run = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });
  if (!run) throw new Error("WORKFLOW_RUN_NOT_FOUND");
  if (run.status === "canceling") {
    await acknowledgeWorkflowCancel(runId, workerId);
    return "done";
  }
  if (["canceled", "paused", "succeeded"].includes(run.status)) return "done";
  const now = new Date();
  const started = await prisma.workflowRun.updateMany({
    where: { id: runId, leaseOwner: workerId },
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
  const step = findRunnableStep(run.steps);
  if (!step && run.steps.every((item) => item.status === "succeeded")) {
    await finishRun(runId, workerId, {});
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
    return "done";
  }
  const attemptNumber = step.attempt + 1;
  const attemptInput = {
    run: run.input ?? null,
    step: step.input ?? null,
  };
  const attemptStartedAt = new Date();
  await prisma.$transaction([
    prisma.workflowStep.update({
      where: { id: step.id },
      data: {
        status: "running",
        attempt: attemptNumber,
        startedAt: step.startedAt ?? attemptStartedAt,
        completedAt: null,
        updatedAt: attemptStartedAt,
      },
    }),
    prisma.workflowStepAttempt.create({
      data: {
        runId,
        stepId: step.id,
        attempt: attemptNumber,
        status: "running",
        inputHash: hashJson(attemptInput),
        input: attemptInput,
        startedAt: attemptStartedAt,
      },
    }),
  ]);
  await prisma.workflowEvent.create({
    data: { runId, stepId: step.id, type: "step_running", status: "running" },
  });
  try {
    await assertWorkflowRunActive({ runId, workerId });
    const output = await runStep(userId, run, step);
    await assertWorkflowRunActive({ runId, workerId });
    const outputJson = toInputJson(output);
    const outputText = JSON.stringify(output);
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
        await tx.workflowArtifact.createMany({
          data: artifactTypes.map((artifactType) => ({
            id: `${run.id}_${step.id}_${artifactType}`
              .replace(/[^a-zA-Z0-9_-]/g, "_")
              .slice(0, 190),
            runId,
            stepId: step.id,
            artifactType,
            payload: outputJson,
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
      await finishRun(runId, workerId, output);
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
    const failure = {
      code: "WORKFLOW_STEP_FAILED",
      message: error instanceof Error ? error.message : String(error),
    };
    const failedAt = new Date();
    const failed = await prisma.$transaction(async (tx) => {
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
    return "done";
  }
}

async function runStep(
  userId: string,
  run: {
    projectId: string;
    episodeId: string | null;
    input: Prisma.JsonValue | null;
  },
  step: { stepType: string; input: Prisma.JsonValue | null },
) {
  if (step.stepType === "parse_novel") {
    const runInput = isRecord(run.input) ? run.input : {};
    const stepInput = isRecord(step.input) ? step.input : {};
    const input = {
      ...runInput,
      ...stepInput,
      projectId: run.projectId,
      ...(run.episodeId ? { episodeId: run.episodeId } : {}),
    } as Record<string, Prisma.JsonValue>;
    if (
      !getString(input.episodeId) ||
      !getString(input.channelId) ||
      !getString(input.model)
    )
      throw new Error("WORKFLOW_PARSE_INPUT_REQUIRED");
    return parseNovelAndPersist(userId, input as unknown as NovelParseInput);
  }
  if (step.stepType === "split_clips") {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const storyboard = await prisma.storyboard.findFirst({
      where: {
        projectId: run.projectId,
        episodeId: run.episodeId,
        project: { userId },
      },
      include: { panels: { orderBy: { panelIndex: "asc" } } },
    });
    if (!storyboard) throw new Error("WORKFLOW_STORYBOARD_REQUIRED");
    const clipSize = 9;
    const clips = [];
    for (
      let offset = 0;
      offset < storyboard.panels.length;
      offset += clipSize
    ) {
      const panels = storyboard.panels.slice(offset, offset + clipSize);
      const first = panels[0];
      const last = panels[panels.length - 1];
      clips.push({
        clipIndex: clips.length,
        summary:
          panels
            .map((panel) => panel.description || "")
            .filter(Boolean)
            .join(" ")
            .slice(0, 300) || `片段 ${clips.length + 1}`,
        content: panels
          .map((panel) => panel.description || "")
          .filter(Boolean)
          .join("\n"),
        startText: first?.description,
        endText: last?.description,
        characters: uniqueStrings(
          panels.flatMap((panel) => parseArray(panel.charactersJson)),
        ),
        locations: uniqueStrings(
          panels.map((panel) => panel.locationName || ""),
        ),
        props: uniqueStrings(
          panels.flatMap((panel) => parseArray(panel.propsJson)),
        ),
        shotCount: panels.length,
        shots: panels.map((panel, index) => ({
          shotIndex: index,
          description: panel.description,
          locationName: panel.locationName,
          characters: parseArray(panel.charactersJson),
          props: parseArray(panel.propsJson),
          cameraMove: panel.cameraMove,
          imagePrompt: panel.imagePrompt,
          videoPrompt: panel.videoPrompt,
          srtStart: panel.srtStart,
          srtEnd: panel.srtEnd,
          durationSeconds: panel.durationSeconds,
        })),
      });
    }
    const result = await saveProductionClips(
      userId,
      run.projectId,
      run.episodeId,
      clips,
    );
    if (!result) throw new Error("WORKFLOW_CLIPS_PERSIST_FAILED");
    return { clipCount: result.length };
  }
  if (step.stepType === "convert_screenplay") {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const clips = await prisma.storyClip.findMany({
      where: { projectId: run.projectId, episodeId: run.episodeId },
      orderBy: { clipIndex: "asc" },
    });
    await prisma.$transaction(
      clips.map((clip) =>
        prisma.storyClip.update({
          where: { id: clip.id },
          data: {
            screenplay:
              clip.screenplay ||
              clip.content
                .split(/\n+/)
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => `场景：${line}`)
                .join("\n"),
            status: "screenplay_ready",
          },
        }),
      ),
    );
    return { clipCount: clips.length };
  }
  if (step.stepType === "build_storyboard") {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const storyboard = await prisma.storyboard.findFirst({
      where: {
        projectId: run.projectId,
        episodeId: run.episodeId,
        project: { userId },
      },
      select: { id: true, panels: { select: { id: true } } },
    });
    if (!storyboard) throw new Error("WORKFLOW_STORYBOARD_REQUIRED");
    await prisma.storyboard.update({
      where: { id: storyboard.id },
      data: { status: "ready" },
    });
    return { panelCount: storyboard.panels.length };
  }
  if (step.stepType === "voice_analyze") {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const runInput = isRecord(run.input) ? run.input : {};
    const stepInput = isRecord(step.input) ? step.input : {};
    const channelId = getString(stepInput.channelId ?? runInput.channelId);
    const model = getString(stepInput.model ?? runInput.model);
    if (!channelId || !model)
      throw new Error("WORKFLOW_VOICE_ANALYZE_INPUT_REQUIRED");
    const lines = await analyzeEpisodeVoices({
      userId,
      projectId: run.projectId,
      episodeId: run.episodeId,
      channelId,
      model,
    });
    return { lineCount: lines.length };
  }
  throw new Error(`WORKFLOW_STEP_HANDLER_NOT_IMPLEMENTED:${step.stepType}`);
}

function parseArray(value: string | null) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
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
function getString(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" ? value : undefined;
}
function parseStringArray(value: Prisma.JsonValue | null) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toInputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function finishRun(runId: string, workerId: string, output: unknown) {
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
