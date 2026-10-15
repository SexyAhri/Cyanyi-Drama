import { prisma } from "@/lib/server/prisma";
import type { MediaProviderRequest as TaskRequest } from "@/lib/providers/media/types";
import { canvasAssetTargets, type CanvasDocument } from "@/lib/studio/canvas-document";

export function frozenCanvasAssetTargets(request: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(request, "canvasAssetTargets")) return undefined;
  return Array.isArray(request.canvasAssetTargets) ? request.canvasAssetTargets.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const target = value as Record<string, unknown>;
    return ["character", "location", "prop"].includes(String(target.entityType)) && typeof target.entityId === "string" && target.entityId.trim()
      ? [{ entityType: String(target.entityType), entityId: target.entityId.trim() }] : [];
  }) : [];
}

function isStaleCanvasImage(metadataJson: string | null) {
  try {
    const metadata = metadataJson ? JSON.parse(metadataJson) : {};
    return Boolean(metadata.productionConfigurationStale);
  } catch { return true; }
}

export async function linkCanvasGeneratedImage(
  task: {
    id: string;
    episodeId: string | null;
    targetId: string | null;
  },
  userId: string,
  projectId: string,
  asset: { id: string },
  request: TaskRequest,
) {
  const targetId = task.targetId;
  if (!targetId) return;
  const targets = frozenCanvasAssetTargets(request as Record<string, unknown>) ?? [];
  const prompt = typeof request.prompt === "string" ? request.prompt : "";

  await prisma.$transaction(async (tx) => {
    const addReference = async (
      entityType: string,
      entityId: string,
      role: string,
    ) => {
      await tx.assetReference.upsert({
        where: {
          mediaAssetId_entityType_entityId_role: {
            mediaAssetId: asset.id,
            entityType,
            entityId,
            role,
          },
        },
        create: {
          id: `${task.id}_${asset.id}_${entityType}_${entityId}_${role}`,
          projectId,
          episodeId: task.episodeId,
          mediaAssetId: asset.id,
          entityType,
          entityId,
          role,
        },
        update: {},
      });
    };

    for (const target of targets) {
      if (target.entityType === "character") {
        const character = await tx.novelCharacter.findFirst({
          where: {
            id: target.entityId,
            projectId,
            project: { userId },
          },
          select: { id: true },
        });
        if (!character) continue;
        const candidateId = `${task.id}_canvas_${asset.id}_${character.id}`;
        const existing = await tx.characterAppearance.findUnique({
          where: { id: candidateId },
          select: { id: true },
        });
        const last = existing
          ? null
          : await tx.characterAppearance.findFirst({
              where: { characterId: character.id },
              orderBy: { appearanceIndex: "desc" },
              select: { appearanceIndex: true },
            });
        await tx.characterAppearance.upsert({
          where: { id: candidateId },
          create: {
            id: candidateId,
            characterId: character.id,
            appearanceIndex: (last?.appearanceIndex ?? -1) + 1,
            description: prompt || "画布生成的角色候选图",
            imageAssetId: asset.id,
            selected: false,
          },
          update: { description: prompt || "画布生成的角色候选图", imageAssetId: asset.id },
        });
      } else if (target.entityType === "location") {
        const location = await tx.novelLocation.findFirst({
          where: {
            id: target.entityId,
            projectId,
            project: { userId },
          },
          select: { id: true },
        });
        if (!location) continue;
        const candidateId = `${task.id}_canvas_${asset.id}_${location.id}`;
        const existing = await tx.locationImage.findUnique({
          where: { id: candidateId },
          select: { id: true },
        });
        const last = existing
          ? null
          : await tx.locationImage.findFirst({
              where: { locationId: location.id },
              orderBy: { imageIndex: "desc" },
              select: { imageIndex: true },
            });
        await tx.locationImage.upsert({
          where: { id: candidateId },
          create: {
            id: candidateId,
            locationId: location.id,
            imageIndex: (last?.imageIndex ?? -1) + 1,
            description: prompt || "画布生成的场景候选图",
            imageAssetId: asset.id,
            selected: false,
          },
          update: { description: prompt || "画布生成的场景候选图", imageAssetId: asset.id },
        });
      } else {
        const prop = await tx.novelProp.findFirst({
          where: {
            id: target.entityId,
            projectId,
            project: { userId },
          },
          select: { id: true },
        });
        if (!prop) continue;
      }
      await addReference(target.entityType, target.entityId, "generated_candidate");
    }

    await addReference("canvas_node", targetId, "canvas_output");
    await addReference("project", projectId, "canvas_generated");
  });
}


/** Repair missing links from frozen ownership, never from newly edited connections. */
export async function reconcileCanvasAssetImages(
  document: CanvasDocument,
  userId: string,
  projectId: string,
  episodeId: string,
  currentRevision?: number,
) {
  const tasks = await prisma.mediaTask.findMany({
    where: { userId, projectId, episodeId, targetType: "canvas_node", kind: "image", status: "succeeded" },
    include: { assets: { where: { kind: "image" } } },
    orderBy: { createdAt: "asc" },
  });
  for (const task of tasks) {
    const payload = task.payload as { request?: TaskRequest & Record<string, unknown> };
    const request = payload?.request ?? {};
    let expected = frozenCanvasAssetTargets(request);
    if (expected === undefined) {
      // A legacy request has no saved ownership. Infer only while the exact submitted
      // canvas revision is still current; a moved or edited graph is not evidence.
      if (currentRevision === undefined || request.canvasRevision !== currentRevision) continue;
      const node = document.nodes.find((item) => item.id === task.targetId);
      expected = node ? canvasAssetTargets(node, document) : [];
    }
    if (!expected.length) continue;
    for (const asset of task.assets) {
      if (isStaleCanvasImage(asset.metadataJson)) continue;
      const existing = await prisma.assetReference.findMany({
        where: { mediaAssetId: asset.id, projectId, role: "generated_candidate" },
        select: { entityType: true, entityId: true },
      });
      if (expected.every((target) => existing.some((ref) => ref.entityType === target.entityType && ref.entityId === target.entityId))) continue;
      await linkCanvasGeneratedImage(task, userId, projectId, asset, {
        ...request,
        canvasAssetTargets: expected,
      } as TaskRequest);
    }
  }
}
