import { canvasAssetSource, canvasEdgePurpose } from "@/lib/studio/canvas-document";
import type {
  ProjectAssetCatalog,
  ProjectMediaAsset,
  StudioLocale,
  StudioStoryboardPanel,
  StudioSelectionContext,
} from "../types";
import type { MediaTask } from "@/lib/media/task-contract";
import { isAssetVisualProfileComplete } from "@/lib/assets/visual-profile";
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
  const media = nodeMedia(node, catalog, panels, document);
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
    defaultTitle: `镜头 ${panel.panelIndex + 1}`,
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
  document?: CanvasDocument,
) {
  const inherited = canvasNodeAsset(node, catalog, document);
  const inheritedIds = new Set(inherited?.candidates.map(candidate => candidate.assetId));
  return (catalog?.assets ?? [])
    .filter(
      (asset) =>
        asset.kind === canvasMediaKind(node) &&
        asset.url &&
        asset.taskStatus === "succeeded" &&
        (asset.id === node.assetId ||
          inheritedIds.has(asset.id) ||
          (!!(node.panelId ?? node.detachedPanelId) && asset.sourceTargetId === (node.panelId ?? node.detachedPanelId)) ||
          asset.sourceTargetId === node.id ||
          (!!node.entityId &&
            asset.references.some((ref) => ref.entityId === node.entityId))),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A linked shot can switch output mode; fixed media cards keep their own kind. */
export function canvasMediaKind(node: CanvasCard): ProjectMediaAsset["kind"] | undefined {
  if (node.kind === "panel") return node.outputKind ?? "image";
  if (node.kind === "video" || node.kind === "audio") return node.kind;
  if (["image", "character", "location", "prop"].includes(node.kind)) return "image";
}

/** Default episode asset branches reuse project images until they have their own output. */
function inheritedCanvasAsset(node: CanvasCard, catalog?: ProjectAssetCatalog, document?: CanvasDocument) {
  const prefix = "episode-asset-image-";
  if (!catalog || node.kind !== "image") return;
  const source = canvasAssetSource(node, document);
  if (source) return linkedCanvasAsset(source, catalog);
  if (document?.edges.some(edge => edge.to === node.id && document.nodes.some(parent => parent.id === edge.from && parent.entityId && ["character", "location", "prop"].includes(parent.kind)))) return;
  if (!node.id.startsWith(prefix)) return;
  return canvasAssetEntities(catalog).get(node.id.slice(prefix.length));
}

export function canvasNodeAsset(node: CanvasCard, catalog?: ProjectAssetCatalog, document?: CanvasDocument) {
  return linkedCanvasAsset(node, catalog) ?? inheritedCanvasAsset(node, catalog, document);
}

export function canvasImageAvailability(node: CanvasCard, catalog: ProjectAssetCatalog | undefined, document: CanvasDocument, locale: StudioLocale) {
  const entity = canvasNodeAsset(node, catalog, document);
  if (!entity) return;
  return isAssetVisualProfileComplete(entity.visualProfile)
    ? locale === "en" ? "Design ready · image not generated" : "设定已完成 · 图片未生成"
    : entity.visualProfile
      ? locale === "en" ? "Design incomplete · image not generated" : "设定待完善 · 图片未生成"
    : locale === "en" ? "Image not generated" : "图片未生成";
}

export function isReusableCanvasBranch(node: CanvasCard, document: CanvasDocument, catalog: ProjectAssetCatalog | undefined, tasks: MediaTask[]) {
  if (node.kind !== "image" || !catalog) return false;
  const incoming = document.edges.filter(edge => edge.to === node.id);
  const parent = document.nodes.find(source => source.id === incoming[0]?.from);
  if (incoming.length !== 1 || !parent || node.title !== `${parent.title} · 图片`.slice(0, 300) || document.edges.some(edge => edge.from === node.id)) return false;
  // Legacy generated branches can duplicate the baseline already shown on the asset.
  // Fold only a single adopted result with no pending work or prompt edits.
  const parentEntity = linkedCanvasAsset(parent, catalog);
  const baseline = parentEntity?.candidates.find(candidate => candidate.selected && candidate.url);
  const ownOutputs = nodeCandidates(node, catalog, document).filter(asset => asset.sourceTargetId === node.id || asset.id === node.assetId);
  const recordedVersion = node.promptVersions?.length === 1 ? node.promptVersions[0] : undefined;
  const unchangedGeneratedPrompt = recordedVersion?.kind === "image" && recordedVersion.prompt === node.text && recordedVersion.createdAt <= (ownOutputs[0]?.createdAt ?? "");
  if (node.episodeLayer === "asset_image" && baseline && ownOutputs.length === 1 && ownOutputs[0].id === baseline.assetId && (!node.promptVersions?.length || unchangedGeneratedPrompt) &&
      !tasks.some(task => task.targetId === node.id && ["queued", "running", "failed"].includes(task.status))) {
    const completedTask = tasks.find(task => task.targetId === node.id && task.status === "succeeded" && task.output?.some(output => output.id === baseline.assetId));
    const generatedPrompt = completedTask?.request.prompt;
    if (unchangedGeneratedPrompt || node.text === parentEntity?.generationPrompt || (typeof generatedPrompt === "string" && node.text === generatedPrompt)) return true;
  }
  const entity = inheritedCanvasAsset(node, catalog, document);
  if (!entity || node.assetId || node.modelId || node.promptVersions?.length || node.text !== entity.generationPrompt) return false;
  if (tasks.some(task => task.targetType === "canvas_node" && task.targetId === node.id) || catalog?.assets.some(asset => asset.sourceTargetId === node.id)) return false;
  return entity.candidates.some(candidate => candidate.selected && candidate.url);
}

export function canvasCardSummary(node: CanvasCard, catalog: ProjectAssetCatalog | undefined, panels: StudioStoryboardPanel[], locale: StudioLocale, document?: CanvasDocument) {
  const parent = document?.nodes.find(source => document.edges.some(edge => edge.from === source.id && edge.to === node.id) && (source.kind === "panel" || ["character", "location", "prop"].includes(source.kind)));
  const panel = panels.find(item => item.id === (node.panelId ?? parent?.panelId));
  if (panel && node.kind === "video" && node.episodeLayer === "shot_video")
    return [panel.locationName, panel.shotType?.slice(0, 24), panel.cameraMove ? `${panel.cameraMove.slice(0, 48)}${panel.cameraMove.length > 48 ? "…" : ""}` : undefined,
      locale === "en" ? "Video result for this shot. Select to edit the full prompt." : "本镜头的视频结果，点击编辑完整提示词。"].filter(Boolean).join(" · ");
  if (panel && node.kind === "panel")
    return [panel.description, panel.lipSyncText ? `${panel.speakingCharacter ?? ""}：${panel.lipSyncText}` : panel.voiceoverText].filter(Boolean).join("\n");
  const entity = linkedCanvasAsset(node, catalog);
  if (entity)
    return entity.visualProfile?.spec.shapeAndStructure || entity.description || entity.name;
  const inherited = inheritedCanvasAsset(node, catalog, document) ?? (parent && linkedCanvasAsset(parent, catalog));
  if (inherited)
    return locale === "en" ? `Image candidates for ${inherited.name}. Select to review or create a new version.` : `${inherited.name}的参考图候选。点击查看或生成新版本。`;
}
export function nodeMedia(
  node: CanvasCard,
  catalog?: ProjectAssetCatalog,
  panels: StudioStoryboardPanel[] = [],
  document?: CanvasDocument,
): ProjectMediaAsset | undefined {
  const mediaById = (id: string) => catalog?.assets.find((asset) => asset.id === id && asset.kind === canvasMediaKind(node));
  if (node.assetId)
    return mediaById(node.assetId);
  const entity = linkedCanvasAsset(node, catalog);
  if (entity) {
    const adopted = entity.candidates.find(
      (candidate) => candidate.selected && candidate.url,
    );
    const fallback = entity.candidates
      .filter((candidate) => candidate.url)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const assetId = (adopted ?? fallback)?.assetId;
    if (assetId) return mediaById(assetId);
  }
  const panel = panels.find((item) => item.id === node.panelId);
  const official =
    canvasMediaKind(node) === "video"
      ? panel?.videoAssetId
      : panel?.imageAssetId;
  if (official) return mediaById(official);
  const candidates = nodeCandidates(node, catalog, document);
  const ownOutput = inheritedCanvasAsset(node, catalog, document)
    ? candidates.find(asset => asset.sourceTargetId === node.id && asset.kind === "image")
    : undefined;
  if (ownOutput) return ownOutput;
  const inherited = inheritedCanvasAsset(node, catalog, document);
  if (inherited) {
    const baseline = inherited.candidates.find(candidate => candidate.selected && candidate.url);
    const fallback = inherited.candidates.filter(candidate => candidate.url)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const assetId = (baseline ?? fallback)?.assetId;
    if (assetId) return mediaById(assetId);
  }
  return candidates[0];
}

export function canvasNodeTask(
  node: CanvasCard,
  tasks: MediaTask[],
  catalog?: ProjectAssetCatalog,
  document?: CanvasDocument,
): MediaTask | undefined {
  const kind =
    node.outputKind ??
    (node.kind === "video" ? "video" : node.kind === "audio" ? "audio" : "image");
  const targetType = node.panelId ? "storyboard_panel" : "canvas_node";
  const targetId = node.panelId ?? node.id;
  const ownTasks = tasks
    .filter(
      (task) =>
        ((task.targetType === targetType && task.targetId === targetId) ||
          (task.targetType === "canvas_node" && task.targetId === node.id)) &&
        task.kind === kind,
    );
  const entity = canvasNodeAsset(node, catalog, document);
  const candidateIds = new Set(entity?.kind === "character"
    ? catalog?.characters.find(item => item.id === entity.id)?.appearances.map(item => item.id)
    : entity?.kind === "location"
      ? catalog?.locations.find(item => item.id === entity.id)?.images.map(item => item.id)
      : []);
  return (ownTasks.length ? ownTasks : tasks.filter(task => entity && task.kind === "image" &&
    ((task.targetType === entity.kind && task.targetId === entity.id) ||
      (task.targetType === (entity.kind === "character" ? "character_appearance" : "location_image") && candidateIds.has(task.targetId ?? "")))))
    .sort(
      (a, b) =>
        Number(["queued", "running"].includes(b.status)) -
          Number(["queued", "running"].includes(a.status)) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )[0];
}
