import { prisma } from "@/lib/server/prisma";
import type { MediaProviderRequest as TaskRequest } from "@/lib/providers/media/types";

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
  const rawTargets = (request as Record<string, unknown>).canvasAssetTargets;
  const targets = Array.isArray(rawTargets)
    ? rawTargets.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          return [];
        const target = value as Record<string, unknown>;
        const entityType = target.entityType;
        const entityId = target.entityId;
        return ["character", "location", "prop"].includes(String(entityType)) &&
          typeof entityId === "string" &&
          entityId.trim()
          ? [{ entityType: String(entityType), entityId: entityId.trim() }]
          : [];
      })
    : [];
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


/** Attach legacy canvas results using their saved asset-to-image connections. */
export async function reconcileCanvasAssetImages(
  document: import("@/lib/studio/canvas-document").CanvasDocument,
  userId: string,
  projectId: string,
  episodeId: string,
) {
  const targets = new Map<string, Array<{ entityType: string; entityId: string }>>();
  for (const edge of document.edges) {
    const source = document.nodes.find((node) => node.id === edge.from);
    const target = document.nodes.find((node) => node.id === edge.to);
    if (!source?.entityId || !["character", "location", "prop"].includes(source.kind) || target?.kind !== "image") continue;
    const values = targets.get(target.id) ?? [];
    if (!values.some((value) => value.entityType === source.kind && value.entityId === source.entityId))
      values.push({ entityType: source.kind, entityId: source.entityId });
    targets.set(target.id, values);
  }
  if (!targets.size) return;
  const tasks = await prisma.mediaTask.findMany({
    where: { userId, projectId, episodeId, targetType: "canvas_node", targetId: { in: [...targets.keys()] }, kind: "image", status: "succeeded" },
    include: { assets: { where: { kind: "image" } } },
    orderBy: { createdAt: "asc" },
  });
  for (const task of tasks) {
    for (const asset of task.assets) {
      const expected = targets.get(task.targetId ?? "") ?? [];
      const existing = await prisma.assetReference.findMany({
        where: { mediaAssetId: asset.id, projectId, role: "generated_candidate" },
        select: { entityType: true, entityId: true },
      });
      if (expected.every((target) => existing.some((ref) => ref.entityType === target.entityType && ref.entityId === target.entityId))) continue;
      const payload = task.payload as { request?: TaskRequest };
      await linkCanvasGeneratedImage(task, userId, projectId, asset, {
        ...payload.request,
        canvasAssetTargets: expected,
      } as TaskRequest);
    }
  }
}
