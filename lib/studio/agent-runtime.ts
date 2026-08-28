import type {
  AgentEvent,
  AgentMessage,
  AgentToolCall,
} from "@/lib/agent/types";
import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { controlMediaTask } from "@/lib/media/task-actions";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import {
  canReviseScreenplayClip,
  classifyScreenplayFailureContext,
  reviseScreenplayClip,
} from "@/lib/novel/screenplay-revision";
import { decryptSecret, encryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import { studioWorkflowAgentSchema } from "@/lib/prompts/schemas";
import { structuredRequestOptions } from "@/lib/settings/runtime-contract";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import {
  controlWorkflowRun,
  type WorkflowAction,
} from "@/lib/workflow/actions";
import { getWorkflowRun, listWorkflowRuns } from "@/lib/workflow/store";

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
export type StudioAgentModelSelection = {
  channelId: string;
  model: string;
};

type StudioAgentOperation =
  | "cancel_media_task"
  | "cancel_workflow"
  | "pause_workflow"
  | "resume_workflow"
  | "revise_screenplay"
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
  channelId?: string;
  failureContext?: unknown;
  model?: string;
  request?: string;
  version: 1;
};

type AgentState = Awaited<ReturnType<typeof loadAgentState>>;

export async function runStudioAgent(input: {
  content: string;
  context: StudioAgentContext;
  locale: StudioAgentLocale;
  modelSelection?: StudioAgentModelSelection;
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
    modelSelection?: StudioAgentModelSelection;
    projectId: string;
    userId: string;
  },
  state: AgentState,
): AsyncIterable<AgentEvent> {
  const decision = await decideStudioAgentAction(input, state);
  if (!decision.operation) {
    yield messageEvent(decision.reply);
    return;
  }

  const target = findOperationTarget(
    state,
    decision.operation,
    decision.targetId ?? undefined,
  );
  if (!target) {
    yield messageEvent(noActionableTarget(decision.operation, input.locale));
    return;
  }

  yield messageEvent(decision.reply);

  const messageId = createId("msg");
  const toolCallId = createId("tool");
  const screenplayFailureContext =
    decision.operation === "revise_screenplay" &&
    "failureCategory" in target &&
    target.failureCategory === "semantic"
      ? target.failureContext
      : undefined;
  const approvalId = encryptSecret(
    JSON.stringify({
      ...(decision.operation === "revise_screenplay"
        ? {
            channelId: decision.modelSelection?.channelId,
            failureContext: screenplayFailureContext,
            model: decision.modelSelection?.model,
            request: input.content.trim().slice(0, 8_000),
          }
        : {}),
      expiresAt: Date.now() + APPROVAL_TTL_MS,
      locale: input.locale,
      messageId,
      operation: decision.operation,
      projectId: input.projectId,
      targetId: target.id,
      toolCallId,
      userId: input.userId,
      version: 1,
    } satisfies ApprovalPayload),
  );
  const toolCall: AgentToolCall = {
    id: toolCallId,
    name: decision.operation,
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
        traceId: "traceId" in target ? target.traceId : undefined,
        type:
          decision.operation === "revise_screenplay"
            ? "screenplay_clip"
            : decision.operation.includes("workflow")
              ? "workflow"
              : "media_task",
      },
      ...(decision.operation === "revise_screenplay"
        ? {
            failureContext: screenplayFailureContext ?? null,
            request: input.content.trim().slice(0, 8_000),
          }
        : {}),
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
  const screenplayTarget = /剧本|脚本|screenplay|script/.test(normalized);
  if (
    screenplayTarget &&
    /修改|调整|修订|修复|改写|完善|modify|revise|repair|adjust|rewrite/.test(
      normalized,
    )
  )
    return "revise_screenplay";
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

  const [workflows, tasks, clips] = await Promise.all([
    listWorkflowRuns(input.userId, input.projectId, 100),
    createDatabaseMediaTaskStore(input.userId).list({
      projectId: input.projectId,
      ...(episode ? { episodeId: episode.id } : {}),
      limit: 100,
    }),
    prisma.storyClip.findMany({
      where: {
        projectId: input.projectId,
        ...(episode ? { episodeId: episode.id } : {}),
      },
      orderBy: { clipIndex: "asc" },
      take: 200,
      select: {
        clipIndex: true,
        episodeId: true,
        id: true,
        screenplay: true,
        status: true,
        summary: true,
      },
    }),
  ]);
  const relevantWorkflows = workflows.filter(
    (workflow) =>
      (!episode || workflow.episodeId === episode.id) &&
      workflowMatchesStage(workflow.workflowType, input.context.stageId),
  );
  const screenplayArtifacts = relevantWorkflows.length
    ? await prisma.workflowArtifact.findMany({
        where: {
          artifactType: "screenplay.clip",
          runId: { in: relevantWorkflows.map((workflow) => workflow.id) },
        },
        orderBy: { createdAt: "desc" },
        select: {
          createdAt: true,
          payload: true,
          refId: true,
          runId: true,
        },
      })
    : [];
  return {
    clips: clips.map((clip) => {
      const failureContext =
        clip.status === "screenplay_failed"
          ? findClipFailureContext(
              clip.id,
              relevantWorkflows,
              screenplayArtifacts,
            )
          : undefined;
      return {
        ...clip,
        failureCategory: classifyScreenplayFailureContext(failureContext),
        failureContext,
      };
    }),
    context: input.context,
    episode,
    project,
    tasks: tasks.filter((task) =>
      taskMatchesStage(task, input.context.stageId),
    ),
    workflows: relevantWorkflows,
  };
}

