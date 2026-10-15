import type { StudioProductionOptions } from "./production-input";
import type {
  AgentEvent,
  AgentMessage,
  AgentToolCall,
} from "@/lib/agent/types";
import { createHash, randomUUID } from "node:crypto";
import { summarizeAgentTestRunCost } from "./agent-test-cost";
import type { ModelChargeReceipt } from "@/lib/billing/model-charge";
import { resolveProductionConfiguration, assertConfigurationScope, validateManagementConfiguration } from "@/lib/production-configuration/store";
import { mergeProductionConfigurations, type ProductionConfigurationPatch, type ProductionConfigurationSnapshot } from "@/lib/production-configuration/contract";
import { withProductionConfiguration } from "@/lib/production-configuration/context";
import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { StructuredOutputError } from "@/lib/llm/structured-output";
import { studioAgentPlainTextFallback } from "@/lib/studio/agent-response";
import { resolveStorySetup } from "./production-input";
import { controlMediaTask } from "@/lib/media/task-actions";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import {
  canReviseScreenplayClip,
  classifyScreenplayFailureContext,
  reviseScreenplayClip,
} from "@/lib/novel/screenplay-revision";
import { decryptSecret, encryptSecret } from "@/lib/server/crypto";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { prisma } from "@/lib/server/prisma";
import {
  canvasDocumentSchema,
  compileCanvasInput,
  canvasConnectionError,
  canvasEdgePurpose,
  type CanvasDocument,
  type CanvasCard,
} from "./canvas-document";
import { PROMPT_IDS, renderPrompt } from "@/lib/prompts";
import { normalizeStudioWorkflowAgentResponse, studioWorkflowAgentSchema } from "@/lib/prompts/schemas";
import { structuredRequestOptions } from "@/lib/settings/runtime-contract";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import {
  controlWorkflowRun,
  type WorkflowAction,
} from "@/lib/workflow/actions";
import { getWorkflowRun, listWorkflowRuns } from "@/lib/workflow/store";
import { loadAgentAssetContext } from "./agent-asset-context";
import { loadAgentProjectContext } from "./agent-project-context";
import { serializeBudgetedContext } from "./context-budget";
import {
  applyStudioAgentContextScopes,
  DEFAULT_STUDIO_AGENT_CONTEXT_SCOPES,
  type StudioAgentContextScope,
} from "./agent-context-policy";
import {
  filterStudioAgentOperationCandidates,
  isStudioAgentOperationEnabled,
} from "./agent-operation-policy";
import {
  studioAgentApprovalGranted,
  studioAgentConfirmationMode,
} from "./agent-approval-policy";
import {
  STUDIO_PRODUCTION_OPERATIONS,
  isProductionOperation,
  startStudioProductionAction,
  type StudioProductionOperation,
} from "./agent-production-actions";

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
  view?: "workflow" | "canvas";
  canvasNodeId?: string;
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
  | "read_project_object"
  | StudioProductionOperation
  | "cancel_media_task"
  | "cancel_workflow"
  | "pause_workflow"
  | "resume_workflow"
  | "revise_screenplay"
  | "retry_media_task"
  | "retry_workflow"
  | "update_canvas_prompt";

type ApprovalPayload = {
  episodeId?: string;
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
  assetKind?: "character" | "location" | "prop";
  targetLabel?: string;
  request?: string;
  productionOptions?: StudioProductionOptions;
  version: 1;
  canvasDraft?: {
    episodeId: string;
    revision: number;
    kind: "image" | "video";
    before: string;
    after: string;
    inputSignature?: string;
  };
};

type AgentState = Awaited<ReturnType<typeof loadAgentState>>;
type StudioAgentDecision = {
  reply: string;
  operation: StudioAgentOperation | null;
  targetId: string | null;
  canvasPrompt?: string | null;
  modelSelection?: StudioAgentModelSelection;
  testRun?: {
    request: { channelId?: string; model: string; structuredOutputMode?: string; temperature: number; systemText: string; userText: string };
    trace: { model: string; channelId?: string; tokenUsage: unknown; characterUsage?: { inputCharacters: number } | null; billing?: ModelChargeReceipt[]; correctionAttempts: number; outputHash: string };
    validation: { passed: boolean; schema: string; code?: string; fallback?: "plain_text" };
  };
};

export async function runStudioAgent(input: {
  productionOptions?: StudioProductionOptions;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  content: string;
  context: StudioAgentContext;
  locale: StudioAgentLocale;
  modelSelection?: StudioAgentModelSelection;
  projectId: string;
  userId: string;
}): Promise<AsyncIterable<AgentEvent>> {
  const configuration = await resolveProductionConfiguration(input.userId, {
    projectId: input.projectId,
    episodeId: input.context.episodeId,
  });
  const contextScopes =
    configuration.agents[PROMPT_IDS.STUDIO_WORKFLOW_AGENT]?.contextScopes ??
    DEFAULT_STUDIO_AGENT_CONTEXT_SCOPES;
  const state = await loadAgentState({ ...input, contextScopes });
  return runStudioAgentEvents(input, state, configuration);
}

export async function previewStudioAgent(input: {
  content: string;
  context: StudioAgentContext;
  locale: StudioAgentLocale;
  modelSelection?: StudioAgentModelSelection;
  projectId: string;
  userId: string;
  draft?: ProductionConfigurationPatch;
}) {
  await assertConfigurationScope(input.userId, {
    projectId: input.projectId,
    episodeId: input.context.episodeId,
  });
  let configuration = await resolveProductionConfiguration(input.userId, {
    projectId: input.projectId,
    episodeId: input.context.episodeId,
  });
  if (input.draft) {
    const patch = await validateManagementConfiguration(input.userId, input.draft);
    if (patch.sound) throw new Error("Agent 试运行只接受 Agent 草稿");
    configuration = {
      ...mergeProductionConfigurations([configuration, patch]),
      defaultsVersion: configuration.defaultsVersion,
      format: "production-configuration-v1",
      sources: [...configuration.sources, {
        scopeKey: "test-draft",
        version: 0,
        fields: Object.entries(patch.agents ?? {}).flatMap(([id, agent]) =>
          Object.keys(agent).map((field) => `agents.${id}.${field}`),
        ),
      }],
    };
  }
  const contextScopes =
    configuration.agents[PROMPT_IDS.STUDIO_WORKFLOW_AGENT]?.contextScopes ??
    DEFAULT_STUDIO_AGENT_CONTEXT_SCOPES;
  const state = await loadAgentState({ ...input, contextScopes });
  const decision = await decideStudioAgentAction(input, state, configuration);
  const testRunId = randomUUID();
  const costEstimate = decision.testRun ? summarizeAgentTestRunCost(decision.testRun.trace.billing) : null;
  return {
    response: decision.reply,
    proposedOperation: decision.operation,
    targetId: decision.targetId,
    modelSelection: decision.modelSelection,
    testRun: decision.testRun ? { ...decision.testRun, id: testRunId, costEstimate } : null,
    configurationSources: configuration.sources,
    executed: false,
  };
}

