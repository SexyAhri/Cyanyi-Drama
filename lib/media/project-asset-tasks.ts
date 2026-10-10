import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/server/prisma";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { createMediaTask } from "./task-contract";
import { createDatabaseMediaTaskStore } from "./task-store";
import { enqueuePersistedMediaTask } from "./task-submit";
import { BillingError } from "@/lib/billing/service";
import { resolveStoredMediaUrl } from "@/lib/storage";
import {
  linkSourceAssets,
  listOwnedProjectMediaAssets,
} from "@/lib/assets/project-store";
import { isMediaChannelProtocol } from "@/lib/providers/media/registry";
import type { ChannelProtocol } from "@/lib/agent/provider-types";
import type { MediaReferenceImage } from "@/lib/providers/media/types";
import { sanitizeMediaPrompt } from "@/lib/media/provider-prompt-safety";
import {
  applyProjectArtStyle,
  getProjectArtStyleLabel,
} from "@/lib/projects/art-style";
import type { MediaGenerationDefaults } from "@/lib/settings/runtime-contract";
import {
  getStoryWorldDirective,
  loadProjectAssetStoryWorldContext,
  type AssetStoryWorldContext,
} from "@/lib/assets/story-world";
import {
  parseAssetVisualProfile,
  type AssetVisualProfile,
} from "@/lib/assets/visual-profile";
import {
  planVideoSegments,
  resolveVideoModelLimits,
} from "@/lib/media/video-segment-plan";

export type ProjectAssetTarget = "character" | "location" | "prop";

type CreateProjectImageTaskInput = {
  userId: string;
  projectId: string;
  batchId?: string;
  channelId: string;
  model: string;
  targetType: ProjectAssetTarget;
  targetId: string;
  prompt: string;
  ratio?: string;
  resolution?: string;
  mediaDefaults?: MediaGenerationDefaults;
  useSelectedReference?: boolean;
  referenceAssetIds?: string[];
  targetAppearanceId?: string;
  idempotencyKey?: string;
};

export async function createProjectImageTask(
  input: CreateProjectImageTaskInput,
) {
  const channel = await prisma.channel.findFirst({
    where: accessibleChannelWhere(input.userId, input.channelId),
  });
  if (!channel || !isMediaChannelProtocol(channel.protocol)) {
    throw new ProjectAssetTaskError("图片生成需要有效且受支持的媒体渠道", 400);
  }

  const selectedModel = await prisma.providerModel.count({
    where: {
      channelId: input.channelId,
      modelId: input.model,
      selected: true,
      OR: [
        { modelType: "image" },
        { capabilitiesJson: { contains: '"image"' } },
      ],
    },
  });
  if (!selectedModel) {
    throw new ProjectAssetTaskError("模型未在该渠道中配置或未选中", 400);
  }
  const store = createDatabaseMediaTaskStore(input.userId);
  if (input.idempotencyKey) {
    const existing = await store.findByIdempotencyKey(input.idempotencyKey);
    if (existing?.targetId && existing.targetType)
      return {
        task: existing,
        entity: { id: existing.targetId, entityType: existing.targetType },
      };
  }
  const assetTarget = await loadAssetTargetContext(input);
  const storyWorld = await loadProjectAssetStoryWorldContext({
    userId: input.userId,
    projectId: input.projectId,
    assetName: assetTarget.name,
    assetFacts: assetTarget.facts,
  });
  const explicitReferenceImages = input.referenceAssetIds?.length
    ? await findExplicitReferenceImages(input)
    : [];
  const selectedReferenceImages = input.useSelectedReference
    ? await findSelectedReferenceImages(input)
    : [];
  const entity = await createTargetEntity(input);
  const artStyle = await loadProjectArtStyle(input.projectId);
  const referenceImages = [
    ...explicitReferenceImages,
    ...(input.useSelectedReference ? selectedReferenceImages : []),
  ].slice(0, 9);
  const task = createMediaTask({
    id: `media_task_${randomUUID()}`,
    projectId: input.projectId,
    batchId: input.batchId,
    channelId: input.channelId,
    idempotencyKey: input.idempotencyKey,
    targetType: entity.entityType,
    targetId: entity.id,
    kind: "image",
    provider: channel.providerKey,
    protocol: channel.protocol,
    model: input.model,
    request: {
      prompt: applyProjectArtStyle(
        [
          getStoryWorldDirective(storyWorld.lock, "zh"),
          withAssetContinuityRequirements(input.targetType, input.prompt),
        ].join("\n"),
        artStyle,
        "zh",
      ),
      ratio: input.ratio ?? input.mediaDefaults?.imageGenerationRatio ?? "1:1",
      resolution:
        input.resolution ??
        input.mediaDefaults?.imageGenerationResolution ??
        "1k",
      count: input.mediaDefaults?.imageGenerationCount ?? 1,
      n: input.mediaDefaults?.imageGenerationCount ?? 1,
      quality: input.mediaDefaults?.imageGenerationQuality ?? "high",
      format: "png",
      ...(referenceImages.length ? { referenceImages } : {}),
    },
  });
  await store.create(task);
  if (input.referenceAssetIds?.length)
    await linkSourceAssets({
      userId: input.userId,
      projectId: input.projectId,
      assetIds: input.referenceAssetIds,
      entityType: entity.entityType,
      entityId: entity.id,
      role: "reference_source",
      metadata: { taskId: task.id, model: input.model },
    });
  const queued = await enqueueProjectTask(input.userId, task);
  return { task: queued, entity };
}

