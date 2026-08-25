import { randomUUID } from "node:crypto";

import { BillingError } from "@/lib/billing/service";
import { resolveStoredMediaUrl } from "@/lib/storage";
import { prisma } from "@/lib/server/prisma";
import { createMediaTask } from "./task-contract";
import { createDatabaseMediaTaskStore } from "./task-store";
import { enqueuePersistedMediaTask } from "./task-submit";

export class GlobalAssetTaskError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function createGlobalAssetImageTask(input: {
  userId: string;
  kind: "character" | "location";
  assetId: string;
  channelId: string;
  model: string;
  prompt: string;
  ratio?: string;
  resolution?: string;
  useSelectedReference?: boolean;
}) {
  const channel = await prisma.channel.findFirst({
    where: { id: input.channelId, userId: input.userId },
  });
  if (
    !channel ||
    !["openai-compatible", "volcengine-ark"].includes(channel.protocol)
  )
    throw new GlobalAssetTaskError("图片渠道不存在或协议不受支持", 400);
  const configured = await prisma.providerModel.count({
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
  if (!configured)
    throw new GlobalAssetTaskError("图片模型未在该渠道中配置或未选中", 400);
  const prompt = input.prompt.trim();
  if (!prompt) throw new GlobalAssetTaskError("提示词不能为空", 400);

  const target = await createTarget(input);
  const references = input.useSelectedReference
    ? await selectedReferences(input)
    : [];
  const task = createMediaTask({
    id: `media_task_${randomUUID()}`,
    channelId: input.channelId,
    targetType: target.targetType,
    targetId: target.id,
    kind: "image",
    provider: channel.providerKey,
    protocol: channel.protocol as "openai-compatible" | "volcengine-ark",
    model: input.model,
    request: {
      prompt,
      ratio: input.ratio ?? "1:1",
      resolution: input.resolution ?? "2k",
      format: "png",
      ...(references.length ? { referenceImages: references } : {}),
    },
  });
  const store = createDatabaseMediaTaskStore(input.userId);
  await store.create(task);
  try {
    const queued = await enqueuePersistedMediaTask(input.userId, task);
    return { task: queued, target };
  } catch (error) {
    if (error instanceof BillingError)
      throw new GlobalAssetTaskError(error.message, error.status);
    throw error;
  }
}

async function createTarget(input: {
  userId: string;
  kind: "character" | "location";
  assetId: string;
  prompt: string;
}) {
  if (input.kind === "character") {
    const character = await prisma.globalCharacter.findFirst({
      where: { id: input.assetId, userId: input.userId },
      select: { id: true },
    });
    if (!character) throw new GlobalAssetTaskError("全局角色不存在", 404);
    const latest = await prisma.globalCharacterAppearance.findFirst({
      where: { characterId: character.id },
      orderBy: { appearanceIndex: "desc" },
      select: { appearanceIndex: true },
    });
    const row = await prisma.globalCharacterAppearance.create({
      data: {
        characterId: character.id,
        appearanceIndex: (latest?.appearanceIndex ?? -1) + 1,
        changeReason: "generated",
        description: input.prompt,
      },
    });
    return { id: row.id, targetType: "global_character_appearance" as const };
  }

  const location = await prisma.globalLocation.findFirst({
    where: { id: input.assetId, userId: input.userId },
    select: { id: true },
  });
  if (!location) throw new GlobalAssetTaskError("全局场景不存在", 404);
  const latest = await prisma.globalLocationImage.findFirst({
    where: { locationId: location.id },
    orderBy: { imageIndex: "desc" },
    select: { imageIndex: true },
  });
  const row = await prisma.globalLocationImage.create({
    data: {
      locationId: location.id,
      imageIndex: (latest?.imageIndex ?? -1) + 1,
      description: input.prompt,
    },
  });
  return { id: row.id, targetType: "global_location_image" as const };
}

async function selectedReferences(input: {
  userId: string;
  kind: "character" | "location";
  assetId: string;
}) {
  if (input.kind === "character") {
    const rows = await prisma.globalCharacterAppearance.findMany({
      where: {
        characterId: input.assetId,
        character: { userId: input.userId },
        OR: [{ selectedIndex: { not: null } }, { imageAssetId: { not: null } }],
      },
      include: { imageAsset: { select: { url: true, storageKey: true, mimeType: true } } },
      orderBy: { updatedAt: "desc" },
      take: 3,
    });
    return resolveReferences(
      rows.map((row) => ({
        url: row.imageUrl,
        asset: row.imageAsset,
      })),
    );
  }
  const rows = await prisma.globalLocationImage.findMany({
    where: {
      locationId: input.assetId,
      location: { userId: input.userId },
      isSelected: true,
    },
    include: { imageAsset: { select: { url: true, storageKey: true, mimeType: true } } },
    orderBy: { updatedAt: "desc" },
    take: 3,
  });
  return resolveReferences(
    rows.map((row) => ({
      url: row.imageUrl,
      asset: row.imageAsset,
    })),
  );
}

async function resolveReferences(
  rows: Array<{
    url: string | null;
    asset: {
      url: string | null;
      storageKey: string | null;
      mimeType: string | null;
    } | null;
  }>,
) {
  const references: Array<{ url: string; mimeType?: string }> = [];
  for (const row of rows) {
    const url = row.asset?.storageKey
      ? await resolveStoredMediaUrl(row.asset.storageKey)
      : row.asset?.url ?? row.url;
    if (url)
      references.push({ url, mimeType: row.asset?.mimeType ?? undefined });
  }
  return references;
}
