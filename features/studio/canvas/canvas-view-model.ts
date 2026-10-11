import { canvasEdgePurpose } from "@/lib/studio/canvas-document";
import type {
  ProjectAssetCatalog,
  ProjectMediaAsset,
  StudioLocale,
  StudioStoryboardPanel,
  StudioSelectionContext,
} from "../types";
import type { MediaTask } from "@/lib/media/task-contract";
import type { CanvasCard, CanvasDocument, CanvasEdge, CanvasPurpose } from "./types";
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

export function canvasBaselineTargets(
  node: CanvasCard,
  document: CanvasDocument,
  catalog?: ProjectAssetCatalog,
  panels: StudioStoryboardPanel[] = [],
) {
  const media = nodeMedia(node, catalog, panels);
  if (media?.kind !== "image") return [];
  const sources = [node, ...document.edges
    .filter((edge) => edge.to === node.id)
    .flatMap((edge) => document.nodes.filter((source) => source.id === edge.from))];
  const seen = new Set<string>();
  return sources.flatMap((source) => {
    const entity = linkedCanvasAsset(source, catalog);
    const candidate = entity?.candidates.find((item) => item.assetId === media.id);
    if (!entity || !candidate || seen.has(`${entity.kind}-${entity.id}`)) return [];
    seen.add(`${entity.kind}-${entity.id}`);
    return [{ entity, candidate }];
  });
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
    causality: ["剧情因果", "Story causality"],
    shot_sequence: ["镜头顺序", "Shot sequence"],
    story_asset: ["剧情资产", "Story asset"],
    episode_bridge: ["承接上一集", "Previous episode"],
    shot_video: ["镜头视频", "Shot video"],
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
  if (purpose === "causality")
    return locale === "en" ? "Story causality" : "剧情因果";
  if (purpose === "shot_sequence")
    return locale === "en" ? "Shot sequence" : "镜头顺序";
  if (purpose === "story_asset")
    return locale === "en" ? "Story asset" : "剧情资产";
  if (purpose === "episode_bridge")
    return locale === "en" ? "Previous episode" : "承接上一集";
  if (purpose === "shot_video")
    return locale === "en" ? "Shot video" : "镜头视频";
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
  const inherited = inheritedCanvasAsset(node, catalog);
  const inheritedIds = new Set(inherited?.candidates.map(candidate => candidate.assetId));
  return (catalog?.assets ?? [])
    .filter(
      (asset) =>
        asset.url &&
        asset.taskStatus === "succeeded" &&
        (asset.id === node.assetId ||
          inheritedIds.has(asset.id) ||
          (!!node.panelId && asset.sourceTargetId === node.panelId) ||
          asset.sourceTargetId === node.id ||
          (!!node.entityId &&
            asset.references.some((ref) => ref.entityId === node.entityId))),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Default episode asset branches reuse project images until they have their own output. */
function inheritedCanvasAsset(node: CanvasCard, catalog?: ProjectAssetCatalog) {
  const prefix = "episode-asset-image-";
  if (!catalog || node.kind !== "image" || !node.id.startsWith(prefix)) return;
  return canvasAssetEntities(catalog).get(node.id.slice(prefix.length));
}

export function isReusableCanvasBranch(node: CanvasCard, document: CanvasDocument, catalog: ProjectAssetCatalog | undefined, tasks: MediaTask[]) {
  const entity = inheritedCanvasAsset(node, catalog);
  if (!entity || node.assetId || node.modelId || node.promptVersions?.length || node.text !== entity.generationPrompt) return false;
  if (tasks.some(task => task.targetType === "canvas_node" && task.targetId === node.id) || catalog?.assets.some(asset => asset.sourceTargetId === node.id)) return false;
  const incoming = document.edges.filter(edge => edge.to === node.id);
  const parent = document.nodes.find(source => source.id === incoming[0]?.from);
  if (incoming.length !== 1 || !parent || node.title !== `${parent.title} · 图片`.slice(0, 300) || document.edges.some(edge => edge.from === node.id)) return false;
  return entity.candidates.some(candidate => candidate.selected && candidate.url);
}

export function canvasCardSummary(node: CanvasCard, catalog: ProjectAssetCatalog | undefined, panels: StudioStoryboardPanel[], locale: StudioLocale) {
  const panel = panels.find(item => item.id === node.panelId);
  if (panel && node.kind === "video" && node.episodeLayer === "shot_video")
    return [panel.locationName, panel.shotType, panel.cameraMove,
      locale === "en" ? "Video result for this shot. Select to edit the full prompt." : "本镜头的视频结果，点击编辑完整提示词。"].filter(Boolean).join(" · ");
  if (panel && node.kind === "panel")
    return [panel.description, panel.lipSyncText ? `${panel.speakingCharacter ?? ""}：${panel.lipSyncText}` : panel.voiceoverText].filter(Boolean).join("\n");
  const entity = linkedCanvasAsset(node, catalog);
  if (entity)
    return entity.visualProfile?.spec.shapeAndStructure || entity.description || entity.name;
  const inherited = inheritedCanvasAsset(node, catalog);
  if (inherited)
    return locale === "en" ? `Image candidates for ${inherited.name}. Select to review or create a new version.` : `${inherited.name}的参考图候选。点击查看或生成新版本。`;
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
    (node.outputKind ?? (node.kind === "video" ? "video" : "image")) === "video"
      ? panel?.videoAssetId
      : panel?.imageAssetId;
  if (official) return catalog?.assets.find((asset) => asset.id === official);
  const candidates = nodeCandidates(node, catalog);
  const ownOutput = inheritedCanvasAsset(node, catalog)
    ? candidates.find(asset => asset.sourceTargetId === node.id && asset.kind === "image")
    : undefined;
  if (ownOutput) return ownOutput;
  const inherited = inheritedCanvasAsset(node, catalog);
  if (inherited) {
    const baseline = inherited.candidates.find(candidate => candidate.selected && candidate.url);
    const fallback = inherited.candidates.filter(candidate => candidate.url)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const assetId = (baseline ?? fallback)?.assetId;
    if (assetId) return catalog?.assets.find(asset => asset.id === assetId);
  }
  return candidates.find(
    (asset) =>
      asset.kind ===
      (node.kind === "audio"
        ? "audio"
        : (node.outputKind ?? (node.kind === "video" ? "video" : "image"))),
  );
}

export function canvasNodeTask(
  node: CanvasCard,
  tasks: MediaTask[],
): MediaTask | undefined {
  const kind =
    node.outputKind ??
    (node.kind === "video" ? "video" : node.kind === "audio" ? "audio" : "image");
  const targetType = node.panelId ? "storyboard_panel" : "canvas_node";
  const targetId = node.panelId ?? node.id;
  return tasks
    .filter(
      (task) =>
        task.targetType === targetType &&
        task.targetId === targetId &&
        task.kind === kind,
    )
    .sort(
      (a, b) =>
        Number(["queued", "running"].includes(b.status)) -
          Number(["queued", "running"].includes(a.status)) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )[0];
}
