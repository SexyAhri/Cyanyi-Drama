import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/server/prisma";
import { createMediaTask } from "./task-contract";
import { createDatabaseMediaTaskStore } from "./task-store";
import { enqueueMediaJob } from "@/lib/queue/media-queue";

export type ProjectAssetTarget = "character" | "location";

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
};

export async function createProjectImageTask(
  input: CreateProjectImageTaskInput,
) {
  const channel = await prisma.channel.findFirst({
    where: { id: input.channelId, userId: input.userId },
  });
  if (
    !channel ||
    (channel.protocol !== "openai-compatible" &&
      channel.protocol !== "volcengine-ark")
  ) {
    throw new ProjectAssetTaskError(
      "图片生成需要有效的 OpenAI 兼容或火山方舟渠道",
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

  const entity = await createTargetEntity(input);
  const referenceImages = input.useSelectedReference
    ? await findSelectedReferenceImages(input)
    : [];
  const task = createMediaTask({
    id: `media_task_${randomUUID()}`,
    projectId: input.projectId,
    batchId: input.batchId,
    channelId: input.channelId,
    targetType: entity.entityType,
    targetId: entity.id,
    kind: "image",
    provider:
      channel.protocol === "volcengine-ark"
        ? "volcengine-ark"
        : "openai-compatible",
    protocol: channel.protocol as "openai-compatible" | "volcengine-ark",
    model: input.model,
    request: {
      prompt: input.prompt,
      ratio: input.ratio ?? "1:1",
      resolution: input.resolution ?? "2k",
      format: "png",
      ...(referenceImages.length ? { referenceImages } : {}),
    },
  });
  const store = createDatabaseMediaTaskStore(input.userId);
  await store.create(task);
  const job = await enqueueMediaJob({
    taskId: task.id,
    userId: input.userId,
    projectId: input.projectId,
    channelId: input.channelId,
    kind: "image",
    maxAttempts: task.maxRetries + 1,
  });
  task.queueJobId = job.id;
  await store.update(task);
  return { task, entity };
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
    select: { id: true, protocol: true },
  });
  if (
    !channel ||
    (channel.protocol !== "openai-compatible" &&
      channel.protocol !== "volcengine-ark")
  ) {
    throw new ProjectAssetTaskError(
      "图片生成需要有效的 OpenAI 兼容或火山方舟渠道",
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
    provider:
      channel.protocol === "volcengine-ark" ? "volcengine-ark" : "openai-compatible",
    protocol: channel.protocol as "openai-compatible" | "volcengine-ark",
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
  const job = await enqueueMediaJob({
    taskId: task.id,
    userId: input.userId,
    projectId: input.projectId,
    episodeId: input.episodeId,
    channelId: input.channelId,
    kind: "image",
    maxAttempts: task.maxRetries + 1,
  });
  task.queueJobId = job.id;
  await store.update(task);
  return {
    task,
    panel: { id: panel.id, referenceCount: referenceImages.length },
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
