import type {
  AgentEvent,
  AgentMessage,
  AgentToolCall,
} from "@/lib/agent/types";
import { controlMediaTask } from "@/lib/media/task-actions";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import { decryptSecret, encryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import {
  controlWorkflowRun,
  type WorkflowAction,
} from "@/lib/workflow/actions";
import { listWorkflowRuns } from "@/lib/workflow/store";

const APPROVAL_TTL_MS = 15 * 60 * 1000;
const STAGE_IDS = [
  "writing",
  "assets",
  "storyboard",
  "shots",
  "audio",
  "delivery",
] as const;

export type StudioAgentStageId = (typeof STAGE_IDS)[number];

export type StudioAgentSelection = {
  id: string;
  kind: string;
  label: string;
  metadata?: Record<string, boolean | number | string | null>;
};

export type StudioAgentContext = {
  episodeId?: string;
  selection?: StudioAgentSelection;
  stageId: StudioAgentStageId;
};

type StudioAgentLocale = "en" | "zh-CN";
type StudioAgentOperation =
  | "cancel_media_task"
  | "cancel_workflow"
  | "pause_workflow"
  | "resume_workflow"
  | "retry_media_task"
  | "retry_workflow";

type ApprovalPayload = {
  expiresAt: number;
  locale: StudioAgentLocale;
  messageId: string;
  operation: StudioAgentOperation;
  projectId: string;
  targetId: string;
  toolCallId: string;
  userId: string;
  version: 1;
};

type AgentState = Awaited<ReturnType<typeof loadAgentState>>;

export async function runStudioAgent(input: {
  content: string;
  context: StudioAgentContext;
  locale: StudioAgentLocale;
  projectId: string;
  userId: string;
}): Promise<AsyncIterable<AgentEvent>> {
  const state = await loadAgentState(input);
  return runStudioAgentEvents(input, state);
}

async function* runStudioAgentEvents(
  input: {
    content: string;
    context: StudioAgentContext;
    locale: StudioAgentLocale;
    projectId: string;
    userId: string;
  },
  state: AgentState,
): AsyncIterable<AgentEvent> {
  const intent = getStudioAgentIntent(input.content);
  if (!intent) {
    yield messageEvent(buildContextSummary(state, input.locale));
    return;
  }

  const target = findOperationTarget(state, intent);
  if (!target) {
    yield messageEvent(noActionableTarget(intent, input.locale));
    return;
  }

  const messageId = createId("msg");
  const toolCallId = createId("tool");
  const approvalId = encryptSecret(
    JSON.stringify({
      expiresAt: Date.now() + APPROVAL_TTL_MS,
      locale: input.locale,
      messageId,
      operation: intent,
      projectId: input.projectId,
      targetId: target.id,
      toolCallId,
      userId: input.userId,
      version: 1,
    } satisfies ApprovalPayload),
  );
  const toolCall: AgentToolCall = {
    id: toolCallId,
    name: intent,
    args: {
      context: {
        episodeId: state.episode?.id ?? null,
        projectId: state.project.id,
        selection: input.context.selection ?? null,
        stageId: input.context.stageId,
      },
      target: {
        id: target.id,
        status: target.status,
        traceId: target.traceId,
        type: intent.includes("workflow") ? "workflow" : "media_task",
      },
    },
    approvalId,
    status: "pending",
  };
  yield {
    type: "message.created",
    message: {
      id: messageId,
      role: "tool",
      content: "",
      createdAt: new Date().toISOString(),
      metadata: { context: input.context },
    },
  };
  yield { type: "tool.pending", messageId, toolCall };
  yield {
    type: "approval.required",
    approvalId,
    messageId,
    toolCallId,
  };
}

export function resolveStudioAgentApproval(input: {
  approvalId: string;
  decision: "approved" | "denied";
  projectId: string;
  userId: string;
}): AsyncIterable<AgentEvent> {
  const approval = readApproval(input.approvalId);
  if (
    approval.userId !== input.userId ||
    approval.projectId !== input.projectId
  ) {
    throw new StudioAgentError("AGENT_APPROVAL_CONTEXT_MISMATCH", 403);
  }
  return resolveStudioAgentApprovalEvents(input, approval);
}

async function* resolveStudioAgentApprovalEvents(
  input: {
    approvalId: string;
    decision: "approved" | "denied";
  },
  approval: ApprovalPayload,
): AsyncIterable<AgentEvent> {
  yield {
    type: "approval.resolved",
    approvalId: input.approvalId,
    decision: input.decision,
  };
  if (input.decision === "denied") {
    yield messageEvent(
      approval.locale === "en" ? "Action denied." : "操作已拒绝。",
    );
    return;
  }

  yield {
    type: "tool.running",
    messageId: approval.messageId,
    toolCallId: approval.toolCallId,
  };
  try {
    const result = await executeOperation(approval);
    yield {
      type: "tool.done",
      messageId: approval.messageId,
      toolCallId: approval.toolCallId,
      result,
    };
    yield messageEvent(
      approval.locale === "en"
        ? "The approved action completed. Workspace data has been refreshed."
        : "已完成批准的操作，工作台数据已刷新。",
    );
  } catch (error) {
    yield {
      type: "tool.error",
      messageId: approval.messageId,
      toolCallId: approval.toolCallId,
      error: error instanceof Error ? error.message : "AGENT_TOOL_FAILED",
    };
  }
}

export function getStudioAgentIntent(
  content: string,
): StudioAgentOperation | null {
  const normalized = content.trim().toLowerCase();
  if (!normalized) return null;
  const mediaTarget = /任务|媒体|task|media/.test(normalized);
  const workflowTarget = /工作流|运行|workflow|\brun\b/.test(normalized);
  if (!mediaTarget && !workflowTarget) return null;

  if (/重试|再试|retry/.test(normalized))
    return mediaTarget ? "retry_media_task" : "retry_workflow";
  if (/取消|停止|cancel|stop/.test(normalized))
    return mediaTarget ? "cancel_media_task" : "cancel_workflow";
  if (/暂停|pause/.test(normalized) && workflowTarget) return "pause_workflow";
  if (/恢复|继续|resume/.test(normalized) && workflowTarget)
    return "resume_workflow";
  return null;
}

export class StudioAgentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

async function loadAgentState(input: {
  context: StudioAgentContext;
  projectId: string;
  userId: string;
}) {
  if (!STAGE_IDS.includes(input.context.stageId))
    throw new StudioAgentError("AGENT_STAGE_INVALID");
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
    select: {
      id: true,
      name: true,
      episodes: {
        orderBy: { episodeNumber: "asc" },
        select: { id: true, name: true },
      },
    },
  });
  if (!project) throw new StudioAgentError("项目不存在", 404);
  const episode = input.context.episodeId
    ? project.episodes.find((item) => item.id === input.context.episodeId)
    : undefined;
  if (input.context.episodeId && !episode)
    throw new StudioAgentError("剧集不存在", 404);

  const [workflows, tasks] = await Promise.all([
    listWorkflowRuns(input.userId, input.projectId, 100),
    createDatabaseMediaTaskStore(input.userId).list({
      projectId: input.projectId,
      ...(episode ? { episodeId: episode.id } : {}),
      limit: 100,
    }),
  ]);
  return {
    context: input.context,
    episode,
    project,
    tasks: tasks.filter((task) =>
      taskMatchesStage(task, input.context.stageId),
    ),
    workflows: workflows.filter(
      (workflow) =>
        (!episode || workflow.episodeId === episode.id) &&
        workflowMatchesStage(workflow.workflowType, input.context.stageId),
    ),
  };
}