function findOperationTarget(
  state: AgentState,
  operation: StudioAgentOperation,
  requestedTargetId?: string,
) {
  const selectionId = state.context.selection?.id;
  if (operation === "revise_screenplay") {
    if (state.context.stageId !== "writing") return undefined;
    return selectScreenplayRevisionClip(
      state.clips,
      selectionId,
      requestedTargetId,
    );
  }
  if (operation.includes("media_task")) {
    const eligible = state.tasks.filter((task) =>
      operation === "retry_media_task"
        ? task.status === "failed"
        : ["queued", "running"].includes(task.status),
    );
    return requestedTargetId
      ? eligible.find((task) => task.id === requestedTargetId)
      : (eligible.find((task) => task.targetId === selectionId) ?? eligible[0]);
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
  return requestedTargetId
    ? eligible.find((workflow) => workflow.id === requestedTargetId)
    : eligible[0];
}

export function selectScreenplayRevisionClip<
  T extends {
    failureContext?: unknown;
    id: string;
    screenplay: string | null;
  },
>(clips: readonly T[], selectionId?: string, requestedTargetId?: string) {
  const eligible = clips.filter((clip) => canReviseScreenplayClip(clip));
  return requestedTargetId
    ? eligible.find((clip) => clip.id === requestedTargetId)
    : (eligible.find((clip) => clip.id === selectionId) ?? eligible[0]);
}

async function decideStudioAgentAction(
  input: {
    content: string;
    locale: StudioAgentLocale;
    modelSelection?: StudioAgentModelSelection;
    userId: string;
  },
  state: AgentState,
) {
  const provider = await resolveStudioAgentProvider(input, state);
  if (!provider) return deterministicStudioAgentDecision(input, state);
  const candidates = buildOperationCandidates(state);
  const prompt = renderPrompt({
    id: PROMPT_IDS.STUDIO_WORKFLOW_AGENT,
    locale: input.locale === "en" ? "en" : "zh",
    variables: {
      state_json: JSON.stringify(buildModelState(state)),
      operation_candidates_json: JSON.stringify(candidates),
      user_request: input.content.trim(),
    },
  });
  const result = await requestOpenAiStructured({
    baseUrl: provider.baseUrl,
    apiKeys: provider.apiKeys,
    model: provider.model,
    prompt,
    schema: studioWorkflowAgentSchema,
    structuredOutputMode: provider.structuredOutputMode,
    temperature: 0.1,
    ...provider.requestOptions,
  });
  const decision = {
    ...result.data,
    modelSelection: {
      channelId: provider.channelId,
      model: provider.model,
    },
  };
  if (!decision.operation && !decision.targetId) return decision;
  if (!decision.operation || !decision.targetId)
    return {
      reply: decision.reply,
      operation: null,
      targetId: null,
    };
  const target = findOperationTarget(state, decision.operation, decision.targetId);
  return target
    ? decision
    : {
        reply:
          input.locale === "en"
            ? `${decision.reply}\n\nThe proposed target is not eligible in the current stage, so no action was created.`
            : `${decision.reply}\n\n模型选择的目标不属于当前阶段可操作候选，因此未创建操作。`,
        operation: null,
        targetId: null,
      };
}

async function resolveStudioAgentProvider(
  input: {
    modelSelection?: StudioAgentModelSelection;
    userId: string;
  },
  state: AgentState,
) {
  let selection = input.modelSelection;
  if (!selection && state.workflows[0]) {
    const workflow = await getWorkflowRun(input.userId, state.workflows[0].id);
    const channelId = stringValue(workflow?.input?.channelId);
    const model = stringValue(workflow?.input?.model);
    if (channelId && model) selection = { channelId, model };
  }
  if (!selection) return null;
  const configuredModel = await prisma.providerModel.findFirst({
    where: {
      channelId: selection.channelId,
      modelId: selection.model,
      selected: true,
      channel: { userId: input.userId },
    },
    select: {
      capabilitiesJson: true,
      channel: {
        select: {
          baseUrl: true,
          encryptedApiKeys: true,
          protocol: true,
        },
      },
    },
  });
  if (!configuredModel)
    throw new StudioAgentError("AGENT_MODEL_NOT_CONFIGURED", 400);
  if (
    configuredModel.channel.protocol !== "openai-compatible" &&
    configuredModel.channel.protocol !== "volcengine-ark"
  )
    throw new StudioAgentError(
      `AGENT_MODEL_PROTOCOL_NOT_SUPPORTED:${configuredModel.channel.protocol}`,
      400,
    );
  const apiKeys = parseApiKeys(configuredModel.channel.encryptedApiKeys);
  if (!apiKeys.length)
    throw new StudioAgentError("AGENT_MODEL_API_KEY_MISSING", 400);
  const runtimeSettings = await loadUserRuntimeSettings(input.userId);
  return {
    apiKeys,
    baseUrl: configuredModel.channel.baseUrl,
    channelId: selection.channelId,
    model: selection.model,
    requestOptions: structuredRequestOptions(runtimeSettings),
    structuredOutputMode: supportsStoredStructuredOutputs(
      configuredModel.capabilitiesJson,
    )
      ? ("json_schema" as const)
      : ("json_object" as const),
  };
}

function deterministicStudioAgentDecision(
  input: { content: string; locale: StudioAgentLocale },
  state: AgentState,
) {
  const operation = getStudioAgentIntent(input.content);
  if (operation === "revise_screenplay")
    return {
      reply:
        input.locale === "en"
          ? "Select a configured Agent model before requesting a screenplay revision."
          : "请先选择可用的 Agent 模型，再提交剧本修改。",
      operation: null,
      targetId: null,
    };
  const target = operation ? findOperationTarget(state, operation) : null;
  return {
    reply: operation
      ? target
        ? input.locale === "en"
          ? `I found an eligible ${operationLabel(operation)} target in the current stage. Approval is required before execution.`
          : `已在当前阶段找到可执行“${operationLabel(operation)}”的目标，执行前需要你的批准。`
        : noActionableTarget(operation, input.locale)
      : buildContextSummary(state, input.locale),
    operation: target ? operation : null,
    targetId: target?.id ?? null,
  };
}

function buildOperationCandidates(state: AgentState) {
  return Object.fromEntries(
    (
      [
        "cancel_media_task",
        "cancel_workflow",
        "pause_workflow",
        "resume_workflow",
        "revise_screenplay",
        "retry_media_task",
        "retry_workflow",
      ] as StudioAgentOperation[]
    ).map((operation) => [
      operation,
      operation === "revise_screenplay"
        ? state.clips
            .filter((clip) => findOperationTarget(state, operation, clip.id))
            .map((clip) => ({
              clipIndex: clip.clipIndex,
              failureCategory: clip.failureCategory,
              failureContext: clip.failureContext ?? null,
              hasScreenplay: Boolean(clip.screenplay),
              id: clip.id,
              status: clip.status,
              summary: clip.summary,
            }))
        : operation.includes("media_task")
        ? state.tasks
            .filter((task) => findOperationTarget(state, operation, task.id))
            .map((task) => ({
              id: task.id,
              status: task.status,
              targetId: task.targetId ?? null,
              targetType: task.targetType ?? null,
              traceId: task.traceId,
            }))
        : state.workflows
            .filter((workflow) =>
              findOperationTarget(state, operation, workflow.id),
            )
            .map((workflow) => ({
              id: workflow.id,
              status: workflow.status,
              traceId: workflow.traceId,
              workflowType: workflow.workflowType,
            })),
    ]),
  );
}

function buildModelState(state: AgentState) {
  return {
    context: state.context,
    clips: state.clips.map((clip) => ({
      clipIndex: clip.clipIndex,
      failureCategory: clip.failureCategory,
      failureContext: clip.failureContext ?? null,
      hasScreenplay: Boolean(clip.screenplay),
      id: clip.id,
      status: clip.status,
      summary: clip.summary,
    })),
    episode: state.episode ?? null,
    project: { id: state.project.id, name: state.project.name },
    tasks: state.tasks.map((task) => ({
      id: task.id,
      error: task.error ?? null,
      kind: task.kind,
      status: task.status,
      targetId: task.targetId ?? null,
      targetType: task.targetType ?? null,
      traceId: task.traceId,
      updatedAt: task.updatedAt,
    })),
    workflows: state.workflows.map((workflow) => ({
      id: workflow.id,
      error: workflow.error ?? null,
      status: workflow.status,
      steps: workflow.steps.map((step) => ({
        attempt: step.attempt,
        error: step.error ?? null,
        key: step.key,
        maxAttempts: step.maxAttempts,
        retryable: step.retryable,
        status: step.status,
      })),
      traceId: workflow.traceId,
      updatedAt: workflow.updatedAt,
      workflowType: workflow.workflowType,
    })),
  };
}

function findClipFailureContext(
  clipId: string,
  workflows: Array<{
    error?: Record<string, unknown>;
    id: string;
    steps: Array<{
      attempt: number;
      error?: Record<string, unknown>;
      key: string;
      maxAttempts: number;
      status: string;
    }>;
    workflowType: string;
  }>,
  artifacts: Array<{
    createdAt: Date;
    payload: unknown;
    refId: string | null;
    runId: string;
  }>,
) {
  const artifact = artifacts.find((item) => {
    if (item.refId !== clipId || !isRecord(item.payload)) return false;
    return item.payload.success === false || typeof item.payload.error === "string";
  });
  const workflow = artifact
    ? workflows.find((item) => item.id === artifact.runId)
    : workflows.find((item) => JSON.stringify(item.error ?? {}).includes(clipId));
  if (!artifact && !workflow) return undefined;
  const payload = artifact && isRecord(artifact.payload) ? artifact.payload : {};
  return {
    artifactCreatedAt: artifact?.createdAt.toISOString() ?? null,
    clipId,
    error: typeof payload.error === "string" ? payload.error : null,
    failedSteps:
      workflow?.steps
        .filter((step) => step.status === "failed")
        .map((step) => ({
          attempt: step.attempt,
          error: step.error ?? null,
          key: step.key,
          maxAttempts: step.maxAttempts,
        })) ?? [],
    workflowError: workflow?.error ?? null,
    workflowId: workflow?.id ?? artifact?.runId ?? null,
    workflowType: workflow?.workflowType ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseApiKeys(value: string) {
  try {
    const parsed: unknown = JSON.parse(decryptSecret(value));
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is string =>
            typeof item === "string" && Boolean(item.trim()),
        )
      : [];
  } catch {
    return [];
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function executeOperation(approval: ApprovalPayload) {
  if (approval.operation === "revise_screenplay") {
    if (!approval.channelId || !approval.model || !approval.request)
      throw new StudioAgentError("AGENT_SCREENPLAY_REVISION_CONTEXT_MISSING");
    const result = await reviseScreenplayClip({
      channelId: approval.channelId,
      clipId: approval.targetId,
      failureContext: approval.failureContext,
      locale: approval.locale === "en" ? "en" : "zh",
      model: approval.model,
      projectId: approval.projectId,
      request: approval.request,
      userId: approval.userId,
    });
    return {
      action: approval.operation,
      ...result,
    };
  }
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
      (parsed.operation === "revise_screenplay" &&
        (!parsed.channelId || !parsed.model || !parsed.request)) ||
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
    revise_screenplay: "修改剧本",
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