export async function createStoryboardPanelImageTask(input: {
  idempotencyKey?: string;
  canvasNodeId?: string;
  userId: string;
  projectId: string;
  episodeId: string;
  panelId: string;
  batchId?: string;
  channelId: string;
  model: string;
  prompt?: string;
  ratio?: string;
  resolution?: string;
  mediaDefaults?: MediaGenerationDefaults;
  iteration?: GenerationIterationDiagnostics;
  canvasReferences?: MediaReferenceImage[];
}) {
  const channel = await prisma.channel.findFirst({
    where: accessibleChannelWhere(input.userId, input.channelId),
    select: { id: true, protocol: true, providerKey: true },
  });
  if (!channel || !isMediaChannelProtocol(channel.protocol)) {
    throw new ProjectAssetTaskError("图片生成需要有效且受支持的媒体渠道", 400);
  }
  const selectedModel = await prisma.providerModel.count({
    where: {
      channelId: input.channelId,
      modelId: input.model,
      selected: true,
      OR: [
        { modelType: "image" },
        { capabilitiesJson: { contains: '"image"' } },
      ],
    },
  });
  if (!selectedModel) {
    throw new ProjectAssetTaskError("模型未在该渠道中配置或未选中", 400);
  }

  const panel = await prisma.storyboardPanel.findFirst({
    where: {
      id: input.panelId,
      storyboard: {
        projectId: input.projectId,
        episodeId: input.episodeId,
        project: { userId: input.userId },
      },
    },
    select: {
      id: true,
      description: true,
      imagePrompt: true,
      charactersJson: true,
      propsJson: true,
      locationName: true,
      startStateJson: true,
      endStateJson: true,
      motionBeatsJson: true,
      worldContextJson: true,
      vfxCuesJson: true,
      sfxCuesJson: true,
      sourceEvidenceJson: true,
      actingNotesJson: true,
      photographyRules: true,
      storyboard: {
        select: {
          status: true,
          episode: { select: { description: true, novelText: true } },
        },
      },
    },
  });
  if (!panel) throw new ProjectAssetTaskError("分镜格不存在", 404);
  assertStoryboardApprovedForMedia(panel.storyboard.status);
  const prompt =
    input.prompt?.trim() ||
    panel.imagePrompt?.trim() ||
    panel.description?.trim();
  if (!prompt) throw new ProjectAssetTaskError("分镜格缺少图片提示词", 400);

  const automaticReferences = await findStoryboardReferenceImages({
    projectId: input.projectId,
    characters: parseStringArray(panel.charactersJson),
    props: parseStringArray(panel.propsJson),
    locationName: panel.locationName,
  });
  const referenceImages = [
    ...(input.canvasReferences ?? []),
    ...automaticReferences,
  ].filter(
    (reference, index, all) =>
      all.findIndex((item) => item.url === reference.url) === index,
  );
  const productionDesign = await loadStoryboardProductionDesign({
    userId: input.userId,
    projectId: input.projectId,
    characters: parseStringArray(panel.charactersJson),
    props: parseStringArray(panel.propsJson),
    locationName: panel.locationName,
  });
  const generationPrompt = withStoryboardImageContinuityRequirements({
    prompt: reconcileStoryboardPromptTime(
      compileStoryboardEventBlueprint(prompt, panel),
      panel.storyboard.episode,
    ),
    characters: parseStringArray(panel.charactersJson),
    props: parseStringArray(panel.propsJson),
    locationName: panel.locationName,
    environmentDirective: storyboardEnvironmentDirective(
      panel,
      panel.storyboard.episode,
    ),
  });
  const compiledPrompt = compileStoryboardProductionPrompt(
    generationPrompt,
    productionDesign,
  );
  const task = createMediaTask({
    id: `media_task_${randomUUID()}`,
    projectId: input.projectId,
    episodeId: input.episodeId,
    batchId: input.batchId,
    idempotencyKey: input.idempotencyKey,
    channelId: input.channelId,
    targetType: "storyboard_panel",
    targetId: panel.id,
    kind: "image",
    provider: channel.providerKey,
    protocol: channel.protocol,
    model: input.model,
    request: {
      prompt: compiledPrompt,
      ...(input.canvasNodeId ? {canvasNodeId:input.canvasNodeId,canvasDeferredSelection:true,canvasGenerationId:input.idempotencyKey} : {}),
      ...(input.iteration ? { generationIteration: input.iteration } : {}),
      ratio:
        input.ratio ??
        input.mediaDefaults?.videoGenerationRatio ??
        input.mediaDefaults?.imageGenerationRatio ??
        "16:9",
      resolution:
        input.resolution ??
        input.mediaDefaults?.imageGenerationResolution ??
        "1k",
      count: input.mediaDefaults?.imageGenerationCount ?? 1,
      n: input.mediaDefaults?.imageGenerationCount ?? 1,
      quality: input.mediaDefaults?.imageGenerationQuality ?? "high",
      format: "png",
      ...(referenceImages.length ? { referenceImages } : {}),
    },
  });
  const store = createDatabaseMediaTaskStore(input.userId);
  await store.create(task);
  const queued = await enqueueProjectTask(input.userId, task);
  return {
    task: queued,
    panel: { id: panel.id, referenceCount: referenceImages.length },
  };
}

