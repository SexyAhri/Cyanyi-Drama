import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { createMediaTaskTraceContext } from "@/lib/observability/trace-context";
import { prisma } from "@/lib/server/prisma";
import { resolveStoredMediaUrl, storeMediaBytes } from "@/lib/storage";

export type UploadAssetKind = "image" | "video" | "audio";
export type ProjectAssetTargetType =
  | "project"
  | "episode"
  | "character"
  | "character_appearance"
  | "location"
  | "location_image"
  | "prop"
  | "storyboard_panel"
  | "voice_preset";

export type ProjectAssetSource = {
  fileName?: string;
  sourceType: "upload" | "import" | "extraction";
  sourceAssetIds?: string[];
};

export class ProjectAssetError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function createUploadedProjectAsset(input: {
  userId: string;
  projectId: string;
  episodeId?: string;
  kind: UploadAssetKind;
  bytes: Uint8Array;
  mimeType: string;
  source: ProjectAssetSource;
  targetType?: ProjectAssetTargetType;
  targetId?: string;
  role?: string;
}) {
  const resolvedTarget = await resolveProjectAssetTarget(input);
  const assetId = `media_asset_${randomUUID()}`;
  const taskId = `media_task_upload_${randomUUID()}`;
  const trace = createMediaTaskTraceContext(taskId);
  const extension = extensionForMime(input.mimeType, input.kind);
  const storageKey = await storeMediaBytes(
    input.bytes,
    `projects/${input.projectId}/uploads/${assetId}.${extension}`,
    input.mimeType,
  );
  const url = await resolveStoredMediaUrl(storageKey);
  const result = await prisma.$transaction(async (tx) => {
    const target = await materializeAssetTarget(
      tx,
      resolvedTarget,
      input.kind,
    );
    const metadata = {
      source: input.source,
      sha256StorageKey: storageKey,
      target: { type: target.entityType, id: target.entityId },
    };
    await tx.mediaTask.create({
      data: {
        id: taskId,
        userId: input.userId,
        traceId: trace.traceId,
        spanId: trace.spanId,
        projectId: input.projectId,
        episodeId: input.episodeId ?? null,
        targetType: target.entityType,
        targetId: target.entityId,
        status: "succeeded",
        kind: input.kind,
        provider: "upload",
        protocol: "local",
        model: "direct-upload",
        payload: toJson({
          request: { operation: "upload", source: input.source },
          output: [
            {
              id: assetId,
              kind: input.kind,
              url,
              storageKey,
              mimeType: input.mimeType,
              metadata,
            },
          ],
        }),
        progress: 100,
        maxRetries: 0,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });
    const created = await tx.mediaAsset.create({
      data: {
        id: assetId,
        taskId,
        kind: input.kind,
        storageKey,
        url,
        mimeType: input.mimeType,
        metadataJson: JSON.stringify(metadata),
      },
    });
    await attachAssetToTarget(tx, {
      projectId: input.projectId,
      episodeId: input.episodeId,
      assetId,
      kind: input.kind,
      target,
      role: input.role?.trim() || "uploaded_source",
      metadata,
    });
    return { asset: created, target };
  });

  return {
    ...result.asset,
    url,
    target: result.target,
    source: input.source,
  };
}

export async function listOwnedProjectMediaAssets(
  userId: string,
  projectId: string,
  assetIds: string[],
  kinds: UploadAssetKind[] = ["image", "video"],
) {
  const ids = [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) return [];
  const rows = await prisma.mediaAsset.findMany({
    where: {
      id: { in: ids },
      kind: { in: kinds },
      task: { userId, projectId },
    },
    select: {
      id: true,
      kind: true,
      url: true,
      storageKey: true,
      mimeType: true,
      metadataJson: true,
    },
  });
  if (rows.length !== ids.length)
    throw new ProjectAssetError("资产不存在或不属于当前项目", 404);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return Promise.all(
    ids.map(async (id) => {
      const row = byId.get(id)!;
      const url = row.storageKey
        ? await resolveStoredMediaUrl(row.storageKey)
        : row.url;
      if (!url) throw new ProjectAssetError("资产缺少可访问媒体", 409);
      return { ...row, url };
    }),
  );
}

export async function linkSourceAssets(input: {
  userId: string;
  projectId: string;
  episodeId?: string;
  assetIds: string[];
  entityType: string;
  entityId: string;
  role: string;
  metadata?: Record<string, unknown>;
}) {
  const assets = await listOwnedProjectMediaAssets(
    input.userId,
    input.projectId,
    input.assetIds,
  );
  if (!assets.length) return;
  await prisma.assetReference.createMany({
    data: assets.map((asset) => ({
      id: randomUUID(),
      projectId: input.projectId,
      episodeId: input.episodeId ?? null,
      mediaAssetId: asset.id,
      entityType: input.entityType,
      entityId: input.entityId,
      role: input.role,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    })),
    skipDuplicates: true,
  });
}

type AssetTarget = { entityType: string; entityId: string };

async function resolveProjectAssetTarget(input: {
  userId: string;
  projectId: string;
  episodeId?: string;
  kind: UploadAssetKind;
  targetType?: ProjectAssetTargetType;
  targetId?: string;
}): Promise<AssetTarget> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
    select: { id: true },
  });
  if (!project) throw new ProjectAssetError("项目不存在", 404);
  if (input.episodeId) {
    const episode = await prisma.episode.findFirst({
      where: { id: input.episodeId, projectId: input.projectId },
      select: { id: true },
    });
    if (!episode) throw new ProjectAssetError("剧集不存在", 404);
  }

  const targetType = input.targetType ?? "project";
  const targetId = input.targetId?.trim() || input.projectId;
  if (targetType === "project")
    return { entityType: "project", entityId: input.projectId };
  if (targetType === "episode") {
    const episode = await prisma.episode.findFirst({
      where: { id: targetId, projectId: input.projectId },
      select: { id: true },
    });
    if (!episode) throw new ProjectAssetError("剧集不存在", 404);
    return { entityType: "episode", entityId: episode.id };
  }
  if (targetType === "character") {
    if (input.kind !== "image")
      throw new ProjectAssetError("角色资产必须是图片", 400);
    const character = await prisma.novelCharacter.findFirst({
      where: { id: targetId, projectId: input.projectId },
      select: { id: true },
    });
    if (!character) throw new ProjectAssetError("角色不存在", 404);
    return { entityType: "character", entityId: character.id };
  }
  if (targetType === "location") {
    if (input.kind !== "image")
      throw new ProjectAssetError("场景资产必须是图片", 400);
    const location = await prisma.novelLocation.findFirst({
      where: { id: targetId, projectId: input.projectId },
      select: { id: true },
    });
    if (!location) throw new ProjectAssetError("场景不存在", 404);
    return { entityType: "location", entityId: location.id };
  }
  if (targetType === "prop") {
    if (input.kind !== "image")
      throw new ProjectAssetError("道具资产必须是图片", 400);
    const prop = await prisma.novelProp.findFirst({
      where: { id: targetId, projectId: input.projectId },
      select: { id: true },
    });
    if (!prop) throw new ProjectAssetError("道具不存在", 404);
    return { entityType: "prop", entityId: prop.id };
  }
  if (targetType === "voice_preset" && input.kind !== "audio")
    throw new ProjectAssetError("音色样本必须是音频", 400);

  const owned = await findOwnedConcreteTarget(
    targetType,
    targetId,
    input.projectId,
  );
  if (!owned) throw new ProjectAssetError("目标实体不存在或不属于项目", 404);
  return { entityType: targetType, entityId: targetId };
}