function findOperationTarget(
  state: AgentState,
  operation: StudioAgentOperation,
) {
  const selectionId = state.context.selection?.id;
  if (operation.includes("media_task")) {
    const eligible = state.tasks.filter((task) =>
      operation === "retry_media_task"
        ? task.status === "failed"
        : ["queued", "running"].includes(task.status),
    );
    return (
      eligible.find((task) => task.targetId === selectionId) ?? eligible[0]
    );
  }
  const eligible = state.workflows.filter((workflow) => {
    if (operation === "retry_workflow")
      return ["blocked", "failed"].includes(workflow.status);
    if (operation === "resume_workflow") return workflow.status === "paused";
    if (operation === "pause_workflow") return workflow.status === "running";
    return ["canceling", "paused", "queued", "running"].includes(
      workflow.status,
    );
  });
  return eligible[0];
}

async function executeOperation(approval: ApprovalPayload) {
  if (approval.operation.includes("media_task")) {
    const task = await controlMediaTask({
      action: approval.operation === "retry_media_task" ? "retry" : "cancel",
      projectId: approval.projectId,
      taskId: approval.targetId,
      userId: approval.userId,
    });
    return {
      action: approval.operation,
      id: task.id,
      status: task.status,
      traceId: task.traceId,
      updatedAt: task.updatedAt,
    };
  }
  const workflow = await controlWorkflowRun({
    action: approval.operation.replace("_workflow", "") as WorkflowAction,
    projectId: approval.projectId,
    runId: approval.targetId,
    userId: approval.userId,
  });
  return {
    action: approval.operation,
    id: workflow.id,
    status: workflow.status,
    traceId: workflow.traceId,
    updatedAt: workflow.updatedAt,
  };
}

