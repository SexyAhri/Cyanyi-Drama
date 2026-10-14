import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/server/prisma";

export type ExecutionNotificationKind = "completed" | "partial_failure" | "action_required";

export function createExecutionNotification(input: {
  userId: string;
  projectId?: string | null;
  runId?: string | null;
  mediaTaskId?: string | null;
  kind: ExecutionNotificationKind;
  dedupeKey: string;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  href: string;
}) {
  return quietly(() => createExecutionNotificationRecord(input));
}

async function createExecutionNotificationRecord(input: {
  userId: string;
  projectId?: string | null;
  runId?: string | null;
  mediaTaskId?: string | null;
  kind: ExecutionNotificationKind;
  dedupeKey: string;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  href: string;
}) {
  const preferences = await prisma.executionNotificationPreference.findUnique({
    where: { userId: input.userId },
    select: {
      completedEnabled: true,
      partialFailureEnabled: true,
      actionRequiredEnabled: true,
    },
  });
  const enabled = input.kind === "completed"
    ? preferences?.completedEnabled ?? true
    : input.kind === "partial_failure"
      ? preferences?.partialFailureEnabled ?? true
      : preferences?.actionRequiredEnabled ?? true;
  if (!enabled) return null;

  return prisma.executionNotification.upsert({
    where: { userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey } },
    create: {
      id: randomUUID(),
      userId: input.userId,
      projectId: input.projectId ?? null,
      runId: input.runId ?? null,
      mediaTaskId: input.mediaTaskId ?? null,
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      titleZh: input.titleZh,
      titleEn: input.titleEn,
      bodyZh: input.bodyZh,
      bodyEn: input.bodyEn,
      href: input.href,
    },
    update: {},
  });
}

export function notifyMediaTaskTerminal(input: {
  userId: string;
  taskId: string;
  status: "succeeded" | "failed";
  retryCount?: number;
}) {
  return quietly(() => notifyMediaTaskTerminalRecord(input));
}

async function notifyMediaTaskTerminalRecord(input: {
  userId: string;
  taskId: string;
  status: "succeeded" | "failed";
  retryCount?: number;
}) {
  const task = await prisma.mediaTask.findFirst({
    where: { id: input.taskId, userId: input.userId },
    select: { id: true, projectId: true, episodeId: true, kind: true, targetType: true, targetId: true, retryCount: true },
  });
  if (!task || !task.projectId) return null;
  const target = task.targetId ?? task.episodeId ?? task.id;
  const retry = input.retryCount ?? task.retryCount;
  const kind = input.status === "succeeded" ? "completed" : "action_required";
  return createExecutionNotification({
    userId: input.userId,
    projectId: task.projectId,
    mediaTaskId: task.id,
    kind,
    dedupeKey: `media:${task.id}:${input.status}:${retry}`,
    titleZh: input.status === "succeeded" ? "媒体任务已完成" : "媒体任务需要处理",
    titleEn: input.status === "succeeded" ? "Media task completed" : "Media task needs attention",
    bodyZh: `${task.kind} 请求（${task.targetType ?? "项目对象"} ${target}）${input.status === "succeeded" ? "已完成" : "失败，请检查原因后重试"}。`,
    bodyEn: `${task.kind} request for ${task.targetType ?? "project object"} ${target} ${input.status === "succeeded" ? "completed" : "failed; review the cause before retrying"}.`,
    href: buildProjectHref(task.projectId, task.episodeId, task.kind === "audio" ? "audio" : "shots", "task", task.id),
  });
}

export function notifyWorkflowTerminal(input: {
  userId: string;
  runId: string;
  status: "succeeded" | "failed";
  dedupeSuffix?: string;
}) {
  return quietly(() => notifyWorkflowTerminalRecord(input));
}

async function notifyWorkflowTerminalRecord(input: {
  userId: string;
  runId: string;
  status: "succeeded" | "failed";
  dedupeSuffix?: string;
}) {
  const run = await prisma.workflowRun.findFirst({
    where: { id: input.runId, userId: input.userId },
    select: {
      id: true,
      projectId: true,
      workflowType: true,
      steps: { select: { status: true } },
    },
  });
  if (!run?.projectId) return null;
  const succeededSteps = run.steps.filter((step) => step.status === "succeeded").length;
  const kind: ExecutionNotificationKind = input.status === "succeeded"
    ? "completed"
    : succeededSteps > 0 ? "partial_failure" : "action_required";
  const completed = input.status === "succeeded";
  return createExecutionNotification({
    userId: input.userId,
    projectId: run.projectId,
    runId: run.id,
    kind,
    dedupeKey: `workflow:${run.id}:${input.status}${input.dedupeSuffix ? `:${input.dedupeSuffix}` : ""}`,
    titleZh: completed ? "工作流已完成" : kind === "partial_failure" ? "工作流部分失败" : "工作流需要处理",
    titleEn: completed ? "Workflow completed" : kind === "partial_failure" ? "Workflow partially failed" : "Workflow needs attention",
    bodyZh: `工作流 ${run.workflowType} ${completed ? "已完成" : kind === "partial_failure" ? `有 ${succeededSteps} 个步骤已成功，仍有步骤失败` : "执行失败，请检查运行记录"}。`,
    bodyEn: `Workflow ${run.workflowType} ${completed ? "completed" : kind === "partial_failure" ? `partially failed after ${succeededSteps} successful steps` : "failed; review the run details"}.`,
    href: buildProjectHref(run.projectId, null, "writing", "run", run.id),
  });
}

export function notifyWorkflowActionRequired(input: {
  userId: string;
  runId: string;
  stepKey: string;
  stepLabel?: string;
}) {
  return quietly(() => notifyWorkflowActionRequiredRecord(input));
}

async function notifyWorkflowActionRequiredRecord(input: {
  userId: string;
  runId: string;
  stepKey: string;
  stepLabel?: string;
}) {
  const run = await prisma.workflowRun.findFirst({
    where: { id: input.runId, userId: input.userId },
    select: { id: true, projectId: true, workflowType: true },
  });
  if (!run?.projectId) return null;
  const step = input.stepLabel ?? input.stepKey;
  return createExecutionNotification({
    userId: input.userId,
    projectId: run.projectId,
    runId: run.id,
    kind: "action_required",
    dedupeKey: `workflow:${run.id}:manual_gate:${input.stepKey}`,
    titleZh: "工作流等待人工处理",
    titleEn: "Workflow needs your attention",
    bodyZh: `工作流 ${run.workflowType} 等待确认“${step}”后继续。`,
    bodyEn: `Workflow ${run.workflowType} is waiting for approval at “${step}”.`,
    href: buildProjectHref(run.projectId, null, "writing", "run", run.id),
  });
}

function buildProjectHref(projectId: string, episodeId: string | null, stage: string, focusKey?: "run" | "task", focusId?: string) {
  const query = new URLSearchParams({ stage });
  if (episodeId) query.set("episode", episodeId);
  if (focusKey && focusId) query.set(focusKey, focusId);
  return `/projects/${encodeURIComponent(projectId)}?${query.toString()}`;
}

async function quietly<T>(work: () => Promise<T>) {
  try {
    return await work();
  } catch (error) {
    console.error("Unable to create execution notification", error);
    return null;
  }
}
