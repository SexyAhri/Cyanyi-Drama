import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { ConfigurationError } from "./store";
import {
  resolveProductionRequestConfiguration,
  productionConfigurationFingerprint,
} from "./execution";
import { configurationSnapshotSchema, soundPolicyAudioMode } from "./contract";
import { createOrReuseWorkflowRun, getWorkflowRun } from "@/lib/workflow/store";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import { createMediaTask } from "@/lib/media/task-contract";
import { enqueuePersistedMediaTask } from "@/lib/media/task-submit";
import {
  createStoryboardPanelVideoTask,
  previewStoryboardPanelPrompt,
} from "@/lib/media/project-asset-tasks";
import { createVoiceLineAudioTask, prepareVoiceLineAudioTask, voiceRequestFingerprint } from "@/lib/media/voice-tasks";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { lockVideoAudioPerformance } from "@/lib/media/director-prompt-locks";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { isMediaChannelProtocol } from "@/lib/providers/media/registry";
import { normalizeVideoProductionParameters, resolveVideoProductionCapabilities, videoProductionIssues } from "@/lib/media/video-production-capabilities";
import { resolveVideoVoiceReferences } from "@/lib/media/video-voice-references";

export const regenerationRequestSchema = z
  .object({
    kind: z.enum(["workflow", "media"]),
    id: z.string().min(1).max(200),
    preview: z.boolean(),
    token: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    idempotencyKey: z.string().uuid().optional(),
  })
  .strict();
export type RegenerationRequest = z.infer<typeof regenerationRequestSchema>;
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function confirm(input: RegenerationRequest, token: string) {
  if (!input.idempotencyKey || input.token !== token)
    throw new ConfigurationError("重新生成预览已变化，请重新预览并确认", 409);
}
function cleanExecutionInput(input: Record<string, unknown> = {}) {
  const result = { ...input };
  for (const key of [
    "productionConfiguration",
    "panelSoundConfigurations",
    "concurrency",
    "providerTaskId",
    "generationId",
    "generationIteration",
    "videoSegmentId",
    "videoSegmentIndex",
    "videoSegmentCount",
    "videoSegmentStartSeconds",
    "videoSegmentEndSeconds",
    "canvasDeferredSelection",
    "canvasGenerationId",
    "referenceAudios",
    "productionCapabilities",
  ])
    delete result[key];
  return result;
}

