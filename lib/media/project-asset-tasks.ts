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
      prompt: input.prompt,
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
      prompt,
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
      videoPrompt: true,
      firstLastFramePrompt: true,
      imageAsset: {
        select: { url: true, storageKey: true, mimeType: true },
      },
      charactersJson: true,
      locationName: true,
    },
  });
  if (!panel) throw new ProjectAssetTaskError("分镜格不存在", 404);
  const prompt =
    input.prompt?.trim() ||
    (input.mode === "first-last"
      ? panel.firstLastFramePrompt?.trim()
      : panel.videoPrompt?.trim()) ||
    panel.description?.trim();
  if (!prompt) throw new ProjectAssetTaskError("分镜格缺少视频提示词", 400);

  const supportingReferences = await findStoryboardReferenceImages({
    projectId: input.projectId,
    characters: parseStringArray(panel.charactersJson),
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
  const referenceAudios = await findStoryboardReferenceAudios({
    projectId: input.projectId,
    episodeId: input.episodeId,
    panelId: panel.id,
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
      duration: input.duration ?? "5s",
      format: "mp4",
      videoMode: input.mode ?? "reference",
      ...(referenceImages.length ? { referenceImages: referenceImages.slice(0, 9) } : {}),
      ...(referenceAudios.length ? { referenceAudios } : {}),
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
      referenceAudioCount: referenceAudios.length,
    },
  };
}

async function findStoryboardReferenceAudios(input: {
  projectId: string;
  episodeId: string;
  panelId: string;
}) {
  const lines = await prisma.voiceLine.findMany({
    where: {
      episodeId: input.episodeId,
      matchedPanelId: input.panelId,
      episode: { projectId: input.projectId },
      audioAsset: { isNot: null },
    },
    orderBy: { lineIndex: "asc" },
    take: 3,
    select: {
      audioAsset: {
        select: { url: true, storageKey: true, mimeType: true },
      },
    },
  });
  const references: Array<{ url: string; mimeType?: string }> = [];
  for (const line of lines) {
    const url = await mediaAssetUrl(line.audioAsset);
    if (url)
      references.push({
        url,
        mimeType: line.audioAsset?.mimeType ?? undefined,
      });
  }
  return references;
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
  return references.slice(0, 9);
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