async function materializeAssetTarget(
  tx: Prisma.TransactionClient,
  target: AssetTarget,
  kind: UploadAssetKind,
): Promise<AssetTarget> {
  if (target.entityType === "character") {
    if (kind !== "image")
      throw new ProjectAssetError("角色资产必须是图片", 400);
    const last = await tx.characterAppearance.findFirst({
      where: { characterId: target.entityId },
      orderBy: { appearanceIndex: "desc" },
      select: { appearanceIndex: true },
    });
    const appearance = await tx.characterAppearance.create({
      data: {
        id: randomUUID(),
        characterId: target.entityId,
        appearanceIndex: (last?.appearanceIndex ?? -1) + 1,
        description: "用户上传参考图",
      },
    });
    return { entityType: "character_appearance", entityId: appearance.id };
  }
  if (target.entityType === "location") {
    if (kind !== "image")
      throw new ProjectAssetError("场景资产必须是图片", 400);
    const last = await tx.locationImage.findFirst({
      where: { locationId: target.entityId },
      orderBy: { imageIndex: "desc" },
      select: { imageIndex: true },
    });
    const image = await tx.locationImage.create({
      data: {
        id: randomUUID(),
        locationId: target.entityId,
        imageIndex: (last?.imageIndex ?? -1) + 1,
        description: "用户上传参考图",
      },
    });
    return { entityType: "location_image", entityId: image.id };
  }
  return target;
}