function readApproval(value: string): ApprovalPayload {
  try {
    const parsed = JSON.parse(decryptSecret(value)) as ApprovalPayload;
    if (
      parsed.version !== 1 ||
      !parsed.userId ||
      !parsed.projectId ||
      !parsed.targetId ||
      !parsed.messageId ||
      !parsed.toolCallId ||
      !parsed.operation ||
      parsed.expiresAt < Date.now()
    ) {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    throw new StudioAgentError("AGENT_APPROVAL_INVALID_OR_EXPIRED", 410);
  }
}

function buildContextSummary(state: AgentState, locale: StudioAgentLocale) {
  const running = state.tasks.filter((task) =>
    ["queued", "running"].includes(task.status),
  ).length;
  const failed = state.tasks.filter((task) => task.status === "failed").length;
  const completed = state.tasks.filter(
    (task) => task.status === "succeeded",
  ).length;
  const workflow = state.workflows[0];
  const selection = state.context.selection?.label;
  if (locale === "en") {
    return [
      `${state.project.name}${state.episode ? ` / ${state.episode.name}` : ""} is on ${stageLabel(state.context.stageId, locale)}.`,
      selection ? `Selected: ${selection}.` : "No entity is selected.",
      `This stage has ${state.tasks.length} media tasks: ${running} active, ${completed} complete, ${failed} failed.`,
      workflow
        ? `Latest workflow ${workflow.workflowType} is ${workflow.status}.`
        : "This stage has no workflow run.",
      failed
        ? "Resolve failed tasks before continuing."
        : running
          ? "Active tasks are still processing."
          : "No blocking media task was found.",
    ].join("\n\n");
  }
  return [
    `${state.project.name}${state.episode ? ` / ${state.episode.name}` : ""} 当前位于「${stageLabel(state.context.stageId, locale)}」。`,
    selection ? `当前选择：${selection}。` : "当前没有选中具体实体。",
    `本阶段共有 ${state.tasks.length} 个媒体任务：${running} 个进行中、${completed} 个已完成、${failed} 个失败。`,
    workflow
      ? `最近工作流 ${workflow.workflowType} 的状态为 ${workflow.status}。`
      : "本阶段没有工作流运行记录。",
    failed
      ? "建议先处理失败任务再继续下游制作。"
      : running
        ? "当前仍有任务在处理。"
        : "没有发现阻塞中的媒体任务。",
  ].join("\n\n");
}

function noActionableTarget(
  operation: StudioAgentOperation,
  locale: StudioAgentLocale,
) {
  if (locale === "en")
    return `No eligible target was found for ${operation.replaceAll("_", " ")} in the current stage.`;
  return `当前阶段没有可执行“${operationLabel(operation)}”的目标。`;
}

function operationLabel(operation: StudioAgentOperation) {
  const labels: Record<StudioAgentOperation, string> = {
    cancel_media_task: "取消媒体任务",
    cancel_workflow: "取消工作流",
    pause_workflow: "暂停工作流",
    resume_workflow: "恢复工作流",
    retry_media_task: "重试媒体任务",
    retry_workflow: "重试工作流",
  };
  return labels[operation];
}

function taskMatchesStage(
  task: { kind: string; targetType?: string },
  stageId: StudioAgentStageId,
) {
  if (stageId === "assets")
    return ["character", "location", "prop"].includes(task.targetType ?? "");
  if (stageId === "shots")
    return (
      task.targetType === "storyboard_panel" &&
      ["image", "video"].includes(task.kind)
    );
  if (stageId === "audio")
    return ["episode_audio", "lip_sync", "voice_line"].includes(
      task.targetType ?? "",
    );
  if (stageId === "delivery") return task.targetType === "editor_render";
  return false;
}

function workflowMatchesStage(
  workflowType: string,
  stageId: StudioAgentStageId,
) {
  return (
    (stageId === "writing" && workflowType === "story-to-script") ||
    (stageId === "storyboard" && workflowType === "script-to-storyboard")
  );
}

function stageLabel(stageId: StudioAgentStageId, locale: StudioAgentLocale) {
  const labels = {
    assets: ["角色、场景与道具", "Assets"],
    audio: ["声音制作", "Audio production"],
    delivery: ["时间线与交付", "Timeline and delivery"],
    shots: ["镜头生产", "Shot production"],
    storyboard: ["分镜设计", "Storyboard design"],
    writing: ["小说与剧本", "Story and script"],
  } as const;
  return labels[stageId][locale === "en" ? 1 : 0];
}

function messageEvent(content: string): AgentEvent {
  return {
    type: "message.created",
    message: {
      id: createId("msg"),
      role: "assistant",
      content,
      createdAt: new Date().toISOString(),
    } satisfies AgentMessage,
  };
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}
