import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/server/prisma";
import { createMediaTask } from "./task-contract";
import { createDatabaseMediaTaskStore } from "./task-store";
import { enqueuePersistedMediaTask } from "./task-submit";
import { BillingError } from "@/lib/billing/service";
import { resolveStoredMediaUrl, storeMediaBytes } from "@/lib/storage";
import {
  linkSourceAssets,
  listOwnedProjectMediaAssets,
} from "@/lib/assets/project-store";
import { isMediaChannelProtocol } from "@/lib/providers/media/registry";
import {
  mergeAudioUrls,
  probeAudioUrlDuration,
} from "@/lib/providers/local/ffmpeg-audio";
import { planPanelDialogue } from "@/lib/media/dialogue-timeline";
import { getAutoDlWorkflow } from "@/lib/providers/media/autodl-comfyui-workflows";

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
      prompt: withAssetContinuityRequirements(input.targetType, input.prompt),
      ratio: input.ratio ?? "1:1",
      resolution: input.resolution ?? "2k",
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
      prompt: withStoryboardImageContinuityRequirements({
        prompt,
        characters: parseStringArray(panel.charactersJson),
        props: parseStringArray(panel.propsJson),
        locationName: panel.locationName,
      }),
      ratio: input.ratio ?? "16:9",
      resolution: input.resolution ?? "2k",
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
  const generatesNativeAudio =
    channel.protocol === "autodl-comfyui" &&
    Boolean(getAutoDlWorkflow(input.model)?.generatesNativeAudio);

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
      parseDurationSeconds(input.duration) ?? panel.durationSeconds ?? 5,
    useNativeAudio: generatesNativeAudio,
  });
  const dialoguePrompt = dialogue.lines.length
    ? dialogueVideoPrompt({
        description: panel.description ?? basePrompt,
        durationSeconds: dialogue.durationSeconds,
        lines: dialogue.lines,
        playbackRate: dialogue.playbackRate,
        timings: dialogue.timings,
        nativeAudio: generatesNativeAudio,
      })
    : basePrompt;
  const prompt = withStoryboardVideoContinuityRequirements({
    prompt: dialoguePrompt,
    characters: parseStringArray(panel.charactersJson),
    props: parseStringArray(panel.propsJson),
    locationName: panel.locationName,
  });
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
      prompt,
      ratio: input.ratio ?? "16:9",
      resolution: input.resolution ?? "720p",
      duration: `${dialogue.durationSeconds}s`,
      format: "mp4",
      videoMode: input.mode ?? "reference",
      ...(referenceImages.length ? { referenceImages: referenceImages.slice(0, 9) } : {}),
      ...(dialogue.references.length
        ? { referenceAudios: dialogue.references }
        : {}),
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
      referenceAudioCount: dialogue.references.length,
    },
  };
}

async function prepareStoryboardDialogue(input: {
  projectId: string;
  episodeId: string;
  panelId: string;
  requestedDurationSeconds: number;
  useNativeAudio: boolean;
}) {
  const lines = await prisma.voiceLine.findMany({
    where: {
      episodeId: input.episodeId,
      matchedPanelId: input.panelId,
      episode: { projectId: input.projectId },
      ...(!input.useNativeAudio ? { audioAsset: { isNot: null } } : {}),
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
    if (!input.useNativeAudio && !url) continue;
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
  if (input.useNativeAudio)
    return {
      durationSeconds: plan.durationSeconds,
      lines: resolved,
      playbackRate: plan.playbackRate,
      references: [] as Array<{ url: string; mimeType?: string }>,
      timings: plan.timings,
    };
  const mergedUrl = await mergeAudioUrls(
    resolved.map((line) => line.url),
    { playbackRate: plan.playbackRate },
  );
  const mergedBytes = dataUrlBytes(mergedUrl, "audio/mpeg");
  const storageKey = await storeMediaBytes(
    mergedBytes,
    `projects/${input.projectId}/storyboard/dialogue/${input.panelId}-${randomUUID()}.mp3`,
    "audio/mpeg",
  );
  const referenceUrl = await resolveStoredMediaUrl(storageKey);
  return {
    durationSeconds: plan.durationSeconds,
    lines: resolved,
    playbackRate: plan.playbackRate,
    references: [{ url: referenceUrl, mimeType: "audio/mpeg" }],
    timings: plan.timings,
  };
}

function dialogueVideoPrompt(input: {
  description: string;
  durationSeconds: number;
  lines: Array<{ speaker: string; content: string; delivery: string }>;
  playbackRate: number;
  timings: Array<{ lineIndex: number; startSeconds: number; endSeconds: number }>;
  nativeAudio: boolean;
}) {
  const timingLines = input.timings.map((timing) => {
    const line = input.lines[timing.lineIndex];
    return line.delivery === "dialogue"
      ? `${timing.startSeconds.toFixed(2)}-${timing.endSeconds.toFixed(2)}s | ${line.speaker}说：“${line.content}” | 仅说话角色自然口型，其他角色保持倾听和细微反应`
      : `${timing.startSeconds.toFixed(2)}-${timing.endSeconds.toFixed(2)}s | ${line.speaker}内心独白：“${line.content}” | 声音属于${line.speaker}，画面中所有人物保持闭口，不做口型，只保留自然呼吸、目光和反应`;
  });
  const secondBeats = Array.from(
    { length: input.durationSeconds },
    (_value, second) => {
      const active = input.timings.find(
        (timing) => timing.startSeconds < second + 1 && timing.endSeconds > second,
      );
      const action = active
        ? input.lines[active.lineIndex].delivery === "dialogue"
          ? `${input.lines[active.lineIndex].speaker}持续当前对白与自然表演，其他角色保持视线和反应连续`
          : `${input.lines[active.lineIndex].speaker}在内心独白中保持闭口与克制反应，所有人物均不得做口型`
        : "对白间隙，人物保持自然呼吸、视线和克制反应";
      return `${second}-${second + 1}s | ${action} | 镜头保持同侧轴线并做轻微稳定推进`;
    },
  );
  return [
    `总时长：${input.durationSeconds}s`,
    `场景与动作：${input.description}`,
    input.nativeAudio
      ? "原生声音：生成自然的中文角色对白、内心独白、呼吸和匹配场景的环境声。必须完整使用以下台词顺序，不得重排、截断或新增台词；内心独白没有任何人物口型；不要生成画面内字幕、文字或水印。"
      : `对白音频：已按台词顺序合成${input.playbackRate > 1 ? `，整体语速调整为 ${input.playbackRate.toFixed(2)} 倍` : ""}，必须完整使用且不得重排、截断或新增台词。`,
    "对白时序：",
    ...timingLines,
    "逐秒表演与运镜：",
    ...secondBeats,
    "连续性：角色身份、服装、站位、视线、光向和空间轴线前后一致；口型只跟随当前说话者，避免多人同时开口、跳帧、瞬移或动作重置。",
  ].join("\n");
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

function dataUrlBytes(value: string, expectedMimeType: string) {
  const match = value.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match || match[1] !== expectedMimeType)
    throw new Error("DIALOGUE_AUDIO_DATA_URL_INVALID");
  return Buffer.from(match[2], "base64");
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
