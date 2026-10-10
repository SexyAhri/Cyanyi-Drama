import { canvasEdgePurpose } from "@/lib/studio/canvas-document";
import type {
  ProjectAssetCatalog,
  ProjectMediaAsset,
  StudioLocale,
  StudioStoryboardPanel,
  StudioSelectionContext,
} from "../types";
import type { CanvasCard, CanvasEdge, CanvasPurpose } from "./types";
import {
  buildStudioAssetEntities,
  type StudioAssetEntity,
} from "../assets/asset-view-model";

const entityCache = new WeakMap<
  ProjectAssetCatalog,
  Map<string, StudioAssetEntity>
>();
function canvasAssetEntities(catalog: ProjectAssetCatalog) {
  let entities = entityCache.get(catalog);
  if (!entities) {
    entities = new Map(
      (["character", "location", "prop"] as const).flatMap((kind) =>
        buildStudioAssetEntities(catalog, kind).map(
          (entity) => [`${kind}-${entity.id}`, entity] as const,
        ),
      ),
    );
    entityCache.set(catalog, entities);
  }
  return entities;
}

export function linkedCanvasAsset(
  node: CanvasCard,
  catalog?: ProjectAssetCatalog,
) {
  if (
    !catalog ||
    !node.entityId ||
    !["character", "location", "prop"].includes(node.kind)
  )
    return;
  return canvasAssetEntities(catalog).get(`${node.kind}-${node.entityId}`);
}

export function canvasAssetCards(catalog?: ProjectAssetCatalog): CanvasCard[] {
  if (!catalog) return [];
  return [...canvasAssetEntities(catalog).values()].map((entity) => ({
    id: `${entity.kind}-${entity.id}`,
    entityId: entity.id,
    kind: entity.kind,
    title: entity.name,
    text: "",
    x: 0,
    y: 0,
  }));
}

export const CARD_WIDTH = 300;
export function canvasSelection(node: CanvasCard): StudioSelectionContext {
  return {
    id: node.panelId ?? node.entityId ?? node.id,
    kind: node.panelId
      ? "panel"
      : node.kind === "character"
        ? "character"
        : node.kind === "location"
          ? "location"
          : node.kind === "prop"
            ? "prop"
            : "canvas_node",
    label: node.title,
    metadata: { canvasNodeId: node.id },
  };
}
export const CARD_HEIGHT = 240;
export const PORT_Y = CARD_HEIGHT / 2;
export const kindLabel = (kind: CanvasCard["kind"], locale: StudioLocale) =>
  ({
    text: ["文本", "Text"],
    panel: ["镜头", "Shot"],
    image: ["图片", "Image"],
    video: ["视频", "Video"],
    audio: ["音频", "Audio"],
    character: ["角色", "Character"],
    location: ["场景", "Location"],
    prop: ["道具", "Prop"],
  })[kind][locale === "en" ? 1 : 0];
export const purposeLabel = (purpose: CanvasPurpose, locale: StudioLocale) =>
  ({
    context: ["文字上下文", "Text context"],
    reference: ["形象参考", "Visual reference"],
    first_frame: ["视频首帧", "First frame"],
    last_frame: ["视频尾帧", "Last frame"],
    dialogue: ["台词音频", "Dialogue audio"],
  })[purpose][locale === "en" ? 1 : 0];
export function edgeLabel(
  edge: CanvasEdge,
  source: CanvasCard,
  locale: StudioLocale,
) {
  const purpose = canvasEdgePurpose(edge, source);
  if (purpose === "reference" && source.kind === "character")
    return locale === "en" ? "Character reference" : "角色参考";
  if (purpose === "reference" && source.kind === "location")
    return locale === "en" ? "Location reference" : "场景参考";
  return purposeLabel(purpose, locale);
}
export function panelCard(
  panel: StudioStoryboardPanel,
  index: number,
): CanvasCard {
  return {
    id: `panel-${panel.id}`,
    panelId: panel.id,
    kind: "panel",
    title: `镜头 ${panel.panelIndex + 1}`,
    text: panel.imagePrompt ?? panel.description ?? "",
    videoText: panel.videoPrompt ?? "",
    panelPromptBase: {
      image: panel.imagePrompt ?? panel.description ?? "",
      video: panel.videoPrompt ?? "",
    },
    x: (index % 4) * 380,
    y: Math.floor(index / 4) * 320,
    outputKind: "image",
  };
}
export function nodeCandidates(
  node: CanvasCard,
  catalog?: ProjectAssetCatalog,
) {
  return (catalog?.assets ?? [])
    .filter(
      (asset) =>
        asset.url &&
        asset.taskStatus === "succeeded" &&
        (asset.id === node.assetId ||
          (!!node.panelId && asset.sourceTargetId === node.panelId) ||
          asset.sourceTargetId === node.id ||
          (!!node.entityId &&
            asset.references.some((ref) => ref.entityId === node.entityId))),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function nodeMedia(
  node: CanvasCard,
  catalog?: ProjectAssetCatalog,
  panels: StudioStoryboardPanel[] = [],
): ProjectMediaAsset | undefined {
  if (node.assetId)
    return catalog?.assets.find((asset) => asset.id === node.assetId);
  const entity = linkedCanvasAsset(node, catalog);
  if (entity) {
    const adopted = entity.candidates.find(
      (candidate) => candidate.selected && candidate.url,
    );
    const fallback = entity.candidates
      .filter((candidate) => candidate.url)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const assetId = (adopted ?? fallback)?.assetId;
    if (assetId) return catalog?.assets.find((asset) => asset.id === assetId);
  }
  const panel = panels.find((item) => item.id === node.panelId);
  const official =
    (node.outputKind ?? "image") === "video"
      ? panel?.videoAssetId
      : panel?.imageAssetId;
  if (official) return catalog?.assets.find((asset) => asset.id === official);
  return nodeCandidates(node, catalog).find(
    (asset) =>
      asset.kind ===
      (node.kind === "audio"
        ? "audio"
        : (node.outputKind ?? (node.kind === "video" ? "video" : "image"))),
  );
}
