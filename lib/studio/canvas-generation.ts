import { prisma } from "@/lib/server/prisma";
import { listOwnedProjectMediaAssets } from "@/lib/assets/project-store";
import {
  canvasAssetSource,
  canvasConnectionError,
  compileCanvasInput,
  type CanvasCard,
  type CanvasDocument,
} from "./canvas-document";

export async function resolveCanvasGeneration(input: {
  document: CanvasDocument;
  node: CanvasCard;
  kind: "image" | "video";
  userId: string;
  projectId: string;
  episodeId: string;
}) {
  const compiled = compileCanvasInput(input.document, input.node, input.kind);
  const references: Array<{
    assetId: string;
    role: "reference_image" | "first_frame" | "last_frame";
  }> = [];
  for (const item of compiled.inputs) {
    if (
      item.purpose === "causality" ||
      item.purpose === "shot_sequence" ||
      item.purpose === "story_asset" ||
      item.purpose === "episode_bridge" ||
      item.purpose === "shot_video"
    )
      continue;
    if (item.purpose === "context" || item.purpose === "dialogue") {
      const problem = canvasConnectionError(item.source, input.node, item.purpose);
      if (problem) throw new Error(`${item.source.title}：${problem}`);
      continue;
    }
    if (input.kind === "image" && item.purpose !== "reference")
      throw new Error(
        "图片生成不能使用视频首尾帧连线，请切换视频或修改连线用途",
      );
    let assetId = item.source.assetId;
    if (!assetId && item.source.kind === "image") {
      const ownOutput = await prisma.mediaAsset.findFirst({
        where: { kind: "image", task: { userId: input.userId, projectId: input.projectId, episodeId: input.episodeId, targetType: "canvas_node", targetId: item.source.id, status: "succeeded" } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true },
      });
      assetId = ownOutput?.id;
    }
    if (!assetId) {
      const entity = canvasAssetSource(item.source, input.document);
      if (entity?.entityId) assetId = await resolveEntityImage(entity, input.userId, input.projectId);
    }
    if (!assetId && item.source.panelId) {
      const panel = await prisma.storyboardPanel.findFirst({
        where: {
          id: item.source.panelId,
          storyboard: {
            projectId: input.projectId,
            episodeId: input.episodeId,
            project: { userId: input.userId },
          },
        },
        select: { imageAssetId: true },
      });
      assetId = panel?.imageAssetId ?? undefined;
    }
    if (!assetId)
      throw new Error(`${item.source.title}还没有可用图片，请先生成或选择版本`);
    const problem = canvasConnectionError({ ...item.source, assetId }, input.node, item.purpose);
    if (problem) throw new Error(`${item.source.title}：${problem}`);
    // Freeze the resolved reference in this request, without changing the saved canvas.
    item.source = { ...item.source, assetId };
    const role =
      item.purpose === "reference" ? "reference_image" : item.purpose;
    if (
      role !== "reference_image" &&
      references.some((ref) => ref.role === role)
    )
      throw new Error("首帧和尾帧各只能连接一张图片");
    if (!references.some((ref) => ref.assetId === assetId && ref.role === role))
      references.push({ assetId, role });
  }
  const assets = await listOwnedProjectMediaAssets(
    input.userId,
    input.projectId,
    references.map((ref) => ref.assetId),
    ["image"],
  );
  const referenceImages = references.map((ref) => {
    const asset = assets.find((item) => item.id === ref.assetId)!;
    return {
      assetId: asset.id,
      url: asset.url,
      storageKey: asset.storageKey ?? undefined,
      mimeType: asset.mimeType ?? undefined,
      role: ref.role,
    };
  });
  return { ...compiled, references, referenceImages };
}

async function resolveEntityImage(entity: CanvasCard, userId: string, projectId: string) {
  const mediaWhere = { kind: "image", task: { userId, projectId, status: "succeeded" } };
  if (entity.kind === "character") {
    const candidate = await prisma.characterAppearance.findFirst({
      where: { characterId: entity.entityId, character: { projectId, project: { userId } }, imageAsset: mediaWhere },
      orderBy: [{ selected: "desc" }, { imageAsset: { createdAt: "desc" } }, { id: "desc" }],
      select: { imageAssetId: true },
    });
    return candidate?.imageAssetId ?? undefined;
  }
  if (entity.kind === "location") {
    const location = await prisma.novelLocation.findFirst({
      where: { id: entity.entityId, projectId, project: { userId } },
      select: { selectedImageId: true, images: {
        where: { imageAsset: mediaWhere },
        orderBy: [{ selected: "desc" }, { imageAsset: { createdAt: "desc" } }, { id: "desc" }],
        select: { id: true, imageAssetId: true, selected: true },
      } },
    });
    const candidate = location?.images.find(image => image.id === location.selectedImageId)
      ?? location?.images.find(image => image.selected) ?? location?.images[0];
    return candidate?.imageAssetId ?? undefined;
  }
  if (entity.kind === "prop") {
    const prop = await prisma.novelProp.findFirst({ where: { id: entity.entityId, projectId, project: { userId } }, select: { id: true } });
    if (!prop) return;
    const where = { ...mediaWhere, references: { some: { projectId, entityType: "prop", entityId: prop.id } } };
    const selected = await prisma.mediaAsset.findFirst({
      where: { ...where, references: { some: { ...where.references.some, role: "selected" } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true },
    });
    const candidate = selected ?? await prisma.mediaAsset.findFirst({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    return candidate?.id;
  }
}
