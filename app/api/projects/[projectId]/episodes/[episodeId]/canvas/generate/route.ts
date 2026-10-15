import { getProjectArtStyleDirective } from "@/lib/projects/art-style";
import { z } from "zod";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { canvasAssetTargets, canvasDocumentSchema } from "@/lib/studio/canvas-document";
import { resolveCanvasGeneration } from "@/lib/studio/canvas-generation";
import {
  createStoryboardPanelImageTask,
  createStoryboardPanelVideoTask,
  ProjectAssetTaskError,
  previewStoryboardPanelPrompt,
} from "@/lib/media/project-asset-tasks";
import { createMediaTask } from "@/lib/media/task-contract";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import { fingerprintCanvasGenerationSource } from "@/lib/media/target-source-revision";
import { enqueuePersistedMediaTask } from "@/lib/media/task-submit";
import { isMediaChannelProtocol } from "@/lib/providers/media/registry";
import { resolveVideoModelLimits } from "@/lib/media/video-segment-plan";
import { normalizeVideoProductionParameters, resolveVideoProductionCapabilities, videoProductionIssues } from "@/lib/media/video-production-capabilities";
import { resolveVideoVoiceReferences } from "@/lib/media/video-voice-references";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { BillingError } from "@/lib/billing/service";
import { lockVideoAudioPerformance } from "@/lib/media/director-prompt-locks";
import { soundPolicyAudioMode } from "@/lib/production-configuration/contract";
import { resolveProductionRequestConfiguration, productionConfigurationFingerprint, assertPreviewConfiguration, productionRequestErrorStatus, mediaRequestPreviewFingerprint, assertPreviewRequest } from "@/lib/production-configuration/execution";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };
const schema = z.object({
  nodeId: z.string().min(1).max(100),
  revision: z.number().int().min(0),
  kind: z.enum(["image", "video"]),
  channelId: z.string().min(1),
  model: z.string().min(1),
  idempotencyKey: z.string().min(1).max(200),
  preview: z.boolean().optional(),
  productionOverride: z.never().optional(),
  previewConfigurationHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  previewRequestHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const reply = (body: object, status = 200) =>
    attachSessionCookie(Response.json(body, { status }), sessionId);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ message: "生成参数不完整" }, 400);
  const input = parsed.data;
  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, projectId, project: { userId: user.id } },
    select: { id: true, project: { select: { config: { select: { artStyle: true } } } } },
  });
  if (!episode) return reply({ message: "剧集不存在" }, 404);
  const canvas = await prisma.creativeCanvas.findUnique({
    where: { episodeId },
  });
  if (!canvas || canvas.revision !== input.revision)
    return reply({ message: "画布版本已变化，请重新审核并保存后生成" }, 409);
  const document = canvasDocumentSchema.safeParse(canvas.document);
  if (!document.success) return reply({ message: "画布数据无效" }, 400);
  const node = document.data.nodes.find((item) => item.id === input.nodeId);
  if (!node || !["panel", "image", "video"].includes(node.kind))
    return reply({ message: "请选择图片、视频或镜头节点" }, 400);
  if (
    (node.kind === "image" && input.kind !== "image") ||
    (node.kind === "video" && input.kind !== "video")
  )
    return reply({ message: "生成类型与节点不一致" }, 400);
  const store = createDatabaseMediaTaskStore(user.id);
  const key = `canvas:${projectId}:${episodeId}:${node.id}:${input.idempotencyKey}`;
  const reused =
    (await store.findByIdempotencyKey(key)) ??
    (input.kind === "video"
      ? await store.findByIdempotencyKey(`${key}:segment:0`)
      : null);
  if (reused && !input.preview) return reply({ task: reused, reused: true });
  try {
    const compiled = await resolveCanvasGeneration({
      document: document.data,
      node,
      kind: input.kind,
      userId: user.id,
      projectId,
      episodeId,
    });
    if (!compiled.prompt.trim())
      return reply({ message: "请先填写提示词" }, 400);
    const mediaDefaults = await loadUserRuntimeSettings(user.id);
    const mode = compiled.references.some((item) => item.role === "last_frame")
      ? "first-last"
      : "reference";
    if (node.panelId) {
      const panel = await prisma.storyboardPanel.findFirst({
        where: {
          id: node.panelId,
          storyboard: { episodeId, projectId, project: { userId: user.id } },
        },
        select: { id: true },
      });
      if (!panel)
        return reply({ message: "关联镜头不存在或不属于当前剧集" }, 400);
      const active = await prisma.mediaTask.count({
        where: {
          userId: user.id,
          projectId,
          episodeId,
          targetType: "storyboard_panel",
          targetId: node.panelId,
          kind: input.kind,
          status: { in: ["queued", "running"] },
        },
      });
      if (active)
        return reply({ message: "关联镜头已有生成任务，请等待完成" }, 409);
      const params = {
        previewConfigurationHash: input.previewConfigurationHash,
        previewRequestHash: input.previewRequestHash,
        userId: user.id,
        projectId,
        episodeId,
        panelId: node.panelId,
        channelId: input.channelId,
        model: input.model,
        prompt: compiled.prompt,
        mediaDefaults,
        canvasReferences: compiled.referenceImages,
        idempotencyKey: key,
        canvasNodeId: node.id,
      };
      if (input.preview) {
        const preview = await previewStoryboardPanelPrompt({
          ...params,
          kind: input.kind,
          mode,
        });
        const blocking = preview.issues.filter((issue) => issue.blocking);
        if (blocking.length)
          return reply(
            {
              message: blocking.map((issue) => issue.message).join("；"),
              preview,
            },
            400,
          );
        return reply({ preview, references: compiled.references });
      }
      const result =
        input.kind === "image"
          ? await createStoryboardPanelImageTask(params)
          : await createStoryboardPanelVideoTask({ ...params, mode });
      return reply(result, 202);
    }
    const channel = await prisma.channel.findFirst({
      where: accessibleChannelWhere(user.id, input.channelId),
      select: { protocol: true, providerKey: true },
    });
    if (!channel || !isMediaChannelProtocol(channel.protocol))
      return reply({ message: "请选择有效的媒体渠道" }, 400);
    const model = await prisma.providerModel.findFirst({
      where: {
        channelId: input.channelId,
        modelId: input.model,
        selected: true,
        OR: [
          { modelType: input.kind },
          { capabilitiesJson: { contains: `"${input.kind}"` } },
        ],
      },
      select: { capabilitiesJson: true },
    });
    if (!model) return reply({ message: "模型未在该渠道中配置或未选中" }, 400);
    const existing = await prisma.mediaTask.count({
      where: {
        userId: user.id,
        projectId,
        episodeId,
        targetType: "canvas_node",
        targetId: node.id,
        kind: input.kind,
        status: { in: ["queued", "running"] },
      },
    });
    if (existing)
      return reply({ message: "这个节点已有生成任务，请等待完成" }, 409);
    if (input.kind === "video") {
      const limits = resolveVideoModelLimits({
        model: input.model,
        protocol: channel.protocol,
        capabilities: JSON.parse(model.capabilitiesJson || "{}"),
      });
      const requestedDuration = Number.parseFloat(
        mediaDefaults.videoGenerationDuration,
      );
      if (
        Number.isFinite(requestedDuration) &&
        requestedDuration > limits.maxDurationSeconds
      )
        return reply(
          {
            message: `当前模型单次最多生成 ${limits.maxDurationSeconds} 秒，请调整视频默认时长，或关联镜头使用自动分段`,
          },
          400,
        );
      if (compiled.referenceImages.length > limits.maxReferenceImages)
        return reply(
          {
            message: `当前模型最多支持 ${limits.maxReferenceImages} 张图片，请减少引用`,
          },
          400,
        );
      if (
        mode === "first-last" &&
        !compiled.references.some((ref) => ref.role === "first_frame")
      )
        return reply({ message: "首尾帧模式需要同时连接首帧和尾帧" }, 400);
    }
    const rawStandalonePrompt = [getProjectArtStyleDirective(episode.project.config?.artStyle ?? "realistic", "zh"), compiled.prompt].filter(Boolean).join("\n\n");
    const productionConfiguration = await resolveProductionRequestConfiguration(user.id, { projectId, episodeId });
    const productionCapabilities = input.kind === "video" ? resolveVideoProductionCapabilities({ model: input.model, protocol: channel.protocol, capabilities: JSON.parse(model.capabilitiesJson || "{}") }) : undefined;
    const capabilityIssues = productionCapabilities ? videoProductionIssues(productionCapabilities, productionConfiguration.sound) : [];
    if (capabilityIssues.some(issue => issue.blocking)) return reply({ message: capabilityIssues.filter(issue => issue.blocking).map(issue => issue.message).join("；") }, 400);
    const referenceAudios = productionCapabilities ? await resolveVideoVoiceReferences(user.id, productionConfiguration.sound, productionCapabilities) : [];
    const videoParameters = productionCapabilities ? normalizeVideoProductionParameters({ model: input.model, protocol: channel.protocol, capabilities: productionCapabilities, ratio: mediaDefaults.videoGenerationRatio, resolution: mediaDefaults.videoGenerationResolution, durationSeconds: Number.parseFloat(mediaDefaults.videoGenerationDuration), mode, referenceAudioCount: referenceAudios.length }) : undefined;
    if (!input.preview) assertPreviewConfiguration(productionConfiguration, input.previewConfigurationHash);
    const standalonePrompt = input.kind === "video" ? lockVideoAudioPerformance(rawStandalonePrompt, { soundPolicy: productionConfiguration.sound }) : rawStandalonePrompt;
    const parameters = input.kind === "image"
      ? { ratio: mediaDefaults.imageGenerationRatio, resolution: mediaDefaults.imageGenerationResolution, count: mediaDefaults.imageGenerationCount, n: mediaDefaults.imageGenerationCount, quality: mediaDefaults.imageGenerationQuality, format: "png" }
      : { ratio: videoParameters!.ratio, resolution: videoParameters!.resolution, duration: videoParameters!.duration, videoMode: mode, audioMode: soundPolicyAudioMode(productionConfiguration.sound), format: "mp4" };
    const generationRequest = {
      productionConfiguration,
      productionCapabilities,
      prompt: standalonePrompt,
      ...parameters,
      ...(compiled.referenceImages.length ? { referenceImages: compiled.referenceImages } : {}),
      ...(referenceAudios.length ? { referenceAudios } : {}),
    };
    const requestHash = mediaRequestPreviewFingerprint([{ model: input.model, channelId: input.channelId, request: generationRequest }]);
    if (input.preview)
      return reply({
        prompt: standalonePrompt,
        references: compiled.references,
        productionConfiguration,
        configurationHash: productionConfigurationFingerprint(productionConfiguration),
        requestHash,
        capabilities: productionCapabilities,
        issues: capabilityIssues,
        parameters: { ...parameters, channelId: input.channelId, model: input.model, referenceAudioCount: referenceAudios.length },
      });
    assertPreviewRequest(requestHash, input.previewRequestHash);
    const task = createMediaTask({
      id: `media_task_${crypto.randomUUID()}`,
      idempotencyKey: key,
      kind: input.kind,
      projectId,
      episodeId,
      targetType: "canvas_node",
      targetId: node.id,
      channelId: input.channelId,
      provider: channel.providerKey,
      protocol: channel.protocol,
      model: input.model,
      request: {
        ...generationRequest,
        canvasInputFingerprint: fingerprintCanvasGenerationSource({ prompt: compiled.prompt, references: compiled.references, targets: input.kind === "image" ? canvasAssetTargets(node, document.data) : [], kind: input.kind }),
        canvasRevision: canvas.revision,
        canvasPromptVersionId: node.promptVersions?.at(-1)?.id,
        canvasAssetTargets: input.kind === "image" ? canvasAssetTargets(node, document.data) : [],
      },
    });
    await store.create(task);
    return reply({ task: await enqueuePersistedMediaTask(user.id, task) }, 202);
  } catch (error) {
    const configurationStatus = productionRequestErrorStatus(error);
    if (configurationStatus) return reply({ message: error instanceof Error ? error.message : "配置无效" }, configurationStatus);
    return reply(
      { message: error instanceof Error ? error.message : "提交失败" },
      error instanceof ProjectAssetTaskError || error instanceof BillingError
        ? error.status
        : 400,
    );
  }
}