async function* runStudioAgentEvents(
  input: {
    productionOptions?: StudioProductionOptions;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  content: string;
    context: StudioAgentContext;
    locale: StudioAgentLocale;
    modelSelection?: StudioAgentModelSelection;
    projectId: string;
    userId: string;
  },
  state: AgentState,
  configuration: ProductionConfigurationSnapshot,
): AsyncIterable<AgentEvent> {
  const decision = await decideStudioAgentAction(input, state, configuration);
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
  const canvasTarget =
    decision.operation === "update_canvas_prompt"
      ? canvasPromptTargets(state).find((node) => node.id === target.id)
      : undefined;
  const canvasDraft = canvasTarget
    ? {
        episodeId: canvasTarget.episodeId,
        revision: canvasTarget.revision,
        kind:
          canvasTarget.outputKind ??
          (canvasTarget.kind === "video"
            ? ("video" as const)
            : ("image" as const)),
        before:
          (canvasTarget.outputKind ??
            (canvasTarget.kind === "video" ? "video" : "image")) === "video"
            ? (canvasTarget.videoText ?? canvasTarget.text)
            : canvasTarget.text,
        after:
          "canvasPrompt" in decision &&
          typeof decision.canvasPrompt === "string"
            ? decision.canvasPrompt
            : "",
        inputSignature: canvasTarget.inputSignature,
      }
    : undefined;
  if (decision.operation === "update_canvas_prompt" && !canvasDraft?.after) {
    yield messageEvent(
      input.locale === "en"
        ? "No prompt draft was supplied. Please specify the changes."
        : "没有可写入的提示词草稿，请说明需要修改的内容。",
    );
    return;
  }
  const approvalId = encryptSecret(
    JSON.stringify({
      ...(decision.operation === "revise_screenplay" ||
      isProductionOperation(decision.operation)
        ? {
            channelId: decision.modelSelection?.channelId,
            failureContext: screenplayFailureContext,
            model: decision.modelSelection?.model,
            request: input.content.trim().slice(0, 8_000),
            productionOptions: decision.operation === "start_story_package_generation"
              ? { ...input.productionOptions, storySetup: resolveStorySetup({
                  options: input.productionOptions, request: input.content,
                  conversation: input.conversation, projectName: state.project.name,
                  artStyle: state.project.config?.artStyle,
                }) }
              : input.productionOptions,
          }
        : {}),
      expiresAt: Date.now() + APPROVAL_TTL_MS,
      locale: input.locale,
      messageId,
      operation: decision.operation,
      projectId: input.projectId,
      episodeId: state.episode?.id,
      targetId: target.id,
      targetLabel:
        "name" in target && typeof target.name === "string"
          ? target.name
          : "title" in target && typeof target.title === "string"
            ? target.title
            : undefined,
      ...(decision.operation === "start_asset_visual_design" && "kind" in target
        ? { assetKind: target.kind as "character" | "location" | "prop" }
        : {}),
      toolCallId,
      userId: input.userId,
      version: 1,
      ...(canvasDraft ? { canvasDraft } : {}),
    } satisfies ApprovalPayload),
  );
  const toolCall: AgentToolCall = {
    id: toolCallId,
    name: decision.operation,
    args: {
      confirmationMode: studioAgentConfirmationMode(decision.operation),
      context: {
        episodeId: state.episode?.id ?? null,
        projectId: state.project.id,
        selection: input.context.selection ?? null,
        stageId: input.context.stageId,
      },
      target: {
        id: target.id,
        status: "status" in target ? target.status : "draft",
        traceId: "traceId" in target ? target.traceId : undefined,
        type: isProductionOperation(decision.operation)
          ? decision.operation === "start_story_package_generation"
            ? "project"
            : decision.operation === "start_asset_visual_design"
              ? "asset"
              : decision.operation === "start_manuscript_analysis"
                ? "manuscript"
                : "episode"
          : decision.operation === "update_canvas_prompt"
            ? "canvas_node"
            : decision.operation === "revise_screenplay"
              ? "screenplay_clip"
              : decision.operation.includes("workflow")
                ? "workflow"
                : "media_task",
      },
      ...(isProductionOperation(decision.operation)
        ? {
            production: {
              target: "name" in target ? target.name : target.id,
              operation: operationLabel(decision.operation),
              model: decision.modelSelection?.model,
              note:
                decision.operation === "start_manuscript_analysis"
                  ? "分段提取原著资料并保存进度，草稿需要审核，不改写原文"
                  : decision.operation === "start_original_episode_generation"
                  ? "依据已采用策划与前集结尾续写；空白集同步制作草案，已有正文保存候选版本"
                  : decision.operation === "start_episode_adaptation"
                  ? "生成改编候选稿，保留原文"
                  : decision.operation === "start_story_package_generation"
                    ? "从零创作并保存完整策划包，包含第一集正文"
                    : decision.operation === "start_script_organization"
                      ? "整理当前生产稿，将重新保存场次与资产关联"
                      : decision.operation === "start_storyboard_generation"
                        ? "根据结构化剧本生成分镜；重跑会更新现有分镜"
                        : decision.operation === "start_asset_visual_design"
                          ? "生成并保存资产视觉设定；已有设定会更新"
                          : decision.operation === "start_episode_preproduction" ? "补齐本集缺失的整理、分镜与配音设计；已有结果保留，导演审核有问题时阻塞" : "分析并保存台词或配音设计；重跑会更新现有结果",
            },
          }
        : {}),
      ...(decision.operation === "revise_screenplay"
        ? {
            failureContext: screenplayFailureContext ?? null,
            request: input.content.trim().slice(0, 8_000),
          }
        : {}),
      ...(canvasDraft
        ? {
            before: canvasDraft.before,
            after: canvasDraft.after,
            revision: canvasDraft.revision,
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
  if (
    studioAgentConfirmationMode(approval.operation) === "automatic_read" ||
    (input.decision === "approved" &&
      !studioAgentApprovalGranted(approval.operation, input.decision))
  ) {
    throw new StudioAgentError("AGENT_APPROVAL_NOT_REQUIRED", 400);
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
  if (!studioAgentApprovalGranted(approval.operation, input.decision)) {
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
    const progressQueue = createAsyncQueue<AgentEvent>();
    const execution = executeOperation(approval, (progress) => {
      progressQueue.push({
        type: "tool.progress",
        messageId: approval.messageId,
        toolCallId: approval.toolCallId,
        ...progress,
      });
    }).finally(() => progressQueue.close());
    for await (const event of progressQueue) yield event;
    const result = await execution;
    yield {
      type: "tool.done",
      messageId: approval.messageId,
      toolCallId: approval.toolCallId,
      result,
    };
    yield messageEvent(
      isProductionOperation(approval.operation)
        ? approval.locale === "en"
          ? `The workflow for ${approval.targetLabel ?? "the selected target"} has been submitted. Follow its progress in Tasks.`
          : `已提交「${approval.targetLabel ?? "所选目标"}」的${operationLabel(approval.operation)}任务，可在任务栏查看进度。`
        : approval.locale === "en"
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
  if (/续写|continue.*episode|write.*episode/i.test(normalized)) return "start_original_episode_generation";
  if (/原著.*资料|小说.*资料|source.*dossier|manuscript.*analy/i.test(normalized) &&
      /建立|提取|分析|生成|整理|build|extract|analy|generate/i.test(normalized)) return "start_manuscript_analysis";
  if (
    /开始|启动|执行|生成|写|创作|编写|start|generate|write|create|run/i.test(
      normalized,
    )
  ) {
    if (
      /策划包|全剧策划|从零|原创|不需要原稿|不要原稿|没有原稿|直接写|完整故事|write.*from scratch|no manuscript|story package|original (?:story|series|drama)/i.test(
        normalized,
      )
    )
      return "start_story_package_generation";
    if (/场次.*整理|整理.*场次|资产.*整理|organize.*script/i.test(normalized))
      return "start_script_organization";
    if (/分镜|storyboard/i.test(normalized))
      return "start_storyboard_generation";
    if (/台词.*分析|分析.*台词|dialogue.*analysis/i.test(normalized))
      return "start_voice_analysis";
    if (/配音.*设计|设计.*配音|voice.*design/i.test(normalized))
      return "start_voice_design";
    if (/视觉.*设定|视觉.*设计|visual.*design/i.test(normalized))
      return "start_asset_visual_design";
    if (/前期制作|preproduction/i.test(normalized)) return "start_episode_preproduction";
    if (/改编|adapt/i.test(normalized)) return "start_episode_adaptation";
  }
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
  content?: string;
  context: StudioAgentContext;
  contextScopes: readonly StudioAgentContextScope[];
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
      config: {
        select: {
          artStyle: true,
          visualEra: true,
          visualEraCustom: true,
          videoRatio: true,
          videoResolution: true,
          episodeTargetDurationSeconds: true,
          workflowMode: true,
          analysisModel: true,
          characterModel: true,
          locationModel: true,
          storyboardModel: true,
          videoModel: true,
          audioModel: true,
        },
      },
      episodes: {
        where: input.context.episodeId
          ? { id: input.context.episodeId }
          : { id: "__no_current_episode__" },
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

  const [workflows, tasks, clips, assetContext, projectContext] =
    await Promise.all([
      input.contextScopes.includes("current_episode") && episode
        ? listWorkflowRuns(input.userId, input.projectId, 100, episode.id)
        : Promise.resolve([]),
      input.contextScopes.includes("current_episode") && episode
        ? createDatabaseMediaTaskStore(input.userId).list({
        projectId: input.projectId,
        episodeId: episode.id,
        limit: 100,
      })
        : Promise.resolve([]),
      input.contextScopes.includes("current_episode") && episode
        ? prisma.storyClip.findMany({
        where: {
          projectId: input.projectId,
          project: { userId: input.userId },
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
      })
        : Promise.resolve([]),
      input.contextScopes.includes("character_assets")
        ? loadAgentAssetContext({
        userId: input.userId,
        projectId: input.projectId,
        selection: input.contextScopes.includes("selected_shot")
          ? input.context.selection
          : undefined,
        artStyle: project.config?.artStyle,
      })
        : Promise.resolve(null),
      loadAgentProjectContext({
        userId: input.userId,
        projectId: input.projectId,
        episodeId: episode?.id,
        selectionId: input.context.selection?.id,
        request: input.content ?? "",
        contextScopes: input.contextScopes,
        artStyle: project.config?.artStyle,
      }),
    ]);
  const relevantWorkflows = workflows;
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
  const canvasRow =
    episode &&
    input.contextScopes.includes("selected_shot") &&
    input.context.view === "canvas"
      ? await prisma.creativeCanvas.findUnique({
          where: { episodeId: episode.id },
        })
      : null;
  const canvasDocument = canvasDocumentSchema.safeParse(canvasRow?.document);
  const canvasNode = canvasDocument.success
    ? canvasDocument.data.nodes.find(
        (node) => node.id === input.context.canvasNodeId,
      )
    : undefined;
  const selectedAsset = canvasNode?.assetId
    ? await prisma.mediaAsset.findFirst({
        where: {
          id: canvasNode.assetId,
          task: { userId: input.userId, projectId: input.projectId },
        },
        select: {
          kind: true,
          url: true,
          storageKey: true,
          task: { select: { status: true } },
        },
      })
    : null;
  const canvasContext =
    canvasNode && canvasDocument.success
      ? {
          revision: canvasRow!.revision,
          selectedNode: canvasNode,
          role: ["character", "location", "prop"].includes(canvasNode.kind)
            ? "reference_asset"
            : ["panel", "image", "video"].includes(canvasNode.kind)
              ? "generation"
              : "content",
          selectedMedia: {
            selected: Boolean(canvasNode.assetId),
            found: Boolean(selectedAsset),
            kind: selectedAsset?.kind ?? null,
            ready: Boolean(
              selectedAsset &&
              selectedAsset.task.status === "succeeded" &&
              (selectedAsset.url || selectedAsset.storageKey),
            ),
          },
          usedBy: canvasDocument.data.edges
            .filter((edge) => edge.from === canvasNode.id)
            .flatMap((edge) => {
              const target = canvasDocument.data.nodes.find(
                (node) => node.id === edge.to,
              );
              return target
                ? [
                    {
                      title: target.title,
                      kind: target.kind,
                      purpose: canvasEdgePurpose(edge, canvasNode),
                    },
                  ]
                : [];
            }),
          inputs: compileCanvasInput(
            canvasDocument.data,
            canvasNode,
            canvasNode.outputKind ??
              (canvasNode.kind === "video" ? "video" : "image"),
          ).inputs,
        }
      : null;
  return applyStudioAgentContextScopes({
    projectContext,
    asset: assetContext,
    canvas: canvasContext,
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
    contextScopes: input.contextScopes,
    episode,
    project,
    tasks,
    workflows: relevantWorkflows,
  }, input.contextScopes);
}

function canvasPromptTargets(state: AgentState) {
  return state.projectContext.episodes.flatMap((episode) =>
    episode.canvas
      ? episode.canvas.nodes
          .filter((node) => ["panel", "image", "video"].includes(node.kind))
          .map((node) => ({
            ...node,
            episodeId: episode.id,
            episodeName: episode.name,
            revision: episode.canvas!.revision,
            inputSignature: canvasPromptInputSignature(episode.canvas!, node),
          }))
      : [],
  );
}

function canvasPromptInputSignature(
  document: Pick<CanvasDocument, "nodes" | "edges">,
  node: CanvasCard,
) {
  const kind = node.outputKind ?? (node.kind === "video" ? "video" : "image");
  const inputs = document.edges
    .filter((edge) => edge.to === node.id)
    .map((edge) => {
      const source = document.nodes.find((item) => item.id === edge.from);
      if (!source) return JSON.stringify({ from: edge.from, missing: true });
      const purpose = canvasEdgePurpose(edge, source);
      return JSON.stringify({
        from: source.id,
        purpose,
        kind: source.kind,
        ...(purpose === "context"
          ? { title: source.title, text: source.text }
          : {
              assetId: source.assetId ?? null,
              panelId: source.panelId ?? null,
              entityId: source.entityId ?? null,
            }),
      });
    })
    .sort();
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind,
        nodeKind: node.kind,
        panelId: node.panelId ?? null,
        modelId: node.modelId ?? null,
        inputs,
      }),
    )
    .digest("hex");
}

function findOperationTarget(
  state: AgentState,
  operation: StudioAgentOperation,
  requestedTargetId?: string,
) {
  const selectionId = state.context.selection?.id;
  if (operation === "start_manuscript_analysis") {
    const manuscripts = state.projectContext.manuscripts;
    return requestedTargetId ? manuscripts.find(item => item.id === requestedTargetId) :
      manuscripts.find(item => item.id === selectionId) ?? (manuscripts.length === 1 ? manuscripts[0] : undefined);
  }
  if (operation === "read_project_object") {
    return [
      ...state.projectContext.episodeIndex,
      ...state.projectContext.assets,
      ...state.projectContext.objectIndex,
      ...state.projectContext.deliverables,
      ...state.projectContext.media,
      ...state.projectContext.manuscripts,
    ].find((item) => item.id === requestedTargetId);
  }
  if (isProductionOperation(operation)) {
    if (operation === "start_original_episode_generation") {
      const id = requestedTargetId ?? state.episode?.id;
      return state.projectContext.episodeIndex.find(item => item.id === id && item.canContinueOriginal);
    }
    if (operation === "start_story_package_generation")
      return !requestedTargetId || requestedTargetId === state.project.id
        ? state.project
        : undefined;
    if (operation === "start_asset_visual_design") {
      const id = requestedTargetId ?? selectionId;
      return state.projectContext.assets.find((asset) => asset.id === id);
    }
    const id = requestedTargetId ?? state.episode?.id;
    return state.projectContext.episodeIndex.find(
      (episode) =>
        episode.id === id &&
        episode.hasScript &&
        (operation !== "start_storyboard_generation" ||
          episode.hasStructuredScript) &&
        (operation !== "start_voice_design" || episode.voiceLineCount > 0),
    );
  }
  if (operation === "update_canvas_prompt") {
    const id =
      requestedTargetId ?? state.canvas?.selectedNode.id ?? selectionId;
    return canvasPromptTargets(state).find((node) => node.id === id);
  }
  if (operation === "revise_screenplay") {
    return selectScreenplayRevisionClip(
      requestedTargetId
        ? state.clips
        : state.clips.filter((clip) => clip.episodeId === state.episode?.id),
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
    productionOptions?: StudioProductionOptions;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
  content: string;
    locale: StudioAgentLocale;
    modelSelection?: StudioAgentModelSelection;
    userId: string;
  },
  state: AgentState,
  configuration: ProductionConfigurationSnapshot,
): Promise<StudioAgentDecision> {
  const configuredAgent = configuration.agents[PROMPT_IDS.STUDIO_WORKFLOW_AGENT];
  const disabled = configuredAgent?.disabledOperations ?? [];
  const temperature = configuredAgent?.temperature ?? 0.55;
  const provider = await resolveStudioAgentProvider({ ...input,
    modelSelection: configuredAgent?.channelId && configuredAgent.model ? { channelId: configuredAgent.channelId, model: configuredAgent.model } : input.modelSelection }, state);
  if (!provider) {
    const decision = deterministicStudioAgentDecision(input, state);
    return decision.operation && !isStudioAgentOperationEnabled(decision.operation, disabled) ? { ...decision, operation: null, targetId: null } : decision;
  }
  const retrievedIds: string[] = [];
  const receipts: ModelChargeReceipt[] = [];
  let result: Awaited<
    ReturnType<
      typeof requestOpenAiStructured<
        ReturnType<typeof studioWorkflowAgentSchema.parse>
      >
    >
  >;
  let testRun: StudioAgentDecision["testRun"];
  for (let retrieval = 0; ; retrieval++) {
    const candidates = filterStudioAgentOperationCandidates(buildOperationCandidates(state), disabled);
    candidates.read_project_object = candidates.read_project_object.filter(
      (item) => !retrievedIds.includes(item.id),
    );
    if (retrieval >= 3) candidates.read_project_object = [];
    const prompt = renderPrompt({
      id: PROMPT_IDS.STUDIO_WORKFLOW_AGENT,
      locale: input.locale === "en" ? "en" : "zh",
      variables: {
        state_json: serializeBudgetedContext({ ...buildModelState(state, input.content), conversation: input.conversation ?? [], productionOptions: input.productionOptions }),
        operation_candidates_json: serializeBudgetedContext(candidates, 12_000),
        user_request: input.content.trim(),
      },
    });
    try {
      result = await withProductionConfiguration(input.userId, configuration, () => requestOpenAiStructured({
        baseUrl: provider.baseUrl,
        billing: { userId: input.userId, projectId: state.project.id, episodeId: state.episode?.id },
        channelId: provider.channelId,
        apiKeys: provider.apiKeys,
        model: provider.model,
        prompt,
        schema: studioWorkflowAgentSchema,
        normalizeRaw: normalizeStudioWorkflowAgentResponse,
        structuredOutputMode: provider.structuredOutputMode,
        temperature,
        ...provider.requestOptions,
      }));
    } catch (error) {
      if (!(error instanceof StructuredOutputError)) throw error;
      const fallback = studioAgentPlainTextFallback(error.rawText);
      if (!fallback) throw error;
      const failureTrace = error.executionTrace;
      testRun = {
        request: {
          channelId: failureTrace?.channelId ?? provider.channelId,
          model: failureTrace?.model ?? provider.model,
          structuredOutputMode: failureTrace?.structuredOutputMode ?? provider.structuredOutputMode ?? "json_object",
          temperature,
          systemText: prompt.systemText,
          userText: prompt.text,
        },
        trace: {
          model: failureTrace?.model ?? provider.model,
          channelId: failureTrace?.channelId ?? provider.channelId,
          tokenUsage: failureTrace?.tokenUsage ?? null,
          characterUsage: failureTrace?.characterUsage,
          billing: [...receipts, ...(failureTrace?.billing ?? [])],
          correctionAttempts: failureTrace?.correctionAttempts ?? 0,
          outputHash: failureTrace?.outputHash ?? createHash("sha256").update(fallback.reply).digest("hex"),
        },
        validation: { passed: false, schema: "studioWorkflowAgentSchema", code: error.code, fallback: "plain_text" },
      };
      return {
        reply: fallback.reply,
        operation: fallback.operation,
        targetId: fallback.targetId,
        modelSelection: { channelId: failureTrace?.channelId ?? provider.channelId, model: failureTrace?.model ?? provider.model },
        testRun,
      };
    }
    receipts.push(...(result.trace.billing ?? []));
    testRun = {
      request: {
        channelId: result.trace.channelId,
        model: result.trace.model,
        structuredOutputMode: result.trace.structuredOutputMode,
        temperature,
        systemText: prompt.systemText,
        userText: prompt.text,
      },
      trace: {
        model: result.trace.model,
        channelId: result.trace.channelId,
        tokenUsage: result.trace.tokenUsage,
        characterUsage: result.trace.characterUsage,
        billing: [...receipts],
        correctionAttempts: result.trace.correctionAttempts,
        outputHash: result.trace.outputHash,
      },
      validation: { passed: true, schema: "studioWorkflowAgentSchema" },
    };
    if (result.data.operation && !isStudioAgentOperationEnabled(result.data.operation, disabled)) return { reply: input.locale === "en" ? "This operation is disabled in the published Agent settings." : "当前已发布的 Agent 设置已停用该操作。", operation: null, targetId: null, modelSelection: { channelId: result.trace.channelId ?? provider.channelId, model: result.trace.model }, testRun };
    if (result.data.operation !== "read_project_object") break;
    const targetId = result.data.targetId;
    if (
      !targetId ||
      retrieval >= 3 ||
      retrievedIds.includes(targetId) ||
      !findOperationTarget(state, "read_project_object", targetId)
    ) {
      return { reply: result.data.reply, operation: null, targetId: null, modelSelection: { channelId: result.trace.channelId ?? provider.channelId, model: result.trace.model }, testRun };
    }
    retrievedIds.push(targetId);
    const expandedContext = await loadAgentProjectContext({
      userId: input.userId,
      projectId: state.project.id,
      episodeId: state.episode?.id,
      selectionId: state.context.selection?.id,
      request: input.content,
      artStyle: state.project.config?.artStyle,
      detailIds: retrievedIds,
    });
    state.projectContext = applyStudioAgentContextScopes(
      { ...state, projectContext: expandedContext },
      state.contextScopes,
    ).projectContext;
  }
  const decision = {
    ...result.data,
    modelSelection: {
      channelId: result.trace.channelId ?? provider.channelId,
      model: result.trace.model,
    },
    testRun,
  };
  if (!decision.operation && !decision.targetId) return decision;
  if (!decision.operation || !decision.targetId)
    return {
      reply: decision.reply,
      operation: null,
      targetId: null,
      testRun,
    };
  const target = findOperationTarget(
    state,
    decision.operation,
    decision.targetId,
  );
  return target
    ? decision
    : {
        reply:
          input.locale === "en"
            ? `${decision.reply}\n\nThe proposed target is not eligible in the current stage, so no action was created.`
            : `${decision.reply}\n\n模型选择的目标不属于当前阶段可操作候选，因此未创建操作。`,
        operation: null,
        targetId: null,
        testRun,
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
      channel: accessibleChannelWhere(input.userId),
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
  if (
    operation === "revise_screenplay" ||
    (operation && isProductionOperation(operation))
  )
    return {
      reply:
        input.locale === "en"
          ? operation === "start_story_package_generation"
            ? "Select a configured Agent model before generating the complete story package."
            : "Select a configured Agent model before requesting a screenplay revision."
          : operation === "start_story_package_generation"
            ? "请先选择可用的导演分析模型，再生成完整策划包。"
            : "请先选择可用的导演分析模型，再提交剧本修改。",
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

type StudioOperationCandidate = { id: string; [key: string]: unknown };
function buildOperationCandidates(
  state: AgentState,
): Record<string, StudioOperationCandidate[]> {
  const candidates = Object.fromEntries<StudioOperationCandidate[]>(
    (
      [
        "cancel_media_task",
        "cancel_workflow",
        "pause_workflow",
        "resume_workflow",
        "revise_screenplay",
        "retry_media_task",
        "retry_workflow",
        "update_canvas_prompt",
        "read_project_object",
        ...STUDIO_PRODUCTION_OPERATIONS,
      ] as StudioAgentOperation[]
    ).map((operation) => [
      operation,
      operation === "read_project_object"
        ? [
            ...state.projectContext.episodeIndex.map((item) => ({
              id: item.id,
              name: item.name,
              kind: "episode",
            })),
            ...state.projectContext.assets.map((item) => ({
              id: item.id,
              name: item.name,
              kind: item.kind,
            })),
            ...state.projectContext.objectIndex,
            ...state.projectContext.deliverables.map((item) => ({
              id: item.id,
              name: item.title,
              kind: "deliverable",
            })),
            ...state.projectContext.media.map((item) => ({
              id: item.id,
              name: `${item.kind} 素材`,
              kind: "media",
            })),
            ...state.projectContext.manuscripts.map((item) => ({
              id: item.id,
              name: item.title,
              kind: "manuscript",
            })),
          ]
        : isProductionOperation(operation)
          ? operation === "start_manuscript_analysis" ? state.projectContext.manuscripts.map(item => ({ id: item.id, name: item.title, kind: "manuscript" })) : operation === "start_story_package_generation"
            ? [
                {
                  id: state.project.id,
                  name: state.project.name,
                  kind: "project",
                },
              ]
            : (operation === "start_asset_visual_design"
                ? state.projectContext.assets
                : state.projectContext.episodeIndex
              )
                .filter((item) =>
                  findOperationTarget(state, operation, item.id),
                )
                .map((item) => ({
                  id: item.id,
                  name: item.name,
                  ...("kind" in item
                    ? { kind: item.kind }
                    : { number: item.number }),
                }))
          : operation === "update_canvas_prompt"
            ? canvasPromptTargets(state).map((node) => ({
                id: node.id,
                title: node.title,
                episode: node.episodeName,
                revision: node.revision,
                text: node.text,
                videoText: node.videoText,
                outputKind: node.outputKind,
                promptVersions: node.promptVersions ?? [],
              }))
            : operation === "revise_screenplay"
              ? state.clips
                  .filter((clip) =>
                    findOperationTarget(state, operation, clip.id),
                  )
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
                    .filter((task) =>
                      findOperationTarget(state, operation, task.id),
                    )
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
  const scopes = new Set(state.contextScopes);
  if (!scopes.has("project_materials")) {
    candidates.start_manuscript_analysis = [];
    candidates.start_story_package_generation = [];
    candidates.read_project_object = (candidates.read_project_object ?? []).filter(
      (item) => !["manuscript", "deliverable"].includes(String(item.kind)),
    );
  }
  if (!scopes.has("current_episode")) {
    for (const operation of [
      "start_script_organization", "start_storyboard_generation", "start_voice_analysis",
      "start_voice_design", "start_episode_adaptation", "start_episode_preproduction",
      "start_original_episode_generation", "revise_screenplay", "cancel_media_task",
      "cancel_workflow", "pause_workflow", "resume_workflow", "retry_media_task",
      "retry_workflow",
    ]) candidates[operation] = [];
  }
  if (!scopes.has("character_assets")) {
    candidates.start_asset_visual_design = [];
    candidates.read_project_object = (candidates.read_project_object ?? []).filter(
      (item) => !["character", "location", "prop", "media"].includes(String(item.kind)),
    );
  }
  if (!scopes.has("selected_shot")) {
    candidates.update_canvas_prompt = [];
    candidates.read_project_object = (candidates.read_project_object ?? []).filter(
      (item) => !["shot", "canvas_node"].includes(String(item.kind)),
    );
  }
  return candidates;
}

function buildModelState(state: AgentState, request: string) {
  const node = state.canvas?.selectedNode;
  const focused =
    Boolean(node || state.asset) &&
    !/(整集|整个|项目|其他剧集|上一集|下一集|全部|所有|全局|制作进度|阶段进度|失败任务|工作流|all (?:tasks|shots|nodes)|whole (?:episode|project)|production (?:status|progress)|workflow)/i.test(
      request,
    );
  const targetIds = new Set(
    [
      node?.id,
      node?.panelId,
      node?.entityId,
      state.context.selection?.id,
    ].filter(Boolean),
  );
  return {
    scope: focused ? "selection" : "episode",
    projectData: state.projectContext,
    executionCoverage: {
      recentWorkflowLimit: 100,
      recentMediaTaskLimit: 100,
      clipLimit: 200,
    },
    asset: state.asset,
    canvas: state.canvas
      ? {
          selectedNode: {
            title: state.canvas.selectedNode.title,
            kind: state.canvas.selectedNode.kind,
            text: state.canvas.selectedNode.text,
            videoText: state.canvas.selectedNode.videoText,
            outputKind: state.canvas.selectedNode.outputKind,
            promptVersions: state.canvas.selectedNode.promptVersions,
          },
          role: state.canvas.role,
          selectedMedia: state.canvas.selectedMedia,
          usedBy: state.canvas.usedBy,
          productionDefaultsMayApply: Boolean(node?.panelId),
          inputs: state.canvas.inputs.map((item) => ({
            title: item.source.title,
            kind: item.source.kind,
            purpose: item.purpose,
            problem:
              canvasConnectionError(
                item.source,
                state.canvas!.selectedNode,
                item.purpose,
              ) || null,
          })),
        }
      : null,
    context: {
      view: state.context.view,
      stageId: state.context.stageId,
      selection: state.context.selection
        ? {
            label: state.context.selection.label,
            kind: state.context.selection.kind,
          }
        : null,
    },
    clips: (focused ? [] : state.clips).map((clip) => ({
      clipIndex: clip.clipIndex,
      failureCategory: clip.failureCategory,
      failureContext: clip.failureContext ?? null,
      hasScreenplay: Boolean(clip.screenplay),
      id: clip.id,
      status: clip.status,
      summary: clip.summary,
    })),
    episode: state.episode ?? null,
    project: {
      id: state.project.id,
      name: state.project.name,
      settings: state.project.config,
    },
    tasks: state.tasks
      .filter((task) => !focused || targetIds.has(task.targetId))
      .map((task) => ({
        id: task.id,
        error: task.error ?? null,
        kind: task.kind,
        status: task.status,
        targetId: task.targetId ?? null,
        targetType: task.targetType ?? null,
        traceId: task.traceId,
        updatedAt: task.updatedAt,
      })),
    workflows: (focused ? [] : state.workflows).map((workflow) => ({
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
    return (
      item.payload.success === false || typeof item.payload.error === "string"
    );
  });
  const workflow = artifact
    ? workflows.find((item) => item.id === artifact.runId)
    : workflows.find((item) =>
        JSON.stringify(item.error ?? {}).includes(clipId),
      );
  if (!artifact && !workflow) return undefined;
  const payload =
    artifact && isRecord(artifact.payload) ? artifact.payload : {};
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

async function executeOperation(
  approval: ApprovalPayload,
  onProgress?: (progress: {
    delta?: string;
    resetText?: boolean;
    status?: string;
    totalCharacters?: number;
  }) => void,
) {
  const scope = { projectId: approval.projectId, episodeId: approval.episodeId ?? approval.canvasDraft?.episodeId };
  await assertConfigurationScope(approval.userId, scope);
  const configuration = await resolveProductionConfiguration(approval.userId, scope);
  const configuredAgent = configuration.agents[PROMPT_IDS.STUDIO_WORKFLOW_AGENT];
  if (!isStudioAgentOperationEnabled(approval.operation, configuredAgent?.disabledOperations))
    throw new StudioAgentError("该操作已在 Agent 设置中停用，请更新设置后重新申请操作", 403);
  const allowedScopes = new Set(
    configuredAgent?.contextScopes ?? DEFAULT_STUDIO_AGENT_CONTEXT_SCOPES,
  );
  if (requiredAgentContextScopes(approval.operation).some((item) => !allowedScopes.has(item)))
    throw new StudioAgentError("当前 Agent 配置不允许读取该范围，未执行操作", 403);
  if (approval.operation === "read_project_object")
    throw new StudioAgentError("读取项目资料无需审批，请重新发送问题");
  if (isProductionOperation(approval.operation)) {
    if (!approval.channelId || !approval.model)
      throw new StudioAgentError("请选择可用的导演分析模型");
    return startStudioProductionAction({
      operation: approval.operation,
      userId: approval.userId,
      projectId: approval.projectId,
      targetId: approval.targetId,
      channelId: approval.channelId,
      model: approval.model,
      locale: approval.locale === "en" ? "en" : "zh",
      request: approval.request,
      options: approval.productionOptions,
      onProgress,
      assetKind: approval.assetKind,
    });
  }
  if (approval.operation === "update_canvas_prompt") {
    const draft = approval.canvasDraft;
    if (!draft) throw new StudioAgentError("画布草稿上下文缺失");
    const owned = await prisma.episode.count({
      where: {
        id: draft.episodeId,
        projectId: approval.projectId,
        project: { userId: approval.userId },
      },
    });
    if (!owned) throw new StudioAgentError("剧集不存在", 404);
    for (let attempt = 0; attempt < 5; attempt++) {
      const canvas = await prisma.creativeCanvas.findUnique({
        where: { episodeId: draft.episodeId },
      });
      if (!canvas)
        throw new StudioAgentError("画布已删除，无法写入提示词", 404);
      const document = canvasDocumentSchema.parse(canvas.document);
      const node = document.nodes.find((node) => node.id === approval.targetId);
      if (!node)
        throw new StudioAgentError("目标节点已删除，请重新选择节点", 404);
      const kind =
        node.outputKind ?? (node.kind === "video" ? "video" : "image");
      if (
        kind !== draft.kind ||
        !["panel", "image", "video"].includes(node.kind)
      )
        throw new StudioAgentError(
          "目标节点的生成类型已改变，请让助手按当前类型重新修改",
          409,
        );
      const currentPrompt =
        kind === "video" ? (node.videoText ?? node.text) : node.text;
      if (currentPrompt !== draft.before)
        throw new StudioAgentError(
          "该节点的提示词已被修改，为保留最新内容未覆盖；请让助手基于当前提示词重新修改",
          409,
        );
      if (draft.inputSignature) {
        if (canvasPromptInputSignature(document, node) !== draft.inputSignature)
          throw new StudioAgentError(
            "该节点的引用素材、连线用途、模型或关联镜头已变更，请让助手按当前输入重新修改",
            409,
          );
      } else if (canvas.revision !== draft.revision) {
        throw new StudioAgentError(
          "这条旧修改建议缺少节点校验信息，请重新提出修改",
          409,
        );
      }
      const next = canvasDocumentSchema.parse({
        ...document,
        nodes: document.nodes.map((item) =>
          item.id === node.id
            ? {
                ...item,
                ...(draft.kind === "video"
                  ? { videoText: draft.after }
                  : { text: draft.after }),
                promptVersions: [
                  ...(item.promptVersions ?? []),
                  {
                    id: createId("prompt"),
                    kind: draft.kind,
                    prompt: currentPrompt,
                    createdAt: new Date().toISOString(),
                  },
                ].slice(-12),
              }
            : item,
        ),
      });
      const result = await prisma.creativeCanvas.updateMany({
        where: { episodeId: draft.episodeId, revision: canvas.revision },
        data: { document: next, revision: { increment: 1 } },
      });
      if (!result.count) continue;
      return {
        action: approval.operation,
        nodeId: node.id,
        revision: canvas.revision + 1,
        before: currentPrompt,
        after: draft.after,
        nextStep: "在画布中审核后确认生成",
      };
    }
    throw new StudioAgentError(
      "画布正在连续保存，本次修改未写入；请保存完成后重新提出修改",
      409,
    );
  }
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
      ...(approval.operation === "cancel_media_task" && task.cancellationPolicy
        ? { cancellationPolicy: task.cancellationPolicy }
        : {}),
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

function requiredAgentContextScopes(
  operation: StudioAgentOperation,
): StudioAgentContextScope[] {
  if (operation === "start_manuscript_analysis" || operation === "start_story_package_generation")
    return ["project_materials"];
  if (operation === "start_asset_visual_design") return ["character_assets"];
  if (operation === "update_canvas_prompt") return ["current_episode", "selected_shot"];
  if (operation === "read_project_object") return [];
  return ["current_episode"];
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
  if (state.asset) {
    const asset = state.asset;
    return locale === "en"
      ? `${asset.name}'s saved asset prompt is available${asset.visualProfile ? " with its visual specification" : ""}. ${asset.selectedImageReady ? "The reference image is selected." : "No available reference image is selected."}\n\nChoose an analysis model to review the prompt and receive specific suggestions.`
      : `已读取「${asset.name}」的生图提示词${asset.visualProfile ? "和视觉设定" : ""}。${asset.selectedImageReady ? "参考图已选好。" : "还没有选定可用参考图，这不影响检查提示词。"}\n\n选择导演分析模型后，可以直接检查这些内容并获得具体修改建议。`;
  }
  if (state.canvas?.role === "reference_asset") {
    const { selectedNode, selectedMedia, usedBy } = state.canvas;
    const ready = selectedMedia.ready && selectedMedia.kind === "image";
    const names = usedBy
      .slice(0, 3)
      .map((item) => item.title)
      .join(locale === "en" ? ", " : "、");
    if (locale === "en")
      return [
        ready
          ? `${selectedNode.title}'s reference image is ready.`
          : `${selectedNode.title} needs an available reference image.`,
        usedBy.length
          ? `Used by: ${names}${usedBy.length > 3 ? ` and ${usedBy.length - 3} more nodes` : ""}.`
          : "No canvas node uses this asset yet. This is not an error.",
        ready
          ? "Next: connect the asset to a shot that should use it."
          : "Next: choose a completed image version in the asset editor.",
      ].join("\n\n");
    return [
      ready
        ? `「${selectedNode.title}」的参考图已就绪。`
        : `「${selectedNode.title}」还需要选择一张可用参考图。`,
      usedBy.length
        ? `目前被${names}${usedBy.length > 3 ? `等 ${usedBy.length} 个节点` : ""}引用。`
        : "目前还没有画布节点引用它，尚未使用不代表出错。",
      ready
        ? "下一步：把它连到需要使用该资产的镜头，选择对应的参考用途。"
        : "下一步：在资产编辑里选择一个已完成的图片版本。",
    ].join("\n\n");
  }
  const running = state.tasks.filter((task) =>
    ["queued", "running"].includes(task.status),
  ).length;
  const failed = state.tasks.filter((task) => task.status === "failed").length;
  const completed = state.tasks.filter(
    (task) => task.status === "succeeded",
  ).length;
  const workflow = state.workflows[0];
  const selection = state.context.selection?.label;
  const statusNames: Record<string, string> = {
    succeeded: "已完成",
    failed: "失败",
    blocked: "待处理",
    running: "进行中",
    queued: "排队中",
    paused: "已暂停",
    canceled: "已取消",
    canceling: "取消中",
  };
  const workflowName =
    workflow?.workflowType === "story-to-script"
      ? "剧本整理"
      : workflow?.workflowType === "script-to-storyboard"
        ? "分镜制作"
        : "制作流程";
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
      ? `${workflowName}：${statusNames[workflow.status] ?? "状态待确认"}。`
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
    read_project_object: "读取项目资料",
    start_script_organization: "AI 场次与资产整理",
    start_storyboard_generation: "分镜生成",
    start_voice_analysis: "台词分析",
    start_voice_design: "配音表演设计",
    start_episode_adaptation: "忠实剧本改编",
    start_asset_visual_design: "资产视觉设计",
    start_story_package_generation: "完整策划包生成",
    start_episode_preproduction: "本集前期制作",
    start_manuscript_analysis: "建立原著改编资料",
    start_original_episode_generation: "续写原创本集正文",
    cancel_media_task: "取消媒体任务",
    cancel_workflow: "取消工作流",
    pause_workflow: "暂停工作流",
    resume_workflow: "恢复工作流",
    revise_screenplay: "修改剧本",
    retry_media_task: "重试媒体任务",
    retry_workflow: "重试工作流",
    update_canvas_prompt: "修改画布提示词草稿",
  };
  return labels[operation];
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

function createAsyncQueue<T>() {
  const values: T[] = [];
  let closed = false;
  let resolveNext: ((result: IteratorResult<T>) => void) | undefined;

  return {
    push(value: T) {
      if (closed) return;
      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = undefined;
        resolve({ done: false, value });
      } else {
        values.push(value);
      }
    },
    close() {
      closed = true;
      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = undefined;
        resolve({ done: true, value: undefined });
      }
    },
    async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
      while (true) {
        if (values.length) {
          yield values.shift()!;
          continue;
        }
        if (closed) return;
        const next = await new Promise<IteratorResult<T>>((resolve) => {
          resolveNext = resolve;
        });
        if (next.done) return;
        yield next.value;
      }
    },
  };
}
