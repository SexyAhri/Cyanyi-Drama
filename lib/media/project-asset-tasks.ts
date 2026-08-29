import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/server/prisma";
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
import { probeAudioUrlDuration } from "@/lib/providers/local/ffmpeg-audio";
import { planPanelDialogue } from "@/lib/media/dialogue-timeline";
import { sanitizeMediaPrompt } from "@/lib/media/provider-prompt-safety";
import {
  applyProjectArtStyle,
  getProjectArtStyleLabel,
} from "@/lib/projects/art-style";
import type { MediaGenerationDefaults } from "@/lib/settings/runtime-contract";

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
    where: { id: input.channelId, userId: input.userId },
  });
  if (
    !channel ||
    !isMediaChannelProtocol(channel.protocol)
  ) {
    throw new ProjectAssetTaskError(
      "图片生成需要有效且受支持的媒体渠道",
      400,
    );
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
    ...(input.useSelectedReference
      ? selectedReferenceImages
      : []),
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
        withAssetContinuityRequirements(input.targetType, input.prompt),
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
}) {
  const channel = await prisma.channel.findFirst({
    where: { id: input.channelId, userId: input.userId },
    select: { id: true, protocol: true, providerKey: true },
  });
  if (
    !channel ||
    !isMediaChannelProtocol(channel.protocol)
  ) {
    throw new ProjectAssetTaskError(
      "图片生成需要有效且受支持的媒体渠道",
      400,
    );
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
    },
  });
  if (!panel) throw new ProjectAssetTaskError("分镜格不存在", 404);
  const prompt =
    input.prompt?.trim() || panel.imagePrompt?.trim() || panel.description?.trim();
  if (!prompt) throw new ProjectAssetTaskError("分镜格缺少图片提示词", 400);

  const referenceImages = await findStoryboardReferenceImages({
    projectId: input.projectId,
    characters: parseStringArray(panel.charactersJson),
    props: parseStringArray(panel.propsJson),
    locationName: panel.locationName,
  });
  const artStyle = await loadProjectArtStyle(input.projectId);
  const task = createMediaTask({
    id: `media_task_${randomUUID()}`,
    projectId: input.projectId,
    episodeId: input.episodeId,
    batchId: input.batchId,
    channelId: input.channelId,
    targetType: "storyboard_panel",
    targetId: panel.id,
    kind: "image",
    provider: channel.providerKey,
    protocol: channel.protocol,
    model: input.model,
    request: {
      prompt: applyProjectArtStyle(
        withStoryboardImageContinuityRequirements({
          prompt,
          characters: parseStringArray(panel.charactersJson),
          props: parseStringArray(panel.propsJson),
          locationName: panel.locationName,
        }),
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
  const store = createDatabaseMediaTaskStore(input.userId);
  await store.create(task);
  const queued = await enqueueProjectTask(input.userId, task);
  return {
    task: queued,
    panel: { id: panel.id, referenceCount: referenceImages.length },
  };
}

export async function createStoryboardPanelVideoTask(input: {
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
}) {
  const channel = await prisma.channel.findFirst({
    where: { id: input.channelId, userId: input.userId },
    select: { id: true, protocol: true, providerKey: true },
  });
  if (
    !channel ||
    !isMediaChannelProtocol(channel.protocol)
  ) {
    throw new ProjectAssetTaskError(
      "视频生成需要有效且受支持的媒体渠道",
      400,
    );
  }
  const selectedModel = await prisma.providerModel.count({
    where: {
      channelId: input.channelId,
      modelId: input.model,
      selected: true,
      OR: [
        { modelType: "video" },
        { capabilitiesJson: { contains: '"video"' } },
      ],
    },
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
      videoPrompt: true,
      firstLastFramePrompt: true,
      actingNotesJson: true,
      imageAsset: {
        select: { url: true, storageKey: true, mimeType: true },
      },
      charactersJson: true,
      propsJson: true,
      locationName: true,
    },
  });
  if (!panel) throw new ProjectAssetTaskError("分镜格不存在", 404);
  const basePrompt =
    input.prompt?.trim() ||
    (input.mode === "first-last"
      ? panel.firstLastFramePrompt?.trim()
      : panel.videoPrompt?.trim()) ||
    panel.description?.trim();
  if (!basePrompt) throw new ProjectAssetTaskError("分镜格缺少视频提示词", 400);

  const supportingReferences = await findStoryboardReferenceImages({
    projectId: input.projectId,
    characters: parseStringArray(panel.charactersJson),
    props: parseStringArray(panel.propsJson),
    locationName: panel.locationName,
  });
  const referenceImages: Array<{
    url: string;
    mimeType?: string;
    role?: "reference_image" | "first_frame" | "last_frame";
  }> = [];
  if (input.mode === "first-last") {
    const firstFrameUrl = await mediaAssetUrl(panel.imageAsset);
    const lastFrame = await findLastFramePanel({
      userId: input.userId,
      projectId: input.projectId,
      episodeId: input.episodeId,
      storyboardId: panel.storyboardId,
      panelIndex: panel.panelIndex,
      linkedToNextPanel: panel.linkedToNextPanel,
      lastFramePanelId: input.lastFramePanelId,
    });
    const lastFrameUrl = await mediaAssetUrl(lastFrame?.imageAsset);
    if (!firstFrameUrl || !lastFrameUrl)
      throw new ProjectAssetTaskError("首尾帧模式需要首帧和尾帧图片", 400);
    referenceImages.push(
      {
        url: firstFrameUrl,
        mimeType: panel.imageAsset?.mimeType ?? undefined,
        role: "first_frame",
      },
      {
        url: lastFrameUrl,
        mimeType: lastFrame?.imageAsset?.mimeType ?? undefined,
        role: "last_frame",
      },
    );
  } else {
    const panelImageUrl = await mediaAssetUrl(panel.imageAsset);
    if (panelImageUrl)
      referenceImages.push({
        url: panelImageUrl,
        mimeType: panel.imageAsset?.mimeType ?? undefined,
        role: "reference_image",
      });
  }
  referenceImages.push(
    ...supportingReferences.map((reference) => ({
      ...reference,
      role: "reference_image" as const,
    })),
  );
  const dialogue = await prepareStoryboardDialogue({
    projectId: input.projectId,
    episodeId: input.episodeId,
    panelId: panel.id,
    requestedDurationSeconds:
      parseDurationSeconds(input.duration) ??
      panel.durationSeconds ??
      parseDurationSeconds(input.mediaDefaults?.videoGenerationDuration) ??
      5,
  });
  const dialoguePrompt = dialogueVideoPrompt({
    description: panel.description ?? basePrompt,
    motionPrompt: basePrompt,
    actingDirections: parseStoryboardActingDirections(panel.actingNotesJson),
    durationSeconds: dialogue.durationSeconds,
    lines: dialogue.lines,
    playbackRate: dialogue.playbackRate,
    timings: dialogue.timings,
  });
  const prompt = withStoryboardVideoContinuityRequirements({
    prompt: dialoguePrompt,
    characters: parseStringArray(panel.charactersJson),
    props: parseStringArray(panel.propsJson),
    locationName: panel.locationName,
  });
  const artStyle = await loadProjectArtStyle(input.projectId);
  const task = createMediaTask({
    id: `media_task_${randomUUID()}`,
    projectId: input.projectId,
    episodeId: input.episodeId,
    batchId: input.batchId,
    channelId: input.channelId,
    targetType: "storyboard_panel",
    targetId: panel.id,
    kind: "video",
    provider: channel.providerKey,
    protocol: channel.protocol,
    model: input.model,
    request: {
      prompt: applyProjectArtStyle(prompt, artStyle, "zh"),
      ratio: input.ratio ?? input.mediaDefaults?.videoGenerationRatio ?? "16:9",
      resolution:
        input.resolution ??
        input.mediaDefaults?.videoGenerationResolution ??
        "1080p",
      duration: `${dialogue.durationSeconds}s`,
      format: "mp4",
      audioMode: "ambient_only",
      videoMode: input.mode ?? "reference",
      ...(referenceImages.length ? { referenceImages: referenceImages.slice(0, 9) } : {}),
    },
  });
  const store = createDatabaseMediaTaskStore(input.userId);
  await store.create(task);
  const queued = await enqueueProjectTask(input.userId, task);
  return {
    task: queued,
    panel: {
      id: panel.id,
      referenceCount: referenceImages.length,
      referenceAudioCount: 0,
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
  referenceCount: number;
  safetyRewrites: ReturnType<typeof sanitizeMediaPrompt>["changes"];
  sources: Array<{
    key: string;
    label: string;
    value: string;
  }>;
};

export async function previewStoryboardPanelPrompt(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  panelId: string;
  kind: "image" | "video";
  prompt?: string;
  mode?: "reference" | "first-last";
  lastFramePanelId?: string;
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
      actingNotesJson: true,
      charactersJson: true,
      propsJson: true,
      locationName: true,
      imageAsset: {
        select: { url: true, storageKey: true, mimeType: true },
      },
    },
  });
  if (!panel) throw new ProjectAssetTaskError("分镜格不存在", 404);

  const characters = parseStringArray(panel.charactersJson);
  const props = parseStringArray(panel.propsJson);
  const basePrompt =
    input.prompt?.trim() ||
    (input.kind === "image"
      ? panel.imagePrompt?.trim()
      : input.mode === "first-last"
        ? panel.firstLastFramePrompt?.trim()
        : panel.videoPrompt?.trim()) ||
    panel.description?.trim() ||
    "";
  const issues: StoryboardPromptPreview["issues"] = [];
  if (!basePrompt)
    issues.push({
      blocking: true,
      code: "missing_prompt",
      message: input.kind === "image" ? "缺少图片提示词" : "缺少视频提示词",
    });

  const supportingReferences = await findStoryboardReferenceImages({
    projectId: input.projectId,
    characters,
    props,
    locationName: panel.locationName,
  });
  const artStyle = await loadProjectArtStyle(input.projectId);
  let referenceCount = supportingReferences.length;
  let compiledPrompt = "";
  const sources: StoryboardPromptPreview["sources"] = [
    {
      key: "art_style",
      label: "项目画风",
      value: getProjectArtStyleLabel(artStyle, "zh"),
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

  if (input.kind === "image") {
    compiledPrompt = applyProjectArtStyle(
      withStoryboardImageContinuityRequirements({
        prompt: basePrompt,
        characters,
        props,
        locationName: panel.locationName,
      }),
      artStyle,
      "zh",
    );
  } else {
    if (input.mode === "first-last") {
      const firstFrameUrl = await mediaAssetUrl(panel.imageAsset);
      const lastFrame = await findLastFramePanel({
        userId: input.userId,
        projectId: input.projectId,
        episodeId: input.episodeId,
        storyboardId: panel.storyboardId,
        panelIndex: panel.panelIndex,
        linkedToNextPanel: panel.linkedToNextPanel,
        lastFramePanelId: input.lastFramePanelId,
      });
      const lastFrameUrl = await mediaAssetUrl(lastFrame?.imageAsset);
      if (!firstFrameUrl || !lastFrameUrl)
        issues.push({
          blocking: true,
          code: "missing_first_last_frame",
          message: "首尾帧模式需要当前镜头首帧和已关联的下一镜头图片",
        });
      referenceCount += Number(Boolean(firstFrameUrl)) + Number(Boolean(lastFrameUrl));
      sources.push({
        key: "frame_mode",
        label: "画面参考",
        value: `${Number(Boolean(firstFrameUrl)) + Number(Boolean(lastFrameUrl))}/2 张首尾帧`,
      });
    } else {
      const firstFrameUrl = await mediaAssetUrl(panel.imageAsset);
      if (!firstFrameUrl)
        issues.push({
          blocking: true,
          code: "missing_reference_frame",
          message: "参考图模式需要先选择当前镜头图片",
        });
      referenceCount += Number(Boolean(firstFrameUrl));
      sources.push({
        key: "frame_mode",
        label: "画面参考",
        value: firstFrameUrl ? "已选择当前镜头参考图" : "缺少当前镜头参考图",
      });
    }

    const lines = await prisma.voiceLine.findMany({
      where: {
        episodeId: input.episodeId,
        matchedPanelId: panel.id,
        episode: { projectId: input.projectId },
      },
      orderBy: { lineIndex: "asc" },
      select: {
        speaker: true,
        content: true,
        delivery: true,
        durationSeconds: true,
        audioAssetId: true,
      },
    });
    const missingAudio = lines.filter((line) => !line.audioAssetId);
    if (missingAudio.length)
      issues.push({
        blocking: true,
        code: "missing_dialogue_audio",
        message: `${missingAudio.length} 句关联对白尚未生成配音`,
      });
    let dialoguePrompt = basePrompt;
    if (lines.length) {
      try {
        const plan = planPanelDialogue({
          lineDurations: lines.map(
            (line) => line.durationSeconds ?? estimateSpokenDuration(line.content),
          ),
          requestedDurationSeconds: panel.durationSeconds ?? 5,
        });
        dialoguePrompt = dialogueVideoPrompt({
          description: panel.description ?? basePrompt,
          motionPrompt: basePrompt,
          actingDirections: parseStoryboardActingDirections(panel.actingNotesJson),
          durationSeconds: plan.durationSeconds,
          lines,
          playbackRate: plan.playbackRate,
          timings: plan.timings,
        });
        sources.push({
          key: "dialogue_timing",
          label: "对白节奏",
          value: `${lines.length} 句 · ${plan.durationSeconds} 秒 · ${plan.playbackRate.toFixed(2)}x`,
        });
      } catch (error) {
        issues.push({
          blocking: true,
          code: "dialogue_timing_invalid",
          message:
            error instanceof Error && error.message.startsWith("DIALOGUE_REQUIRES_SHOT_SPLIT")
              ? "对白总时长超过单镜头容量，需要拆分镜头"
              : "对白时长无法编排",
        });
      }
    }
    compiledPrompt = applyProjectArtStyle(
      withStoryboardVideoContinuityRequirements({
        prompt: dialoguePrompt,
        characters,
        props,
        locationName: panel.locationName,
      }),
      artStyle,
      "zh",
    );
  }

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
    kind: input.kind,
    referenceCount,
    safetyRewrites: sanitized.changes,
    sources,
  };
}

async function prepareStoryboardDialogue(input: {
  projectId: string;
  episodeId: string;
  panelId: string;
  requestedDurationSeconds: number;
}) {
  const lines = await prisma.voiceLine.findMany({
    where: {
      episodeId: input.episodeId,
      matchedPanelId: input.panelId,
      episode: { projectId: input.projectId },
    },
    orderBy: { lineIndex: "asc" },
    select: {
      id: true,
      speaker: true,
      content: true,
      delivery: true,
      durationSeconds: true,
      audioAsset: {
        select: { url: true, storageKey: true, mimeType: true },
      },
    },
  });
  const resolved: Array<{
    id: string;
    speaker: string;
    content: string;
    delivery: string;
    durationSeconds: number;
    url: string;
  }> = [];
  for (const line of lines) {
    const url = await mediaAssetUrl(line.audioAsset);
    if (!url)
      throw new ProjectAssetTaskError(
        `镜头对白“${line.content}”尚未生成配音，请先用声音模型生成后再制作视频`,
        409,
      );
    const durationSeconds =
      line.durationSeconds ??
      (url ? await probeAudioUrlDuration(url) : estimateSpokenDuration(line.content));
    resolved.push({
      id: line.id,
      speaker: line.speaker,
      content: line.content,
      delivery: line.delivery,
      durationSeconds,
      url: url ?? "",
    });
    if (line.durationSeconds === null && url)
      await prisma.voiceLine.update({
        where: { id: line.id },
        data: { durationSeconds },
      });
  }
  if (!resolved.length)
    return {
      durationSeconds: Math.max(1, Math.min(15, input.requestedDurationSeconds)),
      lines: [],
      playbackRate: 1,
      references: [] as Array<{ url: string; mimeType?: string }>,
      timings: [],
    };

  const plan = planPanelDialogue({
    lineDurations: resolved.map((line) => line.durationSeconds),
    requestedDurationSeconds: input.requestedDurationSeconds,
  });
  await prisma.storyboardPanel.update({
    where: { id: input.panelId },
    data: { durationSeconds: plan.durationSeconds },
  });
  return {
    durationSeconds: plan.durationSeconds,
    lines: resolved,
    playbackRate: plan.playbackRate,
    references: [] as Array<{ url: string; mimeType?: string }>,
    timings: plan.timings,
  };
}

export function dialogueVideoPrompt(input: {
  description: string;
  motionPrompt: string;
  actingDirections: StoryboardActingDirection[];
  durationSeconds: number;
  lines: Array<{ speaker: string; content: string; delivery: string }>;
  playbackRate: number;
  timings: Array<{ lineIndex: number; startSeconds: number; endSeconds: number }>;
}) {
  const actingByCharacter = new Map(
    input.actingDirections.map((direction) => [direction.name, direction]),
  );
  const performanceDirection = (character: string) => {
    const direction = actingByCharacter.get(character);
    return direction
      ? `心理与情绪“${direction.emotion}”，动作与反应“${direction.action}”，表情变化“${direction.expression}”`
      : "保持符合当前剧情的呼吸、视线、表情和重心变化";
  };
  const timingLines = input.timings.map((timing) => {
    const line = input.lines[timing.lineIndex];
    return line.delivery === "dialogue"
      ? `${timing.startSeconds.toFixed(2)}-${timing.endSeconds.toFixed(2)}s | ${line.speaker}按已生成配音的时长做无声自然口型，同时执行：${performanceDirection(line.speaker)} | 其他角色闭口，并按各自表演指导给出持续倾听、判断或情绪变化的无声反应`
      : `${timing.startSeconds.toFixed(2)}-${timing.endSeconds.toFixed(2)}s | ${line.speaker}的内心独白/画外音时段 | 画面中所有人物保持闭口、不做口型；${line.speaker}通过${performanceDirection(line.speaker)}外化心理变化，其他角色不得感知未说出口的内容`;
  });
  const secondBeats = Array.from(
    { length: input.durationSeconds },
    (_value, second) => {
      const active = input.timings.find(
        (timing) => timing.startSeconds < second + 1 && timing.endSeconds > second,
      );
      const action = active
        ? input.lines[active.lineIndex].delivery === "dialogue"
          ? `${input.lines[active.lineIndex].speaker}持续当前对白，并以${performanceDirection(input.lines[active.lineIndex].speaker)}推进表演；其他角色保持视线和无声反应连续`
          : `${input.lines[active.lineIndex].speaker}在内心独白中保持闭口，以${performanceDirection(input.lines[active.lineIndex].speaker)}呈现思绪变化；所有人物均不得做口型`
        : "对白间隙，人物不能冻结或回到默认中性状态；延续上一拍的呼吸、视线、表情余韵和重心，并对刚发生的动作保持无声反应";
      return `${second}-${second + 1}s | ${action} | 镜头保持同侧轴线并做轻微稳定推进`;
    },
  );
  return [
    `总时长：${input.durationSeconds}s`,
    `场景与动作：${input.description}`,
    `完整分镜运动蓝图：\n${input.motionPrompt}`,
    ...(input.actingDirections.length
      ? [
          "逐角色表演指导：",
          ...input.actingDirections.map(
            (direction) =>
              `${direction.name} | 心理与情绪：${direction.emotion} | 动作与反应：${direction.action} | 表情变化：${direction.expression}`,
          ),
        ]
      : []),
    "表演硬约束：除非逐角色指导明确要求面无表情，否则禁止全程中性脸、僵硬凝视、机械站立或只动嘴不表演。角色要以视线焦点和转移、自然眨眼、呼吸深浅、眉眼嘴角、下颌张力、吞咽、手指与肩颈微动作、身体重心及与他人的无声反应，连续外化已有心理活动和潜台词。每个动作必须有动作前意图、动作中情绪阻力和动作后余韵；保持克制自然，不新增剧情动作、关系、对白或结果。",
    "声音硬约束：只生成与场景匹配的环境声和动作音效。禁止生成任何角色声音、对白、旁白、内心独白、吟唱或其他可辨识人声。角色配音已由独立声音模型生成，将在口型与成片阶段另行合成；本视频不得代替、复述或混入角色配音。不要生成画面内字幕、文字或水印。",
    input.playbackRate > 1
      ? `口型时序已按正式配音调整为 ${input.playbackRate.toFixed(2)} 倍语速，仅用于无声表演同步。`
      : "口型时序来自正式配音，仅用于无声表演同步。",
    "无声口型与画外音时序：",
    ...timingLines,
    "逐秒表演与运镜：",
    ...secondBeats,
    "连续性：角色身份、服装、站位、视线、光向和空间轴线前后一致；口型只跟随当前说话者，避免多人同时开口、跳帧、瞬移或动作重置；音轨始终只有环境声与动作音效。",
  ].join("\n");
}

type StoryboardActingDirection = {
  name: string;
  emotion: string;
  action: string;
  expression: string;
};

function parseStoryboardActingDirections(
  value: string | null,
): StoryboardActingDirection[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const characters = (parsed as Record<string, unknown>).characters;
    if (!Array.isArray(characters)) return [];
    return characters.flatMap((character) => {
      if (!character || typeof character !== "object" || Array.isArray(character))
        return [];
      const item = character as Record<string, unknown>;
      const name = textValue(item.name);
      const emotion = textValue(item.emotion);
      const action = textValue(item.action);
      const expression = textValue(item.expression);
      return name && emotion && action && expression
        ? [{ name, emotion, action, expression }]
        : [];
    });
  } catch {
    return [];
  }
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseDurationSeconds(value?: string) {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function estimateSpokenDuration(content: string) {
  const characters = content.replace(/\s/g, "").length;
  return Math.max(1, Math.ceil(characters / 4.5));
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
  asset:
    | { url: string | null; storageKey: string | null }
    | null
    | undefined,
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
      if (!appearance)
        throw new ProjectAssetTaskError("角色外观不存在", 404);
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
      include: { imageAsset: { select: { url: true, mimeType: true } } },
      orderBy: { updatedAt: "desc" },
      take: 3,
    });
    return rows.flatMap((row) =>
      row.imageAsset?.url
        ? [{ url: row.imageAsset.url, mimeType: row.imageAsset.mimeType ?? undefined }]
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
      include: { imageAsset: { select: { url: true, mimeType: true } } },
      orderBy: { updatedAt: "desc" },
      take: 3,
    });
    return rows.flatMap((row) =>
      row.imageAsset?.url
        ? [{ url: row.imageAsset.url, mimeType: row.imageAsset.mimeType ?? undefined }]
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
    include: { mediaAsset: { select: { url: true, mimeType: true } } },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  return references.flatMap((reference) =>
    reference.mediaAsset.url
      ? [{
          url: reference.mediaAsset.url,
          mimeType: reference.mediaAsset.mimeType ?? undefined,
        }]
      : [],
  );
}

async function findStoryboardReferenceImages(input: {
  projectId: string;
  characters: string[];
  props?: string[];
  locationName: string | null;
}) {
  const references: Array<{ url: string; mimeType?: string }> = [];
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
          include: { imageAsset: { select: { url: true, mimeType: true } } },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });
    for (const character of characters) {
      const asset = character.appearances[0]?.imageAsset;
      if (asset?.url) references.push({ url: asset.url, mimeType: asset.mimeType ?? undefined });
    }
  }
  if (input.locationName?.trim()) {
    const location = await prisma.novelLocation.findFirst({
      where: { projectId: input.projectId, name: input.locationName.trim() },
      select: {
        images: {
          where: { selected: true, imageAsset: { url: { not: null } } },
          include: { imageAsset: { select: { url: true, mimeType: true } } },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });
    const asset = location?.images[0]?.imageAsset;
    if (asset?.url) references.push({ url: asset.url, mimeType: asset.mimeType ?? undefined });
  }
  const propNames = input.props?.map((name) => name.trim()).filter(Boolean) ?? [];
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
        select: { mediaAsset: { select: { url: true, mimeType: true } } },
      });
      for (const reference of propAssets) {
        const asset = reference.mediaAsset;
        if (asset.url)
          references.push({
            url: asset.url,
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
  ].join("\n");
}

function withStoryboardVideoContinuityRequirements(input: {
  prompt: string;
  characters: string[];
  props: string[];
  locationName: string | null;
}) {
  const anchorLines = [
    input.characters.length
      ? `角色锁定：${input.characters.join("、")}。角色脸部、发型、服装、体型、配色和初始朝向必须与参考图和前一镜头保持一致；只有动作时间线明确转身时才改变朝向。`
      : null,
    input.locationName
      ? `场景锁定：${input.locationName}。保持同一空间布局、出入口、固定地标、主光方向和运动轴线。`
      : null,
    input.props.length
      ? `道具锁定：${input.props.join("、")}。同一连续动作中每件关键道具只能有一个实例；不得复制、替换、凭空新增、消失或随换镜头改变位置。摄影机可以换机位，但对象仍是同一实例。`
      : null,
  ].filter(Boolean);
  return [
    input.prompt,
    "跨镜头连续性硬约束：镜头只改变摄影机位置、景别或已写明的角色动作，不得重置人物姿态、生成额外人物或重复关键道具；首帧承接前一镜头的末帧状态，动作沿同一方向连续完成。",
    ...anchorLines,
  ].join("\n");
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