export async function regenerateWithPublishedConfiguration(
  userId: string,
  input: RegenerationRequest,
) {
  if (input.kind === "workflow") {
    const prior = await getWorkflowRun(userId, input.id);
    if (!prior) throw new ConfigurationError("工作流不存在", 404);
    if (["queued", "running", "paused", "canceling"].includes(prior.status))
      throw new ConfigurationError(
        "请先停止当前工作流，再使用新配置重新生成",
        409,
      );
    const snapshot = await resolveProductionRequestConfiguration(userId, {
      projectId: prior.projectId,
      episodeId: prior.episodeId,
      ...(prior.targetType === "storyboard_panel"
        ? { panelId: prior.targetId }
        : {}),
    });
    const version =
      typeof prior.input?.executionVersion === "number"
        ? prior.input.executionVersion + 1
        : 2;
    const token = digest({
      id: prior.id,
      updatedAt: prior.updatedAt,
      input: prior.input,
      steps: prior.steps.map((step) => ({
        key: step.key,
        input: step.input,
        dependsOn: step.dependsOn,
      })),
      snapshot,
    });
    const preview = {
      token,
      kind: "workflow",
      target: prior.targetId ?? prior.projectId,
      count: prior.steps.length,
      steps: prior.steps.map((step) => step.key),
      executionVersion: version,
      configuration: snapshot,
      previousConfiguration: prior.input?.productionConfiguration,
      description:
        "重新执行整条工作流，创建新运行和步骤；原运行、检查点和产物保留。新模型请求可能产生费用。",
    };
    if (input.preview) return { preview };
    confirm(input, token);
    const id = `workflow_regenerated_${digest({ userId, source: prior.id, key: input.idempotencyKey })}`;
    const existing = await getWorkflowRun(userId, id);
    if (existing) return { workflow: existing, reused: true };
    const result = await createOrReuseWorkflowRun({
      id,
      userId,
      projectId: prior.projectId,
      episodeId: prior.episodeId,
      workflowType: prior.workflowType,
      targetType: prior.targetType,
      targetId: prior.targetId,
      expectedConfigurationHash: productionConfigurationFingerprint(snapshot),
      input: {
        ...cleanExecutionInput(prior.input),
        regeneratedFromRunId: prior.id,
        executionVersion: version,
      },
      steps: prior.steps.map((step) => ({
        key: step.key,
        type: step.type,
        input: cleanExecutionInput(step.input),
        dependsOn: step.dependsOn,
        artifactTypes: step.artifactTypes,
        maxAttempts: step.maxAttempts,
        retryable: step.retryable,
        failureMode: "fail_run",
      })),
    });
    if (!result || result.reused)
      throw new ConfigurationError(
        "相同范围已有进行中的工作流，请刷新后检查",
        409,
      );
    try {
      await enqueueWorkflowJob({
        runId: id,
        userId,
        projectId: prior.projectId,
        maxAttempts: 1,
      });
    } catch (error) {
      await prisma.workflowRun.updateMany({
        where: { id, userId, status: "queued" },
        data: {
          status: "failed",
          activeDedupeKey: null,
          error: {
            code: "QUEUE_ENQUEUE_FAILED",
            message: "新执行版本入队失败，可沿用该版本继续完成",
          },
        },
      });
      throw error;
    }
    return { workflow: result.workflow, reused: false };
  }
  const store = createDatabaseMediaTaskStore(userId);
  const prior = await store.get(input.id);
  if (!prior) throw new ConfigurationError("媒体任务不存在", 404);
  if (["queued", "running"].includes(prior.status))
    throw new ConfigurationError(
      "请先停止当前媒体任务，再使用新配置重新生成",
      409,
    );
  let snapshot = await resolveProductionRequestConfiguration(userId, {
    projectId: prior.projectId,
    episodeId: prior.episodeId,
    ...(prior.targetType === "storyboard_panel"
      ? { panelId: prior.targetId }
      : {}),
  });
  const voiceInput = prior.kind === "audio" && prior.targetType === "voice_line" && prior.projectId && prior.episodeId && prior.targetId ? { userId, projectId: prior.projectId, episodeId: prior.episodeId, lineId: prior.targetId, channelId: prior.channelId!, model: prior.model } : undefined;
  const preparedVoice = voiceInput ? await prepareVoiceLineAudioTask(voiceInput) : undefined;
  if (preparedVoice) snapshot = configurationSnapshotSchema.parse(preparedVoice.task.request.productionConfiguration);
  const mediaDefaults = await loadUserRuntimeSettings(userId);
  const isPanelVideo =
    prior.kind === "video" &&
    prior.targetType === "storyboard_panel" &&
    prior.projectId &&
    prior.episodeId &&
    prior.targetId;
  const panelInput = {
    userId,
    projectId: prior.projectId!,
    episodeId: prior.episodeId!,
    panelId: prior.targetId!,
    channelId: prior.channelId!,
    model: prior.model,
    mediaDefaults,
    mode:
      prior.request.videoMode === "first-last"
        ? ("first-last" as const)
        : ("reference" as const),
  };
  const promptPreview = isPanelVideo
    ? await previewStoryboardPanelPrompt({ ...panelInput, kind: "video" })
    : undefined;
  if (promptPreview?.issues.some((issue) => issue.blocking))
    throw new ConfigurationError(
      promptPreview.issues
        .filter((issue) => issue.blocking)
        .map((issue) => issue.message)
        .join("；"),
      400,
    );
  const nextRequest = preparedVoice ? preparedVoice.task.request : cleanExecutionInput(prior.request);
  nextRequest.productionConfiguration = snapshot;
  if (prior.kind === "video") {
    nextRequest.audioMode = soundPolicyAudioMode(snapshot.sound);
    nextRequest.prompt = lockVideoAudioPerformance(
      String(prior.request.prompt ?? ""),
      { soundPolicy: snapshot.sound },
    );
    if (!isPanelVideo && !prior.request.operation) {
      const channel = await prisma.channel.findFirst({ where: accessibleChannelWhere(userId, prior.channelId), select: { protocol: true } });
      if (!channel || !isMediaChannelProtocol(channel.protocol)) throw new ConfigurationError("原视频渠道已停用或无权使用", 400);
      const model = await prisma.providerModel.findFirst({ where: { channelId: prior.channelId, modelId: prior.model, selected: true }, select: { capabilitiesJson: true } });
      if (!model) throw new ConfigurationError("原视频模型未选中，请在生成页面选择有效模型", 400);
      const capabilities = resolveVideoProductionCapabilities({ model: prior.model, protocol: channel.protocol, capabilities: JSON.parse(model.capabilitiesJson || "{}") });
      const blockers = videoProductionIssues(capabilities, snapshot.sound).filter(issue => issue.blocking);
      if (blockers.length) throw new ConfigurationError(blockers.map(issue => issue.message).join("；"), 400);
      const references = await resolveVideoVoiceReferences(userId, snapshot.sound, capabilities);
      const parameters = normalizeVideoProductionParameters({ model: prior.model, protocol: channel.protocol, capabilities, ratio: String(prior.request.ratio ?? "16:9"), resolution: String(prior.request.resolution ?? "1080p"), durationSeconds: Number.parseFloat(String(prior.request.duration ?? "5s")), mode: String(prior.request.videoMode ?? "reference"), referenceAudioCount: references.length });
      Object.assign(nextRequest, { ...parameters, productionCapabilities: capabilities, referenceAudios: references });
      if (prior.targetType === "canvas_node") {
        const canvas = await prisma.creativeCanvas.findUnique({ where: { episodeId: prior.episodeId! }, select: { revision: true } });
        if (!canvas || canvas.revision !== prior.request.canvasRevision) throw new ConfigurationError("画布版本已变化，请在节点生成弹窗重新预览并生成", 409);
      }
    }
  }
  const token = digest({
    id: prior.id,
    updatedAt: prior.updatedAt,
    request: prior.request,
    snapshot,
    promptPreview,
    nextRequest,
  });
  const preview = {
    token,
    kind: "media",
    target: prior.targetId ?? prior.id,
    count: promptPreview?.segments?.length ?? 1,
    executionVersion: Number(prior.request.executionVersion ?? 1) + 1,
    configuration: snapshot,
    previousConfiguration: prior.request.productionConfiguration,
    prompt: promptPreview?.finalPrompt ?? nextRequest.prompt,
    parameters: promptPreview?.parameters ?? {
      model: prior.model,
      channelId: prior.channelId,
      ...nextRequest,
    },
    description:
      "创建新的媒体任务；原任务和已有产物保留。镜头视频会重新生成该镜头全部片段，新模型请求可能产生费用。",
  };
  if (input.preview) return { preview };
  confirm(input, token);
  const key = `regenerate:${prior.id}:${input.idempotencyKey}`;
  const existing =
    (await store.findByIdempotencyKey(key)) ??
    (isPanelVideo
      ? await store.findByIdempotencyKey(`${key}:segment:0`)
      : null);
  if (existing) return { task: existing, reused: true };
  if (isPanelVideo)
    return createStoryboardPanelVideoTask({
      ...panelInput,
      idempotencyKey: key,
      previewConfigurationHash: promptPreview!.configurationHash,
      previewRequestHash: promptPreview!.requestHash,
      executionVersion: preview.executionVersion,
      regeneratedFromTaskId: prior.id,
    });
  if (
    prior.kind === "audio" &&
    prior.targetType === "voice_line" &&
    prior.projectId &&
    prior.episodeId &&
    prior.targetId
  )
    return createVoiceLineAudioTask({
      userId,
      projectId: prior.projectId,
      episodeId: prior.episodeId,
      lineId: prior.targetId,
      channelId: prior.channelId!,
      model: prior.model,
      idempotencyKey: key,
      executionVersion: preview.executionVersion,
      regeneratedFromTaskId: prior.id,
      expectedRequestHash: voiceRequestFingerprint(preparedVoice!.task.request),
    });
  configurationSnapshotSchema.parse(snapshot);
  const task = createMediaTask({
    id: `media_task_${digest({ userId, key })}`,
    projectId: prior.projectId,
    episodeId: prior.episodeId,
    targetType: prior.targetType,
    targetId: prior.targetId,
    channelId: prior.channelId,
    kind: prior.kind,
    provider: prior.provider,
    protocol: prior.protocol,
    model: prior.model,
    idempotencyKey: key,
    request: {
      ...nextRequest,
      regeneratedFromTaskId: prior.id,
      executionVersion: preview.executionVersion,
    },
  });
  await store.create(task);
  return { task: await enqueuePersistedMediaTask(userId, task), reused: false };
}
