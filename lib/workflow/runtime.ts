import { Prisma } from "@prisma/client";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { parseNovelAndPersist, type NovelParseInput } from "@/lib/novel/parser-runtime";
import { prisma } from "@/lib/server/prisma";

export async function processWorkflowJob(runId: string, userId: string) {
  const run = await prisma.workflowRun.findFirst({
    where: { id: runId, userId },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });
  if (!run) throw new Error("WORKFLOW_RUN_NOT_FOUND");
  if (["canceled", "paused", "succeeded"].includes(run.status)) return;
  const now = new Date();
  await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status: "running",
      startedAt: run.startedAt ?? now,
      heartbeatAt: now,
      updatedAt: now,
    },
  });
  await prisma.workflowEvent.create({
    data: { runId, type: "running", status: "running" },
  });
  const step = run.steps.find((item) => item.status !== "succeeded");
  if (!step) {
    await finishRun(runId, {});
    return;
  }
  if (step.stepType === "manual_gate") {
    await prisma.workflowRun.update({
      where: { id: runId },
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
    return;
  }
  await prisma.workflowStep.update({ where: { id: step.id }, data: { status: "running", attempt: { increment: 1 }, startedAt: step.startedAt ?? new Date(), updatedAt: new Date() } });
  await prisma.workflowEvent.create({ data: { runId, stepId: step.id, type: "step_running", status: "running" } });
  try {
    const output = await runStep(userId, run, step);
    await prisma.workflowStep.update({ where: { id: step.id }, data: { status: "succeeded", output: output as Prisma.InputJsonValue, completedAt: new Date(), updatedAt: new Date() } });
    await prisma.workflowEvent.create({ data: { runId, stepId: step.id, type: "step_succeeded", status: "succeeded", payload: output as Prisma.InputJsonValue } });
    const remaining = run.steps.some((item) => item.id !== step.id && item.status !== "succeeded");
    if (remaining) {
      await prisma.workflowRun.update({ where: { id: runId }, data: { status: "queued", heartbeatAt: new Date(), updatedAt: new Date() } });
      await enqueueWorkflowJob({ runId, userId, projectId: run.projectId, maxAttempts: 1 });
    } else {
      await finishRun(runId, output);
    }
  } catch (error) {
    const failure = { code: "WORKFLOW_STEP_FAILED", message: error instanceof Error ? error.message : String(error) };
    await prisma.workflowStep.update({ where: { id: step.id }, data: { status: "failed", attempt: { increment: 1 }, error: failure, completedAt: new Date(), updatedAt: new Date() } });
    await prisma.workflowRun.update({ where: { id: runId }, data: { status: "failed", error: failure, heartbeatAt: new Date(), completedAt: new Date(), updatedAt: new Date() } });
    await prisma.workflowEvent.create({ data: { runId, stepId: step.id, type: "failed", status: "failed", message: failure.message, payload: failure } });
  }
}

async function runStep(userId: string, run: { projectId: string; episodeId: string | null; input: Prisma.JsonValue | null }, step: { stepType: string; input: Prisma.JsonValue | null }) {
  if (step.stepType === "parse_novel") {
    const runInput = isRecord(run.input) ? run.input : {};
    const stepInput = isRecord(step.input) ? step.input : {};
    const input = { ...runInput, ...stepInput, projectId: run.projectId, ...(run.episodeId ? { episodeId: run.episodeId } : {}) } as Record<string, Prisma.JsonValue>;
    if (!getString(input.episodeId) || !getString(input.channelId) || !getString(input.model)) throw new Error("WORKFLOW_PARSE_INPUT_REQUIRED");
    return parseNovelAndPersist(userId, input as unknown as NovelParseInput);
  }
  throw new Error(`WORKFLOW_STEP_HANDLER_NOT_IMPLEMENTED:${step.stepType}`);
}

function isRecord(value: unknown): value is Record<string, Prisma.JsonValue> { return !!value && typeof value === "object" && !Array.isArray(value); }
function getString(value: Prisma.JsonValue | undefined) { return typeof value === "string" ? value : undefined; }

async function finishRun(runId: string, output: unknown) {
  await prisma.workflowRun.update({
    where: { id: runId },
    data: {
      status: "succeeded",
      output: output as Prisma.InputJsonValue,
      completedAt: new Date(),
      heartbeatAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await prisma.workflowEvent.create({ data: { runId, type: "succeeded", status: "succeeded" } });
}
