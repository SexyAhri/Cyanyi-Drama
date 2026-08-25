import { Prisma } from "@prisma/client";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { parseNovelAndPersist, type NovelParseInput } from "@/lib/novel/parser-runtime";
import { prisma } from "@/lib/server/prisma";
import { saveProductionClips } from "@/lib/production/domain-store";
import { analyzeEpisodeVoices } from "@/lib/voice/analyze";

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
  const step = findRunnableStep(run.steps);
  if (!step && run.steps.every((item) => item.status === "succeeded")) {
    await finishRun(runId, {});
    return;
  }
  if (!step) {
    await prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: "blocked",
        error: { code: "WORKFLOW_DEPENDENCY_BLOCKED", message: "没有可执行的工作流步骤" },
        completedAt: new Date(),
        heartbeatAt: new Date(),
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
    await prisma.$transaction(async (tx) => {
      await tx.workflowStep.update({ where: { id: step.id }, data: { status: "succeeded", output: output as Prisma.InputJsonValue, completedAt: new Date(), updatedAt: new Date() } });
      const artifactTypes = parseStringArray(step.artifactTypes);
      if (artifactTypes.length) {
        await tx.workflowArtifact.createMany({
          data: artifactTypes.map((artifactType) => ({
            id: `${run.id}_${step.id}_${artifactType}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 190),
            runId,
            stepId: step.id,
            artifactType,
            payload: output as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });
      }
    });
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
  if (step.stepType === "split_clips") {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const storyboard = await prisma.storyboard.findFirst({
      where: { projectId: run.projectId, episodeId: run.episodeId, project: { userId } },
      include: { panels: { orderBy: { panelIndex: "asc" } } },
    });
    if (!storyboard) throw new Error("WORKFLOW_STORYBOARD_REQUIRED");
    const clipSize = 9;
    const clips = [];
    for (let offset = 0; offset < storyboard.panels.length; offset += clipSize) {
      const panels = storyboard.panels.slice(offset, offset + clipSize);
      const first = panels[0];
      const last = panels[panels.length - 1];
      clips.push({
        clipIndex: clips.length,
        summary: panels.map((panel) => panel.description || "").filter(Boolean).join(" ").slice(0, 300) || `片段 ${clips.length + 1}`,
        content: panels.map((panel) => panel.description || "").filter(Boolean).join("\n"),
        startText: first?.description,
        endText: last?.description,
        characters: uniqueStrings(panels.flatMap((panel) => parseArray(panel.charactersJson))),
        locations: uniqueStrings(panels.map((panel) => panel.locationName || "")),
        props: uniqueStrings(panels.flatMap((panel) => parseArray(panel.propsJson))),
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
    const result = await saveProductionClips(userId, run.projectId, run.episodeId, clips);
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
      where: { projectId: run.projectId, episodeId: run.episodeId, project: { userId } },
      select: { id: true, panels: { select: { id: true } } },
    });
    if (!storyboard) throw new Error("WORKFLOW_STORYBOARD_REQUIRED");
    await prisma.storyboard.update({ where: { id: storyboard.id }, data: { status: "ready" } });
    return { panelCount: storyboard.panels.length };
  }
  if (step.stepType === "voice_analyze") {
    if (!run.episodeId) throw new Error("WORKFLOW_EPISODE_REQUIRED");
    const runInput = isRecord(run.input) ? run.input : {};
    const stepInput = isRecord(step.input) ? step.input : {};
    const channelId = getString(stepInput.channelId ?? runInput.channelId);
    const model = getString(stepInput.model ?? runInput.model);
    if (!channelId || !model) throw new Error("WORKFLOW_VOICE_ANALYZE_INPUT_REQUIRED");
    const lines = await analyzeEpisodeVoices({ userId, projectId: run.projectId, episodeId: run.episodeId, channelId, model });
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
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function findRunnableStep<T extends {
  stepKey: string;
  status: string;
  stepIndex: number;
  dependsOn: Prisma.JsonValue | null;
}>(steps: T[]): T | undefined {
  return steps
    .slice()
    .sort((a, b) => a.stepIndex - b.stepIndex)
    .find((step) => {
      if (step.status !== "pending" && step.status !== "ready") return false;
      const dependencies = Array.isArray(step.dependsOn)
        ? step.dependsOn.filter((item): item is string => typeof item === "string")
        : [];
      if (!dependencies.length) return true;
      return dependencies.every((dependency) =>
        steps.some((candidate) => candidate.stepKey === dependency && candidate.status === "succeeded"),
      );
    });
}

function isRecord(value: unknown): value is Record<string, Prisma.JsonValue> { return !!value && typeof value === "object" && !Array.isArray(value); }
function getString(value: Prisma.JsonValue | undefined) { return typeof value === "string" ? value : undefined; }
function parseStringArray(value: Prisma.JsonValue | null) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

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
