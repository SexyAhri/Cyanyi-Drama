import { prisma } from "@/lib/server/prisma";
import { listOwnedProjectMediaAssets } from "@/lib/assets/project-store";
import {
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
    const problem = canvasConnectionError(
      item.source,
      input.node,
      item.purpose,
    );
    if (problem) throw new Error(`${item.source.title}：${problem}`);
    if (item.purpose === "context" || item.purpose === "dialogue") continue;
    if (input.kind === "image" && item.purpose !== "reference")
      throw new Error(
        "图片生成不能使用视频首尾帧连线，请切换视频或修改连线用途",
      );
    let assetId = item.source.assetId;
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
      url: asset.url,
      storageKey: asset.storageKey ?? undefined,
      mimeType: asset.mimeType ?? undefined,
      role: ref.role,
    };
  });
  return { ...compiled, references, referenceImages };
}