async function findOwnedConcreteTarget(
  targetType: ProjectAssetTargetType,
  targetId: string,
  projectId: string,
) {
  if (targetType === "character_appearance")
    return prisma.characterAppearance.findFirst({
      where: { id: targetId, character: { projectId } },
      select: { id: true },
    });
  if (targetType === "location_image")
    return prisma.locationImage.findFirst({
      where: { id: targetId, location: { projectId } },
      select: { id: true },
    });
  if (targetType === "storyboard_panel")
    return prisma.storyboardPanel.findFirst({
      where: { id: targetId, storyboard: { projectId } },
      select: { id: true },
    });
  if (targetType === "voice_preset")
    return prisma.voicePreset.findFirst({
      where: { id: targetId, projectId },
      select: { id: true },
    });
  return null;
}

async function attachAssetToTarget(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    episodeId?: string;
    assetId: string;
    kind: UploadAssetKind;
    target: AssetTarget;
    role: string;
    metadata: Record<string, unknown>;
  },
) {
  if (input.target.entityType === "character_appearance") {
    const appearance = await tx.characterAppearance.findUniqueOrThrow({
      where: { id: input.target.entityId },
      select: { characterId: true },
    });
    await tx.characterAppearance.updateMany({
      where: { characterId: appearance.characterId },
      data: { selected: false },
    });
    await tx.characterAppearance.update({
      where: { id: input.target.entityId },
      data: { imageAssetId: input.assetId, selected: true },
    });
  } else if (input.target.entityType === "location_image") {
    const image = await tx.locationImage.findUniqueOrThrow({
      where: { id: input.target.entityId },
      select: { locationId: true },
    });
    await tx.locationImage.updateMany({
      where: { locationId: image.locationId },
      data: { selected: false },
    });
    await tx.locationImage.update({
      where: { id: input.target.entityId },
      data: { imageAssetId: input.assetId, selected: true },
    });
    await tx.novelLocation.update({
      where: { id: image.locationId },
      data: { selectedImageId: input.target.entityId },
    });
  } else if (input.target.entityType === "storyboard_panel") {
    await tx.storyboardPanel.update({
      where: { id: input.target.entityId },
      data:
        input.kind === "video"
          ? { videoAssetId: input.assetId }
          : { imageAssetId: input.assetId },
    });
  } else if (input.target.entityType === "voice_preset") {
    await tx.voicePreset.update({
      where: { id: input.target.entityId },
      data: { sampleAssetId: input.assetId },
    });
  }
  await tx.assetReference.create({
    data: {
      id: randomUUID(),
      projectId: input.projectId,
      episodeId: input.episodeId ?? null,
      mediaAssetId: input.assetId,
      entityType: input.target.entityType,
      entityId: input.target.entityId,
      role: input.role,
      metadataJson: JSON.stringify(input.metadata),
    },
  });
}

function extensionForMime(mimeType: string, kind: UploadAssetKind) {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("jpeg")) return "jpg";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("quicktime")) return "mov";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg")) return "mp3";
  if (normalized.includes("mp4")) return kind === "audio" ? "m4a" : "mp4";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("flac")) return "flac";
  return kind === "video" ? "mp4" : "bin";
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
