import { listOwnedProjectMediaAssets } from "@/lib/assets/project-store";
import {
  createProductionTask,
  ProductionTaskError,
} from "@/lib/media/production-tasks";
import { prisma } from "@/lib/server/prisma";
import {
  parseVfxShotPackage,
  type VfxShotPackage,
  type VfxTaskStage,
} from "./vfx-contract";

export async function createVfxShotTask(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  deliverableId: string;
  stage: VfxTaskStage;
  kind: "image" | "video";
  channelId: string;
  model: string;
  prompt: string;
  ratio?: string;
  resolution?: string;
  duration?: string;
}) {
  if (input.stage === "composite" && input.kind !== "video")
    throw new ProductionTaskError("VFX_COMPOSITE_REQUIRES_VIDEO", 400);
  const deliverable = await prisma.productionDeliverable.findFirst({
    where: {
      id: input.deliverableId,
      userId: input.userId,
      projectId: input.projectId,
      episodeId: input.episodeId,
      department: "vfx",
      deliverableType: "vfx_shot_package",
      status: { notIn: ["stale", "superseded"] },
      scopeType: "storyboard_panel",
    },
    select: {
      id: true,
      scopeId: true,
      version: true,
      payload: true,
      sourceRefs: true,
    },
  });
  if (!deliverable)
    throw new ProductionTaskError("VFX_SHOT_PACKAGE_NOT_FOUND", 404);
  const parsed = parseVfxShotPackage(deliverable.payload);
  if (!parsed.success || parsed.data.panelId !== deliverable.scopeId)
    throw new ProductionTaskError("VFX_SHOT_PACKAGE_INVALID", 409);
  if (!parsed.data.plate.assetIds.length)
    throw new ProductionTaskError("VFX_PLATE_NOT_SELECTED", 409);
  if (input.stage === "composite" && !parsed.data.elements.assetIds.length)
    throw new ProductionTaskError("VFX_ELEMENTS_NOT_SELECTED", 409);
  const panelExists = await prisma.storyboardPanel.count({
    where: {
      id: deliverable.scopeId,
      storyboard: {
        projectId: input.projectId,
        episodeId: input.episodeId,
        project: { userId: input.userId },
      },
    },
  });
  if (!panelExists) throw new ProductionTaskError("VFX_SHOT_NOT_FOUND", 404);

  const sourceIds = sourceAssetIds(
    deliverable.sourceRefs,
    parsed.data,
    input.stage,
  );
  const sourceAssets = await listOwnedProjectMediaAssets(
    input.userId,
    input.projectId,
    sourceIds,
  );
  const referenceImages = sourceAssets
    .filter((asset) => asset.kind === "image")
    .map((asset) => ({ url: asset.url, mimeType: asset.mimeType ?? undefined }))
    .slice(0, 9);

  return createProductionTask({
    userId: input.userId,
    projectId: input.projectId,
    episodeId: input.episodeId,
    kind: input.kind,
    targetType: input.stage === "element" ? "vfx_element" : "vfx_composite",
    targetId: deliverable.scopeId,
    channelId: input.channelId,
    model: input.model,
    request: {
      prompt: input.prompt.trim(),
      ratio: input.ratio ?? "16:9",
      resolution: input.resolution ?? (input.kind === "image" ? "2k" : "1080p"),
      ...(input.kind === "video"
        ? { duration: input.duration ?? "5s", format: "mp4" }
        : { format: "png" }),
      ...(referenceImages.length ? { referenceImages } : {}),
      vfxStage: input.stage,
      deliverableId: deliverable.id,
      deliverableVersion: deliverable.version,
      panelId: deliverable.scopeId,
      colorSpace: parsed.data.colorSpace,
      compositeNotes: parsed.data.compositeNotes,
    },
  });
}

function sourceAssetIds(
  sourceRefs: unknown,
  shotPackage: VfxShotPackage,
  stage: VfxTaskStage,
) {
  const referenced = Array.isArray(sourceRefs)
    ? sourceRefs.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const record = item as Record<string, unknown>;
        return record.type === "media_asset" && typeof record.id === "string"
          ? [record.id]
          : [];
      })
    : [];
  return [
    ...new Set([
      ...referenced,
      ...shotPackage.plate.assetIds,
      ...(stage === "composite" ? shotPackage.elements.assetIds : []),
    ]),
  ];
}