export async function createStoryboardPanelVideoTask(input: {
  idempotencyKey?: string;
  canvasNodeId?: string;
  userId: string;
  projectId: string;
  episodeId: string;
  panelId: string;
  batchId?: string;
  channelId: string;
  model: string;
  prompt?: string;
  ratio?: string;
  resolution?: string;
  duration?: string;
  mediaDefaults?: MediaGenerationDefaults;
  mode?: "reference" | "first-last";
  lastFramePanelId?: string;
  iteration?: GenerationIterationDiagnostics;
  canvasReferences?: MediaReferenceImage[];
}) {
  const channel = await prisma.channel.findFirst({
    where: accessibleChannelWhere(input.userId, input.channelId),
    select: { id: true, protocol: true, providerKey: true },
  });
  if (!channel || !isMediaChannelProtocol(channel.protocol)) {
    throw new ProjectAssetTaskError("视频生成需要有效且受支持的媒体渠道", 400);
  }
  const selectedModel = await prisma.providerModel.findFirst({
    where: {
      channelId: input.channelId,
      modelId: input.model,
      selected: true,
      OR: [
        { modelType: "video" },
        { capabilitiesJson: { contains: '"video"' } },
      ],
    },
    select: { capabilitiesJson: true },
  });
  if (!selectedModel) {
    throw new ProjectAssetTaskError("视频模型未在该渠道中配置或未选中", 400);
  }
  const panel = await prisma.storyboardPanel.findFirst({
    where: {
      id: input.panelId,
      storyboard: {
        projectId: input.projectId,
        episodeId: input.episodeId,
        project: { userId: input.userId },
      },
    },
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      linkedToNextPanel: true,
      description: true,
      durationSeconds: true,
      charactersJson: true,
      propsJson: true,
      locationName: true,
      videoPrompt: true,
      firstLastFramePrompt: true,
      imageAsset: {
        select: { url: true, storageKey: true, mimeType: true },
      },
      storyboard: {
        select: { status: true },
      },
    },
  });
  if (!panel) throw new ProjectAssetTaskError("分镜格不存在", 404);
  assertStoryboardApprovedForMedia(panel.storyboard.status);
  const rawBasePrompt =
    input.prompt?.trim() ||
    (input.mode === "first-last"
      ? panel.firstLastFramePrompt?.trim() || panel.videoPrompt?.trim()
      : panel.videoPrompt?.trim()) ||
    panel.description?.trim();
  if (!rawBasePrompt)
    throw new ProjectAssetTaskError("分镜格缺少视频提示词", 400);
  const activeTaskCount = await prisma.mediaTask.count({
    where: {
      userId: input.userId,
      targetType: "storyboard_panel",
      targetId: panel.id,
      kind: "video",
      status: { in: ["queued", "running"] },
    },
  });
  if (activeTaskCount)
    throw new ProjectAssetTaskError("该场次已有视频片段正在生成", 409);
  const limits = resolveVideoModelLimits({
    model: input.model,
    protocol: channel.protocol,
    capabilities: parseStoredJsonValue(selectedModel.capabilitiesJson, {}),
  });
  if (input.mode === "first-last" && limits.maxReferenceImages < 2)
    throw new ProjectAssetTaskError(
      "当前视频模型不支持同时提交首帧和尾帧",
      400,
    );
  const durationSeconds =
    parseDurationSeconds(input.duration) ??
    panel.durationSeconds ??
    parseDurationSeconds(input.mediaDefaults?.videoGenerationDuration) ??
    5;
  const segments = planVideoSegments({
    action: panel.description,
    durationSeconds,
    maxDurationSeconds: limits.maxDurationSeconds,
    prompt: rawBasePrompt,
  });
  if (input.mode === "first-last" && segments.length > 1)
    throw new ProjectAssetTaskError(
      `当前场次需拆为 ${segments.length} 段，首尾帧模式缺少中间衔接帧，请改用参考图模式`,
      400,
    );
  const referenceImages: Array<{
    url: string;
    storageKey?: string;
    mimeType?: string;
    role?: "reference_image" | "first_frame" | "last_frame";
  }> = [];
  if (input.mode === "first-last") {
    const explicitFirst = input.canvasReferences?.find(
      (item) => item.role === "first_frame",
    );
    const explicitLast = input.canvasReferences?.find(
      (item) => item.role === "last_frame",
    );
    const firstFrameUrl =
      explicitFirst?.url ?? (await mediaAssetUrl(panel.imageAsset));
    const lastFrame = await findLastFramePanel({
      userId: input.userId,
      projectId: input.projectId,
      episodeId: input.episodeId,
      storyboardId: panel.storyboardId,
      panelIndex: panel.panelIndex,
      linkedToNextPanel: panel.linkedToNextPanel,
      lastFramePanelId: input.lastFramePanelId,
    });
    const lastFrameUrl =
      explicitLast?.url ?? (await mediaAssetUrl(lastFrame?.imageAsset));
    if (!firstFrameUrl || !lastFrameUrl)
      throw new ProjectAssetTaskError("首尾帧模式需要首帧和尾帧图片", 400);
    referenceImages.push(
      {
        url: firstFrameUrl,
        storageKey:
          explicitFirst?.storageKey ??
          panel.imageAsset?.storageKey ??
          undefined,
        mimeType:
          explicitFirst?.mimeType ?? panel.imageAsset?.mimeType ?? undefined,
        role: "first_frame",
      },
      {
        url: lastFrameUrl,
        storageKey:
          explicitLast?.storageKey ??
          lastFrame?.imageAsset?.storageKey ??
          undefined,
        mimeType:
          explicitLast?.mimeType ??
          lastFrame?.imageAsset?.mimeType ??
          undefined,
        role: "last_frame",
      },
    );
  } else {
    const explicitFirst = input.canvasReferences?.find(
      (item) => item.role === "first_frame",
    );
    const panelImageUrl =
      explicitFirst?.url ?? (await mediaAssetUrl(panel.imageAsset));
    if (panelImageUrl)
      referenceImages.push({
        url: panelImageUrl,
        storageKey:
          explicitFirst?.storageKey ??
          panel.imageAsset?.storageKey ??
          undefined,
        mimeType:
          explicitFirst?.mimeType ?? panel.imageAsset?.mimeType ?? undefined,
        role: "first_frame",
      });
  }
  for (const reference of input.canvasReferences ?? []) {
    if (
      !referenceImages.some(
        (item) => item.url === reference.url && item.role === reference.role,
      )
    )
      referenceImages.push(reference);
  }
  if (
    input.canvasReferences?.length &&
    referenceImages.length > limits.maxReferenceImages
  )
    throw new ProjectAssetTaskError(
      `当前模型最多支持 ${limits.maxReferenceImages} 张参考图片，请减少连线或选择其他模型`,
      400,
    );
  const selectedReferences = referenceImages.slice(
    0,
    limits.maxReferenceImages,
  );
  const tasks = segments.map((segment) => {
    const segmentId = storyboardVideoSegmentId(panel.id, segment.index);
    return createMediaTask({
      id: `media_task_${randomUUID()}`,
      idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:segment:${segment.index}` : undefined,
      projectId: input.projectId,
      episodeId: input.episodeId,
      batchId: input.batchId,
      channelId: input.channelId,
      targetType: "storyboard_panel",
      targetId: panel.id,
      kind: "video",
      provider: channel.providerKey,
      protocol: channel.protocol as ChannelProtocol,
      model: input.model,
      request: {
        prompt: segment.prompt,
        ...(input.canvasNodeId ? {canvasNodeId:input.canvasNodeId,canvasDeferredSelection:true,canvasGenerationId:input.idempotencyKey} : {}),
        ...(input.iteration ? { generationIteration: input.iteration } : {}),
        ratio:
          input.ratio ?? input.mediaDefaults?.videoGenerationRatio ?? "16:9",
        resolution:
          input.resolution ??
          input.mediaDefaults?.videoGenerationResolution ??
          "1080p",
        duration: `${segment.durationSeconds}s`,
        format: "mp4",
        audioMode: "none",
        videoMode: input.mode ?? "reference",
        videoSegmentId: segmentId,
        videoSegmentIndex: segment.index,
        videoSegmentCount: segments.length,
        videoSegmentStartSeconds: segment.startSeconds,
        videoSegmentEndSeconds: segment.endSeconds,
        ...(selectedReferences.length
          ? { referenceImages: selectedReferences }
          : {}),
      },
    });
  });
  const store = createDatabaseMediaTaskStore(input.userId);
  for (const task of tasks) await store.create(task);
  if (!input.canvasNodeId) await prisma.$transaction([
    ...segments.map((segment, index) =>
      prisma.storyboardVideoSegment.upsert({
        where: {
          panelId_segmentIndex: {
            panelId: panel.id,
            segmentIndex: segment.index,
          },
        },
        create: {
          id: storyboardVideoSegmentId(panel.id, segment.index),
          panelId: panel.id,
          taskId: tasks[index].id,
          segmentIndex: segment.index,
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
          durationSeconds: segment.durationSeconds,
          prompt: segment.prompt,
          action: segment.action || null,
          model: input.model,
          mode: input.mode ?? "reference",
        },
        update: {
          taskId: tasks[index].id,
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
          durationSeconds: segment.durationSeconds,
          prompt: segment.prompt,
          action: segment.action || null,
          model: input.model,
          mode: input.mode ?? "reference",
          videoAssetId: null,
        },
      }),
    ),
    prisma.storyboardVideoSegment.deleteMany({
      where: {
        panelId: panel.id,
        segmentIndex: { gte: segments.length },
      },
    }),
    prisma.storyboardPanel.update({
      where: { id: panel.id },
      data: { videoAssetId: null, lipSyncAssetId: null },
    }),
  ]);
  const queued = [];
  for (const task of tasks)
    queued.push(await enqueueProjectTask(input.userId, task));
  return {
    task: queued[0],
    tasks: queued,
    panel: {
      id: panel.id,
      referenceCount: selectedReferences.length,
      referenceAudioCount: 0,
      segmentCount: segments.length,
      segments: segments.map((segment) => ({
        index: segment.index,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        durationSeconds: segment.durationSeconds,
      })),
    },
  };
}

export type StoryboardPromptPreview = {
  basePrompt: string;
  compiledPrompt: string;
  finalPrompt: string;
  issues: Array<{
    blocking: boolean;
    code: string;
    message: string;
  }>;
  kind: "image" | "video";
  submissionMode: "compiled" | "verbatim" | "segmented";
  referenceCount: number;
  maxDurationSeconds?: number;
  segments?: Array<{
    action: string;
    durationSeconds: number;
    endSeconds: number;
    index: number;
    prompt: string;
    startSeconds: number;
  }>;
  safetyRewrites: ReturnType<typeof sanitizeMediaPrompt>["changes"];
  sources: Array<{
    key: string;
    label: string;
    value: string;
  }>;
};

export async function previewStoryboardPanelPrompt(input: {
  canvasReferences?: MediaReferenceImage[];
  userId: string;
  projectId: string;
  episodeId: string;
  panelId: string;
  kind: "image" | "video";
  prompt?: string;
  mode?: "reference" | "first-last";
  lastFramePanelId?: string;
  ratio?: string;
  resolution?: string;
  duration?: string;
  channelId?: string;
  model?: string;
  mediaDefaults?: MediaGenerationDefaults;
}): Promise<StoryboardPromptPreview> {
  const panel = await prisma.storyboardPanel.findFirst({
    where: {
      id: input.panelId,
      storyboard: {
        projectId: input.projectId,
        episodeId: input.episodeId,
        project: { userId: input.userId },
      },
    },
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      linkedToNextPanel: true,
      description: true,
      durationSeconds: true,
      imagePrompt: true,
      videoPrompt: true,
      firstLastFramePrompt: true,
      lipSyncText: true,
      voiceoverText: true,
      actingNotesJson: true,
      photographyRules: true,
      startStateJson: true,
      endStateJson: true,
      motionBeatsJson: true,
      worldContextJson: true,
      vfxCuesJson: true,
      sfxCuesJson: true,
      sourceEvidenceJson: true,
      charactersJson: true,
      propsJson: true,
      locationName: true,
      imageAsset: {
        select: { url: true, storageKey: true, mimeType: true },
      },
      storyboard: {
        select: {
          episode: { select: { description: true, novelText: true } },
        },
      },
    },
  });
  if (!panel) throw new ProjectAssetTaskError("分镜格不存在", 404);

  const characters = parseStringArray(panel.charactersJson);
  const props = parseStringArray(panel.propsJson);
  const rawBasePrompt =
    input.prompt?.trim() ||
    (input.kind === "image"
      ? panel.imagePrompt?.trim()
      : input.mode === "first-last"
        ? panel.firstLastFramePrompt?.trim() || panel.videoPrompt?.trim()
        : panel.videoPrompt?.trim()) ||
    panel.description?.trim() ||
    "";
  const basePrompt = rawBasePrompt;
  const issues: StoryboardPromptPreview["issues"] = [];
  if (!basePrompt)
    issues.push({
      blocking: true,
      code: "missing_prompt",
      message: input.kind === "image" ? "缺少图片提示词" : "缺少视频提示词",
    });

  if (input.kind === "video") {
    let limits = { maxDurationSeconds: 10, maxReferenceImages: 1 };
    if (input.channelId && input.model) {
      const channel = await prisma.channel.findFirst({
        where: accessibleChannelWhere(input.userId, input.channelId),
        select: {
          protocol: true,
          models: {
            where: { modelId: input.model, selected: true },
            select: { capabilitiesJson: true },
            take: 1,
          },
        },
      });
      if (channel && isMediaChannelProtocol(channel.protocol))
        limits = resolveVideoModelLimits({
          model: input.model,
          protocol: channel.protocol,
          capabilities: parseStoredJsonValue(
            channel.models[0]?.capabilitiesJson,
            {},
          ),
        });
    }
    const durationSeconds =
      parseDurationSeconds(input.duration) ??
      panel.durationSeconds ??
      parseDurationSeconds(input.mediaDefaults?.videoGenerationDuration) ??
      5;
    const segments = planVideoSegments({
      action: panel.description,
      durationSeconds,
      maxDurationSeconds: limits.maxDurationSeconds,
      prompt: basePrompt,
    });
    if (input.mode === "first-last" && segments.length > 1)
      issues.push({
        blocking: true,
        code: "segmented_first_last_unsupported",
        message: `当前场次需拆为 ${segments.length} 段，首尾帧模式缺少中间衔接帧，请改用参考图模式`,
      });
    if (input.mode === "first-last" && limits.maxReferenceImages < 2)
      issues.push({
        blocking: true,
        code: "first_last_model_unsupported",
        message: "当前视频模型不支持同时提交首帧和尾帧",
      });
    let referenceCount = 0;
    const sources: StoryboardPromptPreview["sources"] = [
      {
        key: "submission_mode",
        label: "提交方式",
        value:
          segments.length === 1
            ? "场次完整视频提示词原样提交"
            : "按模型上限本地拆分，每段提交完整视频提示词",
      },
      {
        key: "shot_prompt",
        label: "视频提示词",
        value: basePrompt ? `${basePrompt.length} 个字符` : "未填写",
      },
    ];
    if (input.mode === "first-last") {
      const firstFrameUrl = input.canvasReferences?.find(ref => ref.role === "first_frame")?.url ?? await mediaAssetUrl(panel.imageAsset);
      const lastFrame = await findLastFramePanel({
        userId: input.userId,
        projectId: input.projectId,
        episodeId: input.episodeId,
        storyboardId: panel.storyboardId,
        panelIndex: panel.panelIndex,
        linkedToNextPanel: panel.linkedToNextPanel,
        lastFramePanelId: input.lastFramePanelId,
      });
      const lastFrameUrl = input.canvasReferences?.find(ref => ref.role === "last_frame")?.url ?? await mediaAssetUrl(lastFrame?.imageAsset);
      if (!firstFrameUrl || !lastFrameUrl)
        issues.push({
          blocking: true,
          code: "missing_first_last_frame",
          message: "首尾帧模式需要当前镜头首帧和已关联的下一镜头图片",
        });
      referenceCount =
        Number(Boolean(firstFrameUrl)) + Number(Boolean(lastFrameUrl));
      sources.push({
        key: "frame_mode",
        label: "画面参考",
        value: `${referenceCount}/2 张首尾帧（按首帧、尾帧顺序）`,
      });
    } else {
      const firstFrameUrl = input.canvasReferences?.find(ref => ref.role === "first_frame")?.url ?? await mediaAssetUrl(panel.imageAsset);
      if (!firstFrameUrl && !input.canvasReferences?.length)
        issues.push({
          blocking: true,
          code: "missing_reference_frame",
          message: "参考图模式需要先选择当前镜头图片",
        });
      referenceCount = firstFrameUrl && limits.maxReferenceImages > 0 ? 1 : 0;
      sources.push({
        key: "frame_mode",
        label: "画面参考",
        value: firstFrameUrl
          ? `${referenceCount} 张分镜首帧（角色 / 场景 / 道具设定已用于生成该首帧）`
          : "缺少当前镜头参考图",
      });
    }
    if (input.canvasReferences?.length) {
      const references = [...input.canvasReferences];
      const defaultFirst = await mediaAssetUrl(panel.imageAsset);
      if (defaultFirst && !references.some(ref => ref.role === "first_frame"))
        references.push({ url: defaultFirst, role: "first_frame" });
      referenceCount = references.filter((ref, index) => references.findIndex(other => other.url === ref.url && other.role === ref.role) === index).length;
      if (referenceCount > limits.maxReferenceImages) issues.push({blocking:true,code:"canvas_reference_limit",message:`当前模型最多支持 ${limits.maxReferenceImages} 张图片，实际使用 ${referenceCount} 张`});
      sources.push({key:"canvas_references",label:"画布引用",value:`${referenceCount} 张图片（包含镜头默认首帧）`});
    }
    sources.push(
      {
        key: "segments",
        label: "生成拆分",
        value: `${segments.length} 段 · ${segments.map((segment) => `${segment.durationSeconds} 秒`).join(" + ")}（模型单次上限 ${limits.maxDurationSeconds} 秒）`,
      },
      {
        key: "output",
        label: "输出规格",
        value: `${input.ratio ?? input.mediaDefaults?.videoGenerationRatio ?? "16:9"} · ${input.resolution ?? input.mediaDefaults?.videoGenerationResolution ?? "1080p"}`,
      },
      {
        key: "audio_mode",
        label: "模型音频",
        value: "关闭（audioMode=none，声音由后期独立合成）",
      },
    );
    return {
      basePrompt,
      compiledPrompt: basePrompt,
      finalPrompt: basePrompt,
      issues,
      kind: "video",
      submissionMode: segments.length === 1 ? "verbatim" : "segmented",
      referenceCount,
      maxDurationSeconds: limits.maxDurationSeconds,
      segments,
      safetyRewrites: [],
      sources,
    };
  }

  const supportingReferences = await findStoryboardReferenceImages({
    projectId: input.projectId,
    characters,
    props,
    locationName: panel.locationName,
  });
  const productionDesign = await loadStoryboardProductionDesign({
    userId: input.userId,
    projectId: input.projectId,
    characters,
    props,
    locationName: panel.locationName,
  });
  const referenceCount = [...(input.canvasReferences ?? []), ...supportingReferences].filter((ref,index,all)=>all.findIndex(other=>other.url===ref.url)===index).length;
  let compiledPrompt = "";
  let generationPrompt = "";
  const sources: StoryboardPromptPreview["sources"] = [
    {
      key: "art_style",
      label: "项目画风",
      value: getProjectArtStyleLabel(productionDesign.artStyle, "zh"),
    },
    {
      key: "story_world",
      label: "故事时代",
      value: productionDesign.storyWorldDirective,
    },
    {
      key: "visual_profiles",
      label: "视觉档案",
      value: `${productionDesign.visualProfiles.length} 个已确认角色 / 场景 / 道具设定`,
    },
    {
      key: "shot_prompt",
      label: "镜头提示",
      value: basePrompt || "未填写",
    },
    {
      key: "asset_references",
      label: "资产参考",
      value: `${supportingReferences.length} 张角色 / 场景 / 道具参考图`,
    },
  ];

  generationPrompt = withStoryboardImageContinuityRequirements({
    prompt: reconcileStoryboardPromptTime(
      compileStoryboardEventBlueprint(basePrompt, panel),
      panel.storyboard.episode,
    ),
    characters,
    props,
    locationName: panel.locationName,
    environmentDirective: storyboardEnvironmentDirective(
      panel,
      panel.storyboard.episode,
    ),
  });
  compiledPrompt = compileStoryboardProductionPrompt(
    generationPrompt,
    productionDesign,
  );

  const sanitized = sanitizeMediaPrompt(compiledPrompt);
  if (sanitized.changes.length)
    sources.push({
      key: "safety_rewrite",
      label: "安全改写",
      value: `${sanitized.changes.length} 处敏感描述已替换`,
    });
  return {
    basePrompt,
    compiledPrompt,
    finalPrompt: sanitized.prompt,
    issues,
    kind: "image",
    submissionMode: "compiled",
    referenceCount,
    safetyRewrites: sanitized.changes,
    sources,
  };
}

function parseDurationSeconds(value?: string) {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function storyboardVideoSegmentId(panelId: string, segmentIndex: number) {
  return `${panelId}_video_segment_${segmentIndex}`;
}

async function findLastFramePanel(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  storyboardId: string;
  panelIndex: number;
  linkedToNextPanel: boolean;
  lastFramePanelId?: string;
}) {
  if (!input.lastFramePanelId && !input.linkedToNextPanel) return null;
  return prisma.storyboardPanel.findFirst({
    where: {
      storyboardId: input.storyboardId,
      ...(input.lastFramePanelId
        ? { id: input.lastFramePanelId }
        : { panelIndex: { gt: input.panelIndex } }),
      storyboard: {
        projectId: input.projectId,
        episodeId: input.episodeId,
        project: { userId: input.userId },
      },
    },
    orderBy: { panelIndex: "asc" },
    select: {
      imageAsset: {
        select: { url: true, storageKey: true, mimeType: true },
      },
    },
  });
}

async function mediaAssetUrl(
  asset: { url: string | null; storageKey: string | null } | null | undefined,
) {
  if (asset?.storageKey) return resolveStoredMediaUrl(asset.storageKey);
  return asset?.url ?? null;
}

async function loadProjectArtStyle(projectId: string) {
  const config = await prisma.projectConfig.findUnique({
    where: { projectId },
    select: { artStyle: true },
  });
  return config?.artStyle ?? "american-comic";
}

type StoryboardProductionDesign = {
  artStyle: string;
  storyWorld: AssetStoryWorldContext;
  storyWorldDirective: string;
  visualProfiles: Array<{
    kind: "角色" | "场景" | "道具";
    name: string;
    profile: AssetVisualProfile;
  }>;
};

async function loadStoryboardProductionDesign(input: {
  userId: string;
  projectId: string;
  characters: string[];
  props: string[];
  locationName: string | null;
}): Promise<StoryboardProductionDesign> {
  const [artStyle, storyWorld, visualProfiles] = await Promise.all([
    loadProjectArtStyle(input.projectId),
    loadProjectAssetStoryWorldContext({
      userId: input.userId,
      projectId: input.projectId,
      assetName:
        input.locationName ?? input.characters[0] ?? input.props[0] ?? "",
      assetFacts: {
        characters: input.characters,
        location: input.locationName,
        props: input.props,
      },
    }),
    loadStoryboardVisualProfiles(input),
  ]);
  return {
    artStyle,
    storyWorld,
    storyWorldDirective: getStoryWorldDirective(storyWorld.lock, "zh"),
    visualProfiles,
  };
}

async function loadStoryboardVisualProfiles(input: {
  projectId: string;
  characters: string[];
  props: string[];
  locationName: string | null;
}) {
  const [characters, location, props] = await Promise.all([
    input.characters.length
      ? prisma.novelCharacter.findMany({
          where: { projectId: input.projectId, name: { in: input.characters } },
          select: { name: true, visualProfileJson: true },
        })
      : [],
    input.locationName
      ? prisma.novelLocation.findFirst({
          where: { projectId: input.projectId, name: input.locationName },
          select: { name: true, visualProfileJson: true },
        })
      : null,
    input.props.length
      ? prisma.novelProp.findMany({
          where: { projectId: input.projectId, name: { in: input.props } },
          select: { name: true, visualProfileJson: true },
        })
      : [],
  ]);
  return [
    ...characters.map((item) => ({ kind: "角色" as const, ...item })),
    ...(location ? [{ kind: "场景" as const, ...location }] : []),
    ...props.map((item) => ({ kind: "道具" as const, ...item })),
  ].flatMap((item) => {
    const profile = parseAssetVisualProfile(
      parseStoredProfile(item.visualProfileJson),
    );
    return profile ? [{ kind: item.kind, name: item.name, profile }] : [];
  });
}

function compileStoryboardProductionPrompt(
  prompt: string,
  productionDesign: StoryboardProductionDesign,
) {
  const visualProfiles = productionDesign.visualProfiles.map(
    compileStoryboardImageVisualProfile,
  );
  const productionPrompt = [
    productionDesign.storyWorldDirective,
    ...(visualProfiles.length
      ? [
          "已确认资产视觉档案（永久身份硬约束；本镜临时状态不得改写这些设定）：",
          ...visualProfiles,
        ]
      : []),
    prompt,
  ].join("\n");
  return applyProjectArtStyle(
    productionPrompt,
    productionDesign.artStyle,
    "zh",
  );
}

type StoryboardEventBlueprintPanel = {
  description?: string | null;
  lipSyncText?: string | null;
  voiceoverText?: string | null;
  locationName?: string | null;
  charactersJson?: string | null;
  propsJson?: string | null;
  startStateJson?: string | null;
  endStateJson?: string | null;
  motionBeatsJson?: string | null;
  worldContextJson?: string | null;
  vfxCuesJson?: string | null;
  sfxCuesJson?: string | null;
  sourceEvidenceJson?: string | null;
  actingNotesJson?: string | null;
  photographyRules?: string | null;
};

export function compileStoryboardEventBlueprint(
  userPrompt: string,
  panel: StoryboardEventBlueprintPanel,
) {
  const characters = parseStringArray(panel.charactersJson ?? null);
  const props = parseStringArray(panel.propsJson ?? null);
  const worldContext = asBlueprintRecord(
    parseStoredJsonValue(panel.worldContextJson, {}),
  );
  const photographyRules = asBlueprintRecord(
    parseStoredJsonValue(panel.photographyRules, {}),
  );
  const startState = asBlueprintRecord(
    parseStoredJsonValue(panel.startStateJson, {}),
  );
  const referenceScopes = asBlueprintArray(worldContext.referenceScopes);
  const environment = asBlueprintRecord(startState.environmentState);
  const sections: string[] = [
    "镜头起始画面：",
    userPrompt,
    `起始姿态：${formatBlueprintRecord(startState)}`,
    `环境：${formatBlueprintRecord(environment)}`,
    `场景：${panel.locationName?.trim() || "未指定"}`,
    `角色：${characters.length ? characters.join("、") : "无明确出镜角色"}`,
    `道具：${props.length ? props.join("、") : "无关键道具"}`,
    ...formatReferenceScopes(referenceScopes),
    ...formatImageCameraBlueprint(photographyRules),
    "保留自然呼吸、重心与视线，让画面看起来是连续表演中的一帧；动作结果留给视频。",
  ];
  return sections.join("\n");
}

type BlueprintRecord = Record<string, unknown>;

export type GenerationIterationDiagnostics = {
  failureCode: string;
  responsibilityLayer:
    | "storyboard"
    | "asset_reference"
    | "camera"
    | "action_physics"
    | "acting"
    | "continuity"
    | "provider"
    | "postproduction";
  changedVariables: string[];
  hypothesis: string;
  expectedImprovement: string;
  mustRemainUnchanged: string[];
  noImprovementCount: number;
};

const GENERATION_RESPONSIBILITY_LAYERS = new Set<
  GenerationIterationDiagnostics["responsibilityLayer"]
>([
  "storyboard",
  "asset_reference",
  "camera",
  "action_physics",
  "acting",
  "continuity",
  "provider",
  "postproduction",
]);

export function parseGenerationIterationDiagnostics(
  value: unknown,
): GenerationIterationDiagnostics | undefined {
  if (value === undefined || value === null) return undefined;
  const record = asBlueprintRecord(value);
  const responsibilityLayer = record.responsibilityLayer;
  const noImprovementCount = record.noImprovementCount;
  const changedVariables = stringArrayValue(record.changedVariables);
  const mustRemainUnchanged = stringArrayValue(record.mustRemainUnchanged);
  if (
    !blueprintText(record.failureCode, "") ||
    typeof responsibilityLayer !== "string" ||
    !GENERATION_RESPONSIBILITY_LAYERS.has(
      responsibilityLayer as GenerationIterationDiagnostics["responsibilityLayer"],
    ) ||
    !changedVariables.length ||
    !blueprintText(record.hypothesis, "") ||
    !blueprintText(record.expectedImprovement, "") ||
    !mustRemainUnchanged.length ||
    !Number.isInteger(noImprovementCount) ||
    Number(noImprovementCount) < 0
  )
    throw new ProjectAssetTaskError(
      "重生成诊断不完整：必须提供 failureCode、有效 responsibilityLayer、changedVariables、hypothesis、expectedImprovement、mustRemainUnchanged 和非负 noImprovementCount",
      400,
    );
  if (Number(noImprovementCount) >= 2)
    throw new ProjectAssetTaskError(
      "同一生成假设已连续两轮无改善，必须升级到上游分镜、资产、模型或人工审查，不能继续盲目重试",
      409,
    );
  return {
    failureCode: blueprintText(record.failureCode),
    responsibilityLayer:
      responsibilityLayer as GenerationIterationDiagnostics["responsibilityLayer"],
    changedVariables,
    hypothesis: blueprintText(record.hypothesis),
    expectedImprovement: blueprintText(record.expectedImprovement),
    mustRemainUnchanged,
    noImprovementCount: Number(noImprovementCount),
  };
}

function stringArrayValue(value: unknown) {
  return asBlueprintArray(value)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function asBlueprintRecord(value: unknown): BlueprintRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as BlueprintRecord)
    : {};
}

function asBlueprintArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function blueprintText(value: unknown, fallback = "未指定") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return fallback;
}

function formatBlueprintList(value: unknown) {
  const items = asBlueprintArray(value)
    .map((item) => blueprintText(item, ""))
    .filter(Boolean);
  return items.length ? items.join("；") : "无额外项";
}

function formatBlueprintRecord(
  value: unknown,
  excludedKeys: readonly string[] = [],
) {
  const excluded = new Set(excludedKeys);
  const entries = Object.entries(asBlueprintRecord(value))
    .filter(
      ([key, item]) =>
        !excluded.has(key) && item !== null && item !== undefined,
    )
    .map(([key, item]) => `${key}=${formatBlueprintValue(item)}`);
  return entries.length ? entries.join("；") : "无额外规则";
}

function formatBlueprintValue(value: unknown): string {
  if (Array.isArray(value))
    return value.length
      ? value.map((item) => formatBlueprintValue(item)).join(" / ")
      : "无";
  if (value && typeof value === "object")
    return `{ ${formatBlueprintRecord(value)} }`;
  return blueprintText(value, "无");
}

function formatReferenceScopes(scopes: unknown[]) {
  if (!scopes.length)
    return [
      "参考资产继承范围：仅按本镜已批准资产设定继承永久身份，不继承临时姿态与状态",
    ];
  return scopes.map((value, index) => {
    const scope = asBlueprintRecord(value);
    return `参考资产${index + 1}：${blueprintText(scope.assetName)}${scope.assetVersion ? `（版本 ${blueprintText(scope.assetVersion)}）` : ""}；继承=${formatBlueprintList(scope.inherit)}；排除=${formatBlueprintList(scope.exclude)}`;
  });
}

function formatImageCameraBlueprint(value: BlueprintRecord) {
  return [
    `摄影基础：${formatBlueprintRecord(value, ["cameraStart", "cameraPath", "cameraEnd"])}`,
    `起始机位：${formatBlueprintRecord(value.cameraStart)}`,
  ];
}

export function assertStoryboardApprovedForMedia(status: string) {
  if (["ready", "review_required", "continuity_warning"].includes(status))
    return;
  throw new ProjectAssetTaskError(
    `分镜尚未完成，不能生成媒体（当前状态：${status}）`,
    409,
  );
}

function compileStoryboardImageVisualProfile(item: {
  kind: "角色" | "场景" | "道具";
  name: string;
  profile: AssetVisualProfile;
}) {
  const { spec } = item.profile;
  return [
    `${item.kind}「${item.name}」`,
    `视觉身份：${spec.visualIdentity}`,
    `形体与结构：${spec.shapeAndStructure}`,
    `造型与材质：${spec.surfaceAndStyling}`,
    `色彩方案：${spec.colorPalette}`,
    ...(spec.signatureDetails.length
      ? [`识别细节：${spec.signatureDetails.join("；")}`]
      : []),
    ...(spec.consistencyRules.length
      ? [`一致性规则：${spec.consistencyRules.join("；")}`]
      : []),
    ...(spec.negativePrompt ? [`排除项：${spec.negativePrompt}`] : []),
  ]
    .filter((line) => !line.endsWith("："))
    .join("\n");
}

function parseStoredJsonValue<T>(
  value: string | null | undefined,
  fallback: T,
): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function parseStoredProfile(value: string | null) {
  try {
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

async function loadAssetTargetContext(input: CreateProjectImageTaskInput) {
  if (input.targetType === "character") {
    const target = await prisma.novelCharacter.findFirst({
      where: {
        id: input.targetId,
        projectId: input.projectId,
        project: { userId: input.userId },
      },
      select: { name: true, introduction: true, profileJson: true },
    });
    if (!target) throw new ProjectAssetTaskError("目标资产不存在", 404);
    return {
      name: target.name,
      facts: [target.introduction, target.profileJson].filter(Boolean),
    };
  }
  if (input.targetType === "location") {
    const target = await prisma.novelLocation.findFirst({
      where: {
        id: input.targetId,
        projectId: input.projectId,
        project: { userId: input.userId },
      },
      select: { name: true, summary: true },
    });
    if (!target) throw new ProjectAssetTaskError("目标资产不存在", 404);
    return { name: target.name, facts: target.summary };
  }
  const target = await prisma.novelProp.findFirst({
    where: {
      id: input.targetId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
    select: { name: true, summary: true, metadataJson: true },
  });
  if (!target) throw new ProjectAssetTaskError("目标资产不存在", 404);
  return {
    name: target.name,
    facts: [target.summary, target.metadataJson].filter(Boolean),
  };
}

async function createTargetEntity(input: CreateProjectImageTaskInput) {
  if (input.targetType === "character") {
    const target = await prisma.novelCharacter.findFirst({
      where: {
        id: input.targetId,
        projectId: input.projectId,
        project: { userId: input.userId },
      },
      select: { id: true },
    });
    if (!target) throw new ProjectAssetTaskError("目标资产不存在", 404);
    if (input.targetAppearanceId) {
      const appearance = await prisma.characterAppearance.findFirst({
        where: {
          id: input.targetAppearanceId,
          characterId: input.targetId,
          character: { projectId: input.projectId },
        },
        select: { id: true },
      });
      if (!appearance) throw new ProjectAssetTaskError("角色外观不存在", 404);
      return { id: appearance.id, entityType: "character_appearance" as const };
    }
    const row = await prisma.characterAppearance.create({
      data: {
        id: randomUUID(),
        characterId: input.targetId,
        appearanceIndex: await nextAppearanceIndex(input.targetId),
        description: input.prompt,
      },
    });
    return { id: row.id, entityType: "character_appearance" as const };
  }

  if (input.targetType === "location") {
    const target = await prisma.novelLocation.findFirst({
      where: {
        id: input.targetId,
        projectId: input.projectId,
        project: { userId: input.userId },
      },
      select: { id: true },
    });
    if (!target) throw new ProjectAssetTaskError("目标资产不存在", 404);
    const row = await prisma.locationImage.create({
      data: {
        id: randomUUID(),
        locationId: input.targetId,
        imageIndex: await nextLocationIndex(input.targetId),
        description: input.prompt,
      },
    });
    return { id: row.id, entityType: "location_image" as const };
  }

  const prop = await prisma.novelProp.findFirst({
    where: {
      id: input.targetId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
    select: { id: true },
  });
  if (!prop) throw new ProjectAssetTaskError("目标资产不存在", 404);
  return { id: prop.id, entityType: "prop" as const };
}

async function findExplicitReferenceImages(input: CreateProjectImageTaskInput) {
  const assets = await listOwnedProjectMediaAssets(
    input.userId,
    input.projectId,
    input.referenceAssetIds ?? [],
    ["image"],
  );
  return assets.map((asset) => ({
    url: asset.url,
    storageKey: asset.storageKey ?? undefined,
    mimeType: asset.mimeType ?? undefined,
  }));
}

async function findSelectedReferenceImages(input: CreateProjectImageTaskInput) {
  if (input.targetType === "character") {
    const rows = await prisma.characterAppearance.findMany({
      where: {
        characterId: input.targetId,
        selected: true,
        imageAsset: { url: { not: null } },
      },
      include: {
        imageAsset: { select: { url: true, storageKey: true, mimeType: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 3,
    });
    return rows.flatMap((row) =>
      row.imageAsset?.url
        ? [
            {
              url: row.imageAsset.url,
              storageKey: row.imageAsset.storageKey ?? undefined,
              mimeType: row.imageAsset.mimeType ?? undefined,
            },
          ]
        : [],
    );
  }

  if (input.targetType === "location") {
    const rows = await prisma.locationImage.findMany({
      where: {
        locationId: input.targetId,
        selected: true,
        imageAsset: { url: { not: null } },
      },
      include: {
        imageAsset: { select: { url: true, storageKey: true, mimeType: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 3,
    });
    return rows.flatMap((row) =>
      row.imageAsset?.url
        ? [
            {
              url: row.imageAsset.url,
              storageKey: row.imageAsset.storageKey ?? undefined,
              mimeType: row.imageAsset.mimeType ?? undefined,
            },
          ]
        : [],
    );
  }

  const references = await prisma.assetReference.findMany({
    where: {
      projectId: input.projectId,
      entityType: "prop",
      entityId: input.targetId,
      role: "selected",
      mediaAsset: { kind: "image", url: { not: null } },
    },
    include: {
      mediaAsset: { select: { url: true, storageKey: true, mimeType: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  return references.flatMap((reference) =>
    reference.mediaAsset.url
      ? [
          {
            url: reference.mediaAsset.url,
            storageKey: reference.mediaAsset.storageKey ?? undefined,
            mimeType: reference.mediaAsset.mimeType ?? undefined,
          },
        ]
      : [],
  );
}

async function findStoryboardReferenceImages(input: {
  projectId: string;
  characters: string[];
  props?: string[];
  locationName: string | null;
}) {
  const references: Array<{
    url: string;
    storageKey?: string;
    mimeType?: string;
  }> = [];
  const names = input.characters.map((name) => name.trim()).filter(Boolean);
  if (names.length) {
    const characters = await prisma.novelCharacter.findMany({
      where: {
        projectId: input.projectId,
        OR: names.flatMap((name) => [
          { name },
          { aliases: { contains: name } },
        ]),
      },
      select: {
        appearances: {
          where: { selected: true, imageAsset: { url: { not: null } } },
          include: {
            imageAsset: {
              select: { url: true, storageKey: true, mimeType: true },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });
    for (const character of characters) {
      const asset = character.appearances[0]?.imageAsset;
      if (asset?.url)
        references.push({
          url: asset.url,
          storageKey: asset.storageKey ?? undefined,
          mimeType: asset.mimeType ?? undefined,
        });
    }
  }
  if (input.locationName?.trim()) {
    const location = await prisma.novelLocation.findFirst({
      where: { projectId: input.projectId, name: input.locationName.trim() },
      select: {
        images: {
          where: { selected: true, imageAsset: { url: { not: null } } },
          include: {
            imageAsset: {
              select: { url: true, storageKey: true, mimeType: true },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });
    const asset = location?.images[0]?.imageAsset;
    if (asset?.url)
      references.push({
        url: asset.url,
        storageKey: asset.storageKey ?? undefined,
        mimeType: asset.mimeType ?? undefined,
      });
  }
  const propNames =
    input.props?.map((name) => name.trim()).filter(Boolean) ?? [];
  if (propNames.length) {
    const props = await prisma.novelProp.findMany({
      where: { projectId: input.projectId, name: { in: propNames } },
      select: { id: true },
    });
    if (props.length) {
      const propAssets = await prisma.assetReference.findMany({
        where: {
          projectId: input.projectId,
          entityType: "prop",
          entityId: { in: props.map((prop) => prop.id) },
          role: "selected",
          mediaAsset: { kind: "image", url: { not: null } },
        },
        select: {
          mediaAsset: {
            select: { url: true, storageKey: true, mimeType: true },
          },
        },
      });
      for (const reference of propAssets) {
        const asset = reference.mediaAsset;
        if (asset.url)
          references.push({
            url: asset.url,
            storageKey: asset.storageKey ?? undefined,
            mimeType: asset.mimeType ?? undefined,
          });
      }
    }
  }
  const seen = new Set<string>();
  return references
    .filter((reference) => {
      if (seen.has(reference.url)) return false;
      seen.add(reference.url);
      return true;
    })
    .slice(0, 9);
}

function withAssetContinuityRequirements(
  targetType: ProjectAssetTarget,
  prompt: string,
) {
  if (targetType === "character")
    return [
      prompt,
      "角色主设定图，不是剧情场景图。使用干净无文字的浅色背景，在同一张宽幅画面中清晰呈现头像特写、全身正面、全身侧面、全身背面；四个视图必须是同一个人、同一套服装、同一发型、同一配饰与配色，比例和细节一致。不要多余人物、不要镜面反射、不要文字、水印或拼贴边框。",
    ].join("\n");
  if (targetType === "location")
    return [
      prompt,
      "影视场景主设定图，不是一次性气氛图。清晰固定空间布局、主要出入口、训练区或行动区、不可移动地标、光源方向和关键陈设的位置，便于后续镜头从不同机位保持同一地点。不要人物、不要文字、水印或会遮挡空间结构的特写。",
    ].join("\n");
  return prompt;
}

function withStoryboardImageContinuityRequirements(input: {
  prompt: string;
  characters: string[];
  props: string[];
  locationName: string | null;
  environmentDirective?: string;
}) {
  const anchors = [
    input.characters.length ? `角色锚点：${input.characters.join("、")}` : null,
    input.locationName ? `场景锚点：${input.locationName}` : null,
    input.props.length ? `关键道具锚点：${input.props.join("、")}` : null,
  ].filter(Boolean);
  return [
    input.prompt,
    "连续性约束：严格匹配提供的角色、场景和道具参考图；同一角色保持脸部、发型、服装、体型和配色不变，同一场景保持空间布局、主光方向和固定地标不变，同一关键道具保持单一实例和一致外观。",
    ...anchors,
    ...(input.environmentDirective ? [input.environmentDirective] : []),
  ].join("\n");
}

function storyboardEnvironmentDirective(
  panel: Pick<StoryboardEventBlueprintPanel, "startStateJson" | "endStateJson">,
  episode?: { description?: string | null; novelText?: string | null },
) {
  const startState = asBlueprintRecord(
    parseStoredJsonValue(panel.startStateJson, {}),
  );
  const endState = asBlueprintRecord(
    parseStoredJsonValue(panel.endStateJson, {}),
  );
  const startEnvironment = asBlueprintRecord(startState.environmentState);
  const endEnvironment = asBlueprintRecord(endState.environmentState);
  const timeAndLight = {
    weather: startEnvironment.weather ?? endEnvironment.weather,
    keyLightSource:
      startEnvironment.keyLightSource ?? endEnvironment.keyLightSource,
    lightDirection:
      startEnvironment.lightDirection ?? endEnvironment.lightDirection,
    particles: startEnvironment.particles ?? endEnvironment.particles,
  };
  const specified = Object.values(timeAndLight).some(
    (value) => value !== null && value !== undefined && value !== "",
  );
  const episodeTime = stableEpisodeTimeOfDay(episode);
  if (!specified && !episodeTime) return "";
  const effectiveTimeAndLight =
    episodeTime === "night"
      ? {
          ...timeAndLight,
          weather: "夜间",
          keyLightSource: "与当前场景相符的低照度实景光源",
        }
      : episodeTime === "day"
        ? {
            ...timeAndLight,
            weather: "白天",
            keyLightSource: "与当前场景相符的日间实景光源",
          }
        : timeAndLight;
  const summary = formatBlueprintRecord(effectiveTimeAndLight);
  const darkScene =
    episodeTime === "night" ||
    /夜|傍晚|黄昏|暮色|月光|灯笼|烛光|night|evening|dusk|moon|lantern|candle/i.test(
      summary,
    );
  const dayScene =
    episodeTime === "day" ||
    /白天|日间|日光|阳光|晴|daylight|sunlight|daytime|clear sky/i.test(summary);
  return [
    ...(episodeTime
      ? [
          `本集剧情时间锚点（最高优先级）：${episodeTime === "night" ? "夜间" : "白天"}。原文没有明确时间跳转时，换场不得改变昼夜。`,
        ]
      : []),
    `本镜结构化环境状态：${summary}。角色、场景和道具参考图中的展示灯光不得覆盖本镜剧情时间。`,
    ...(darkScene
      ? [
          "本镜必须呈现低照度夜间或暮色环境；忽略任何与剧情时间锚点冲突的展示灯光。窗外不得出现明亮昼景。",
        ]
      : dayScene
        ? ["本镜为日间环境，除非剧情明确要求，不得擅自改为月夜或深夜。"]
        : []),
  ].join("\n");
}

function reconcileStoryboardPromptTime(
  value: string,
  episode?: { description?: string | null; novelText?: string | null },
) {
  const time = stableEpisodeTimeOfDay(episode);
  if (time === "night")
    return value
      .replace(/weather\s*=\s*晴/gi, "weather=夜间")
      .replace(/keyLightSource\s*=\s*窗外日光/gi, "keyLightSource=夜间实景光")
      .replace(/窗外(?:左侧|右侧)?自然光/gi, "窗外低照度夜色")
      .replace(/soft natural daylight(?: from [^,;\n]+)?/gi, "低照度夜间实景光")
      .replace(/窗外日光|日光|阳光/gi, "夜间环境光")
      .replace(/自然光/gi, "低照度夜间实景光");
  if (time === "day")
    return value
      .replace(/weather\s*=\s*(?:深夜|夜间|冬夜)/gi, "weather=白天")
      .replace(
        /keyLightSource\s*=\s*(?:月光|灯笼|烛光)/gi,
        "keyLightSource=日间实景光",
      )
      .replace(/cold winter night|moonlight|nighttime/gi, "日间自然环境");
  return value;
}

function stableEpisodeTimeOfDay(episode?: {
  description?: string | null;
  novelText?: string | null;
}): "day" | "night" | null {
  const description = episode?.description?.trim() ?? "";
  const source = episode?.novelText?.trim() ?? "";
  const context = `${description}\n${source}`;
  if (!context.trim()) return null;
  const nightMatch = context.match(
    /夜幕降临|入夜|深夜|夜色|冬夜|夜晚|夜间|傍晚|黄昏|暮色|after nightfall|at night|nighttime|evening|dusk/i,
  );
  const dayMatch = context.match(
    /白昼|白天|日间|清晨|早晨|正午|中午|下午|daytime|morning|noon|afternoon/i,
  );
  if (!nightMatch && !dayMatch) return null;
  const firstTime =
    nightMatch && (!dayMatch || (nightMatch.index ?? 0) < (dayMatch.index ?? 0))
      ? "night"
      : "day";
  const transitionPattern =
    firstTime === "night"
      ? /次日|翌日|第二天|天亮|破晓|清晨|早晨|正午|中午|下午|白昼|白天|日间|next day|dawn|morning|noon|afternoon|daytime/i
      : /当晚|入夜|夜幕降临|深夜|夜色|夜晚|夜间|傍晚|黄昏|暮色|that night|nightfall|nighttime|evening|dusk/i;
  return transitionPattern.test(
    context.slice(
      firstTime === "night"
        ? (nightMatch?.index ?? 0) + nightMatch![0].length
        : (dayMatch?.index ?? 0) + dayMatch![0].length,
    ),
  )
    ? null
    : firstTime;
}

function parseStringArray(value: string | null) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

async function nextAppearanceIndex(characterId: string) {
  const row = await prisma.characterAppearance.findFirst({
    where: { characterId },
    orderBy: { appearanceIndex: "desc" },
    select: { appearanceIndex: true },
  });
  return (row?.appearanceIndex ?? -1) + 1;
}

async function nextLocationIndex(locationId: string) {
  const row = await prisma.locationImage.findFirst({
    where: { locationId },
    orderBy: { imageIndex: "desc" },
    select: { imageIndex: true },
  });
  return (row?.imageIndex ?? -1) + 1;
}

export class ProjectAssetTaskError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function enqueueProjectTask(
  userId: string,
  task: Parameters<typeof enqueuePersistedMediaTask>[1],
) {
  try {
    return await enqueuePersistedMediaTask(userId, task);
  } catch (error) {
    if (error instanceof BillingError)
      throw new ProjectAssetTaskError(error.message, error.status);
    throw error;
  }
}
