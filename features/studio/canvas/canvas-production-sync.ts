import type { ProjectAssetCatalog, StudioStoryboardPanel } from "../types";
import type { CanvasCard, CanvasDocument } from "./types";
import {
  canvasNodeAsset,
  nodeCandidates,
  nodeMedia,
} from "./canvas-view-model";

export function canvasAssetPromptDifference(
  node: CanvasCard,
  document: CanvasDocument,
  catalog?: ProjectAssetCatalog,
) {
  if (node.kind !== "image" || node.episodeLayer !== "asset_image") return;
  const entity = canvasNodeAsset(node, catalog, document);
  if (!entity || node.text === entity.generationPrompt) return;
  return {
    entityId: `${entity.kind}-${entity.id}`,
    currentPrompt: entity.generationPrompt,
    previousPrompt: node.assetPromptBase?.prompt,
    officialChanged: Boolean(
      node.assetPromptBase &&
      node.assetPromptBase.prompt !== entity.generationPrompt,
    ),
  };
}

/** Synchronize production metadata without rearranging, overwriting drafts or touching history. */
export function syncCanvasProduction(
  document: CanvasDocument,
  panels: StudioStoryboardPanel[],
  catalog?: ProjectAssetCatalog,
  previousPanels: StudioStoryboardPanel[] = [],
): CanvasDocument {
  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  const detached = new Set<string>();
  let changed = false;
  const nodes = document.nodes.map((original) => {
    let node = original;
    const patch = (value: Partial<CanvasCard>) => {
      node = { ...node, ...value };
    };
    const panel = node.panelId ? byId.get(node.panelId) : undefined;
    if (node.panelId && !panel) {
      const previous = previousPanels.find(
        (panel) => panel.id === node.panelId,
      );
      const selected =
        !node.assetId && !previous
          ? nodeCandidates(node, catalog, document).find((asset) =>
              asset.references.some(
                (reference) =>
                  reference.entityType === "storyboard_panel" &&
                  reference.entityId === node.panelId &&
                  reference.role ===
                    (asset.kind === "video" ? "selected_video" : "selected"),
              ),
            )
          : undefined;
      const media =
        selected ?? nodeMedia(node, catalog, previousPanels, document);
      detached.add(node.id);
      patch({
        panelId: undefined,
        detachedPanelId: node.panelId,
        panelPromptBase: undefined,
        assetId: node.assetId ?? media?.id,
        episodeLayer:
          node.episodeLayer === "shot_video" ? undefined : node.episodeLayer,
      });
    }
    if (panel) {
      const defaultTitle =
        node.kind === "panel"
          ? `镜头 ${panel.panelIndex + 1}`
          : node.kind === "video" && node.episodeLayer === "shot_video"
            ? `镜头 ${panel.panelIndex + 1} · 视频`
            : undefined;
      if (defaultTitle) {
        // Legacy titles matching the exact system pattern can safely acquire a baseline.
        const systemTitle = node.defaultTitle
          ? node.title === node.defaultTitle
          : node.kind === "panel"
            ? /^镜头 \d+$/.test(node.title)
            : /^镜头 \d+ · 视频$/.test(node.title);
        if (
          node.defaultTitle !== defaultTitle ||
          (systemTitle && node.title !== defaultTitle)
        )
          patch({
            defaultTitle,
            ...(systemTitle ? { title: defaultTitle } : {}),
          });
      }
      if (node.detachedPanelId) patch({ detachedPanelId: undefined });
      if (node.panelPromptBase) {
        const base = {
          image: panel.imagePrompt ?? panel.description ?? "",
          video: panel.videoPrompt ?? "",
        };
        if (
          base.image !== node.panelPromptBase.image ||
          base.video !== node.panelPromptBase.video
        ) {
          const textBase =
            node.kind === "video"
              ? node.panelPromptBase.video
              : node.panelPromptBase.image;
          patch({
            text:
              node.text === textBase
                ? node.kind === "video"
                  ? base.video
                  : base.image
                : node.text,
            videoText:
              node.videoText === node.panelPromptBase.video
                ? base.video
                : node.videoText,
            panelPromptBase: base,
          });
        }
      }
    }
    if (node.kind === "image" && node.episodeLayer === "asset_image") {
      const entity = canvasNodeAsset(node, catalog, document);
      if (entity) {
        const entityId = `${entity.kind}-${entity.id}`;
        const base = node.assetPromptBase;
        const matchesBase =
          base?.entityId === entityId && node.text === base.prompt;
        // Missing/mismatched legacy baselines never authorize overwriting unknown user text.
        if (matchesBase || node.text === entity.generationPrompt) {
          if (
            node.text !== entity.generationPrompt ||
            base?.entityId !== entityId ||
            base?.prompt !== entity.generationPrompt
          )
            patch({
              text: entity.generationPrompt,
              assetPromptBase: { entityId, prompt: entity.generationPrompt },
            });
        }
      }
    }
    if (node !== original) changed = true;
    return node;
  });
  if (!changed) return document;
  const edges = detached.size
    ? document.edges.filter(
        (edge) =>
          !(
            ["shot_sequence", "shot_video", "causality"].includes(
              edge.purpose ?? "",
            ) &&
            (detached.has(edge.from) || detached.has(edge.to))
          ),
      )
    : document.edges;
  return { ...document, nodes, edges };
}
