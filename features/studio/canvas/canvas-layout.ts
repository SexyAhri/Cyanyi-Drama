import type { CanvasDocument } from "./types";
import { CARD_HEIGHT, CARD_WIDTH } from "./canvas-view-model";
import type { StudioLocale, StudioStoryboardPanel } from "../types";
import type { ProjectAssetCatalog } from "../types";
import {
  canvasAssetCards,
  linkedCanvasAsset,
  panelCard,
} from "./canvas-view-model";

export const EPISODE_CANVAS_LAYOUT_VERSION = 4;

/** Migrate automatic layouts while keeping an explicitly chosen free layout. */
export function needsEpisodeCanvasLayout(document: CanvasDocument, graph: CanvasDocument) {
  if (document.layoutMode === "free") return false;
  if (document.layoutMode !== "episode" || document.episodeLayoutVersion !== EPISODE_CANVAS_LAYOUT_VERSION) return true;
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const edges = new Set(document.edges.map(edge => edge.id));
  return nodes.size !== graph.nodes.length || edges.size !== graph.edges.length ||
    graph.nodes.some(node => !nodes.has(node.id) || node.episodeLayer !== nodes.get(node.id)?.episodeLayer || node.panelId !== nodes.get(node.id)?.panelId) ||
    graph.edges.some(edge => !edges.has(edge.id));
}

function normalizeAssetName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, "").toLocaleLowerCase();
}

/** Build one episode graph from saved shots and their canonical script assets. */
export function buildEpisodeCanvasGraph(
  document: CanvasDocument,
  panels: StudioStoryboardPanel[],
  catalog: ProjectAssetCatalog,
  previousEpisode?: {
    id: string;
    episodeNumber: number;
    name: string;
    text: string;
  },
  protectedNodeIds: ReadonlySet<string> = new Set(),
): CanvasDocument {
  const orderedPanels = [...panels].sort((a, b) => a.panelIndex - b.panelIndex);
  const nodes = document.nodes.filter((node) => !node.sourceEpisodeId).map((node) => ({ ...node }));
  const removedIds = new Set<string>();
  function branches(parentId: string, kind: "image" | "video") {
    const parent = nodes.find(node => node.id === parentId);
    return nodes.filter((node) => node.kind === kind &&
      (kind !== "video" || !node.panelId || node.panelId === parent?.panelId) && document.edges.some(
      (edge) => edge.from === parentId && edge.to === node.id,
    ));
  }
  function reuseBranches(parentId: string, kind: "image" | "video", autoId: string, templatePrompt: string) {
    const existing = branches(parentId, kind);
    const manual = existing.filter((node) => node.id !== autoId);
    const auto = nodes.find((node) => node.id === autoId);
    // Only discard the extra template created by the earlier layout migration.
    // Anything with saved media, an active task or user edits remains a candidate.
    if (manual.length && auto && !auto.assetId && !auto.modelId &&
        !auto.promptVersions?.length && !protectedNodeIds.has(auto.id) &&
        auto.text === templatePrompt && (!auto.videoText || auto.videoText === templatePrompt)) {
      removedIds.add(auto.id);
    }
    return existing.filter((node) => !removedIds.has(node.id));
  }
  const nodeByPanel = new Map(
    nodes.flatMap((node) =>
      node.kind === "panel" && node.panelId
        ? [[node.panelId, node] as const]
        : [],
    ),
  );
  for (const [index, panel] of orderedPanels.entries()) {
    if (nodeByPanel.has(panel.id)) continue;
    const node = panelCard(panel, index);
    nodes.push(node);
    nodeByPanel.set(panel.id, node);
  }

  const videoNodeByPanel = new Map<string, CanvasDocument["nodes"][number]>();
  for (const panel of orderedPanels) {
    const id = `episode-video-${panel.id}`;
    const parent = nodeByPanel.get(panel.id)!;
    const reused = reuseBranches(parent.id, "video", id, panel.videoPrompt ?? "");
    if (reused.length) {
      for (const branch of reused) {
        branch.episodeLayer = "shot_video";
        branch.panelId ??= panel.id;
      }
      videoNodeByPanel.set(panel.id, reused[0]);
      continue;
    }
    const existing = nodes.find((node) => node.id === id);
    const prompt = panel.videoPrompt ?? "";
    const node = {
      ...existing,
      id,
      kind: "video" as const,
      title: `镜头 ${panel.panelIndex + 1} · 视频`,
      text: existing?.text ?? prompt,
      videoText: existing?.videoText ?? prompt,
      panelId: panel.id,
      episodeLayer: "shot_video" as const,
      outputKind: "video" as const,
      panelPromptBase: existing?.panelPromptBase ?? {
        image: panel.imagePrompt ?? panel.description ?? "",
        video: prompt,
      },
      x: existing?.x ?? 0,
      y: existing?.y ?? 0,
    };
    if (existing) Object.assign(existing, node);
    else nodes.push(node);
    videoNodeByPanel.set(panel.id, existing ?? node);
  }

  const assets = canvasAssetCards(catalog);
  const assetByName = new Map(
    assets.map((asset) => [
      `${asset.kind}:${normalizeAssetName(asset.title)}`,
      asset,
    ]),
  );
  const existingIds = new Set(nodes.map((node) => node.id));
  const usedAssetIds = new Set<string>();
  const generatedEdge = (edge: CanvasDocument["edges"][number]) =>
    edge.id.startsWith("episode-");
  const edges = document.edges.filter((edge) => !generatedEdge(edge));
  const addEdge = (
    from: string,
    to: string,
    purpose: "shot_sequence" | "story_asset" | "episode_bridge" | "shot_video",
  ) => {
    if (edges.some((edge) => edge.from === from && edge.to === to && edge.purpose === purpose)) return;
    const prefix = purpose === "episode_bridge" ? "episode-bridge" : `episode-${purpose}`;
    edges.push({
      id: `${prefix}-${from.slice(-20)}-${to.slice(-20)}`,
      from,
      to,
      purpose,
    });
  };

  orderedPanels.forEach((panel, index) => {
    const node = nodeByPanel.get(panel.id)!;
    const videoNode = videoNodeByPanel.get(panel.id)!;
    if (!edges.some((edge) => edge.from === node.id && edge.to === videoNode.id))
      addEdge(node.id, videoNode.id, "shot_video");
    const previous = orderedPanels[index - 1];
    if (previous) addEdge(nodeByPanel.get(previous.id)!.id, node.id, "shot_sequence");

    const mentions = [
      ...panel.characters.map((name) => ["character", name] as const),
      ...(panel.locationName ? [["location", panel.locationName] as const] : []),
      ...panel.props.map((name) => ["prop", name] as const),
    ];
    for (const [kind, name] of mentions) {
      const asset = assetByName.get(`${kind}:${normalizeAssetName(name)}`);
      if (!asset) continue;
      if (!existingIds.has(asset.id)) {
        nodes.push(asset);
        existingIds.add(asset.id);
      }
      usedAssetIds.add(asset.id);
      const firstUse = orderedPanels.findIndex((candidate) =>
        [
          ...candidate.characters.map((value) => ["character", value] as const),
          ...(candidate.locationName
            ? [["location", candidate.locationName] as const]
            : []),
          ...candidate.props.map((value) => ["prop", value] as const),
        ].some(
          ([candidateKind, candidateName]) =>
            candidateKind === kind &&
            normalizeAssetName(candidateName) === normalizeAssetName(name),
        ),
      );
      if (firstUse === index) addEdge(asset.id, node.id, "story_asset");
    }
  });

  for (const asset of nodes.filter((node) => usedAssetIds.has(node.id))) {
    const id = `episode-asset-image-${asset.id}`;
    const reused = reuseBranches(asset.id, "image", id, linkedCanvasAsset(asset, catalog)?.generationPrompt ?? "");
    if (reused.length) {
      for (const branch of reused) branch.episodeLayer = "asset_image";
      if (!edges.some((edge) => edge.from === asset.id && edge.to === reused[0].id))
        addEdge(asset.id, reused[0].id, "story_asset");
      continue;
    }
    const existing = nodes.find((node) => node.id === id);
    const prompt = linkedCanvasAsset(asset, catalog)?.generationPrompt ?? "";
    const image = {
      ...existing,
      id,
      kind: "image" as const,
      title: `${asset.title} · 图片`.slice(0, 300),
      text: existing?.text || prompt,
      panelId: undefined,
      entityId: undefined,
      episodeLayer: "asset_image" as const,
      outputKind: "image" as const,
      x: existing?.x ?? 0,
      y: existing?.y ?? 0,
    };
    if (existing) Object.assign(existing, image);
    else nodes.push(image);
    addEdge(asset.id, id, "story_asset");
  }

  const firstPanel = orderedPanels[0];
  const firstMentions = firstPanel
    ? [
        ...firstPanel.characters.map((name) => ["character", name] as const),
        ...firstPanel.props.map((name) => ["prop", name] as const),
      ]
    : [];
  const previousEnding = previousEpisode?.text.trim().slice(-1600) ?? "";
  const sharedEvidence = firstMentions.find(([, name]) =>
    name.trim().length >= 2 && previousEnding.includes(name.trim()),
  );
  const previousNodeId = previousEpisode
    ? `episode-context-${previousEpisode.id}`
    : "";
  if (previousEpisode && sharedEvidence && firstPanel && previousEnding) {
    const relatedName = sharedEvidence[1].trim();
    const previousNode = {
      id: previousNodeId,
      kind: "text" as const,
      title: `第${previousEpisode.episodeNumber}集片尾承接 · ${relatedName}`.slice(0, 300),
      text: `${previousEnding.slice(-500)}\n\n与本集开场的共同线索：${relatedName}`,
      sourceEpisodeId: previousEpisode.id,
      x: 0,
      y: 0,
    };
    nodes.push(previousNode);
    addEdge(previousNodeId, nodeByPanel.get(firstPanel.id)!.id, "episode_bridge");
  }
  const keptNodes = nodes.filter((node) => !removedIds.has(node.id));
  const keptIds = new Set(keptNodes.map((node) => node.id));
  return { ...document, nodes: keptNodes, edges: edges.filter((edge) => keptIds.has(edge.from) && keptIds.has(edge.to)) };
}

/** One left-to-right shot timeline above a separate asset lane. */
export function arrangeEpisodeCausalGraph(
  document: CanvasDocument,
  panels: StudioStoryboardPanel[],
  locale: StudioLocale = "zh-CN",
): CanvasDocument {
  const orderedPanels = [...panels].sort((a, b) => a.panelIndex - b.panelIndex);
  const panelOrder = new Map(orderedPanels.map((panel, index) => [panel.id, index]));
  const panelNodes = document.nodes.filter(node => node.kind === "panel" && node.panelId && panelOrder.has(node.panelId))
    .sort((a, b) => panelOrder.get(a.panelId!)! - panelOrder.get(b.panelId!)!);
  const positions = new Map<string, { x: number; y: number }>();
  const groups: NonNullable<CanvasDocument["branchGroups"]> = [];
  const stepX = CARD_WIDTH + 160;
  const stepY = CARD_HEIGHT + 100;
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const children = (parent: CanvasDocument["nodes"][number]) => document.nodes.filter(node =>
    (node.kind === "image" || node.kind === "video" || node.kind === "audio") &&
    !positions.has(node.id) &&
    (document.edges.some(edge => edge.from === parent.id && edge.to === node.id) ||
      (parent.kind === "panel" && node.panelId === parent.panelId)),
  ).sort((a, b) => ["video", "image", "audio"].indexOf(a.kind) - ["video", "image", "audio"].indexOf(b.kind));
  const placeColumn = (parent: CanvasDocument["nodes"][number], x: number, y: number) => {
    positions.set(parent.id, { x, y });
    const outputs = children(parent);
    outputs.forEach((node, index) => positions.set(node.id, { x, y: y + (index + 1) * stepY }));
    return [parent.id, ...outputs.map(node => node.id)];
  };

  let shotX = 40;
  for (const node of document.nodes.filter(node => node.sourceEpisodeId)) {
    const ids = placeColumn(node, shotX, 112);
    groups.push({ id: `episode-section-${node.id}`.slice(0, 100), label: t("前集承接", "Previous episode"), nodeIds: ids, x: shotX, y: 40 });
    shotX += stepX + 160;
  }
  const zeroBasedScenes = orderedPanels.some(panel => panel.sceneNumber === 0);
  let sceneKey = "";
  let sceneGroup: NonNullable<CanvasDocument["branchGroups"]>[number] | undefined;
  for (const node of panelNodes) {
    const panel = orderedPanels[panelOrder.get(node.panelId!)!];
    const key = `${panel.clipId ?? ""}:${panel.sceneNumber ?? ""}:${panel.locationName ?? ""}`;
    if (!sceneGroup || key !== sceneKey) {
      if (sceneGroup) shotX += 160;
      sceneKey = key;
      const number = panel.sceneNumber == null
        ? groups.filter(group => group.id.startsWith("episode-scene-")).length + 1
        : panel.sceneNumber + (zeroBasedScenes ? 1 : 0);
      const label = [`${t("场次", "Scene")} ${number}`, panel.locationName].filter(Boolean).join(" · ");
      sceneGroup = { id: `episode-scene-${node.id}`.slice(0, 100), label, nodeIds: [], x: shotX, y: 40 };
      groups.push(sceneGroup);
    }
    sceneGroup.nodeIds.push(...placeColumn(node, shotX, 112));
    shotX += stepX;
  }

  const shotBottom = Math.max(352, ...[...positions.values()].map(position => position.y + CARD_HEIGHT));
  const assetTop = shotBottom + 200;
  // Retain the original episode layout's first-use order within each asset lane.
  const firstUse = new Map<string, number>();
  const shotOrder = new Map(panelNodes.map((node, index) => [node.id, index]));
  for (const edge of document.edges) {
    const index = shotOrder.get(edge.to);
    if (edge.purpose === "story_asset" && index !== undefined) {
      firstUse.set(edge.from, Math.min(firstUse.get(edge.from) ?? Infinity, index));
    }
  }
  let assetX = 40;
  for (const [kind, label] of [
    ["character", t("角色资产", "Characters")],
    ["location", t("场景资产", "Locations")],
    ["prop", t("道具资产", "Props")],
  ] as const) {
    const assets = document.nodes.filter(node => node.kind === kind)
      .sort((a, b) => (firstUse.get(a.id) ?? Infinity) - (firstUse.get(b.id) ?? Infinity));
    if (!assets.length) continue;
    const group = { id: `episode-assets-${kind}`, label, nodeIds: [] as string[], x: assetX, y: assetTop };
    groups.push(group);
    for (const asset of assets) {
      group.nodeIds.push(...placeColumn(asset, assetX, assetTop + 72));
      assetX += stepX;
    }
    assetX += 200;
  }

  // Keep unlinked notes, legacy shots and uploads in their own lower section.
  const remaining = document.nodes.filter(node => !positions.has(node.id));
  if (remaining.length) {
    const top = Math.max(assetTop + 72, ...[...positions.values()].map(position => position.y + CARD_HEIGHT)) + 200;
    groups.push({ id: "episode-other-nodes", label: t("补充素材与备注", "Additional media and notes"), nodeIds: remaining.map(node => node.id), x: 40, y: top });
    remaining.forEach((node, index) => positions.set(node.id, { x: 40 + index * stepX, y: top + 72 }));
  }
  return {
    ...document,
    layoutMode: "episode",
    episodeLayoutVersion: EPISODE_CANVAS_LAYOUT_VERSION,
    branchGroups: groups,
    nodes: document.nodes.map(node => ({ ...node, ...positions.get(node.id) })),
  };
}

/** Timeline edges leave the right side and enter the next shot from the left. */
export function canvasEpisodeSequencePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const x = from.x + CARD_WIDTH;
  const y = from.y + CARD_HEIGHT / 2;
  const tx = to.x;
  const ty = to.y + CARD_HEIGHT / 2;
  if (ty === y && tx > x) {
    return { path: `M ${x} ${y} H ${tx}`, labelX: (x + tx) / 2, labelY: y - 12 };
  }
  return canvasBranchPath(x, y, tx, ty);
}

/** Additional candidates route around earlier cards in the same output column. */
export function canvasEpisodeOutputPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  if (from.x !== to.x || to.y <= from.y + CARD_HEIGHT) {
    return canvasBranchPath(from.x + CARD_WIDTH, from.y + CARD_HEIGHT / 2, to.x, to.y + CARD_HEIGHT / 2);
  }
  const x = from.x + CARD_WIDTH / 2;
  const y = from.y + CARD_HEIGHT;
  if (to.y - y <= 160) {
    return { path: `M ${x} ${y} V ${to.y}`, labelX: x + 24, labelY: (y + to.y) / 2 };
  }
  const gutter = from.x + CARD_WIDTH + 56;
  return {
    path: `M ${x} ${y} V ${y + 36} H ${gutter} V ${to.y - 36} H ${x} V ${to.y}`,
    labelX: gutter + 16,
    labelY: (y + to.y) / 2,
  };
}
export function arrangeEpisodeBranches(
  document: CanvasDocument,
  panels: StudioStoryboardPanel[],
  locale: StudioLocale,
): CanvasDocument {
  if (!document.nodes.length)
    return { ...document, layoutMode: "branches", branchGroups: [] };
  const panelMap = new Map(panels.map((panel) => [panel.id, panel]));
  const buckets = new Map<string, { label: string; nodeIds: string[] }>();
  const connected = new Set(
    document.edges.flatMap((edge) => [edge.from, edge.to]),
  );
  const shotNodes = document.nodes
    .filter((node) => node.panelId && !connected.has(node.id))
    .sort(
      (a, b) =>
        (panelMap.get(a.panelId!)?.panelIndex ?? 0) -
        (panelMap.get(b.panelId!)?.panelIndex ?? 0),
    );
  for (const node of shotNodes) {
    const panel = panelMap.get(node.panelId!);
    const location = panel?.locationName
      ?.normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ");
    const section = location
      ? `location-${location.toLowerCase()}`
      : panel?.sceneNumber != null
        ? `scene-${panel.sceneNumber}`
        : (panel?.clipId ?? "shots");
    const label =
      location ||
      (panel?.sceneNumber != null
        ? `${locale === "en" ? "Scene" : "场景"} ${panel.sceneNumber}`
        : locale === "en"
          ? "Shot sequence"
          : "镜头序列");
    if (!buckets.has(section)) buckets.set(section, { label, nodeIds: [] });
    buckets.get(section)!.nodeIds.push(node.id);
  }
  const occupied = new Set(document.nodes.map((node) => node.id));
  let groupIndex = 0;
  const groups = [...buckets.values()]
    .filter((bucket) => bucket.nodeIds.length > 1)
    .map((bucket) => {
      let id = `layout-group-${groupIndex++}`;
      while (occupied.has(id)) id = `layout-group-${groupIndex++}`;
      occupied.add(id);
      return { ...bucket, id };
    });
  const virtualNodes = groups.map((group) => ({
    id: group.id,
    kind: "text" as const,
    title: group.label,
    text: "",
    x: 0,
    y: 0,
  }));
  const arranged = arrangeCanvasBranches({
    ...document,
    nodes: [...virtualNodes, ...document.nodes],
    edges: [
      ...document.edges,
      ...groups.flatMap((group) =>
        group.nodeIds.map((to) => ({
          id: `${group.id}-${to}`,
          from: group.id,
          to,
        })),
      ),
    ],
  });
  const positions = new Map(arranged.nodes.map((node) => [node.id, node]));
  return {
    ...document,
    layoutMode: "branches",
    nodes: document.nodes.map((node) => ({
      ...node,
      x: positions.get(node.id)!.x,
      y: positions.get(node.id)!.y,
    })),
    branchGroups: groups.map((group) => ({
      ...group,
      x: positions.get(group.id)!.x,
      y: positions.get(group.id)!.y,
    })),
  };
}

/** Consolidate saved headings without changing node positions or generation edges. */
export function mergeCanvasBranchGroups(
  document: CanvasDocument,
): CanvasDocument {
  const groups = document.branchGroups;
  if (!groups?.length) return document;
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const connected = new Set(
    document.edges.flatMap((edge) => [edge.from, edge.to]),
  );
  const merged = new Map<string, (typeof groups)[number]>();
  for (const group of groups) {
    const nodeIds = group.nodeIds.filter(
      (id) => nodes.get(id)?.panelId && !connected.has(id),
    );
    if (nodeIds.length < 2) continue;
    const label = group.label.normalize("NFKC").trim().replace(/\s+/g, " ");
    const category = group.nodeIds.some((id) => nodes.get(id)?.panelId)
      ? "shots"
      : "assets";
    const key = `${category}:${label.toLowerCase()}`;
    const existing = merged.get(key);
    if (existing) {
      existing.nodeIds = [...new Set([...existing.nodeIds, ...nodeIds])];
      existing.x = Math.min(existing.x, group.x);
      const members = existing.nodeIds.flatMap((id) =>
        nodes.has(id) ? [nodes.get(id)!] : [],
      );
      if (members.length)
        existing.y =
          (Math.min(...members.map((node) => node.y)) +
            Math.max(...members.map((node) => node.y))) /
          2;
    } else merged.set(key, { ...group, label, nodeIds });
  }
  if (JSON.stringify([...merged.values()]) === JSON.stringify(groups))
    return document;
  return { ...document, branchGroups: [...merged.values()] };
}

/** Arrange the directed graph as a forest, retaining shared inputs and cycles. */
export function arrangeCanvasBranches(
  document: CanvasDocument,
): CanvasDocument {
  if (!document.nodes.length) return document;
  const adjacency = new Map(
    document.nodes.map((node) => [node.id, new Set<string>()]),
  );
  for (const edge of document.edges) {
    if (adjacency.has(edge.from) && adjacency.has(edge.to))
      adjacency.get(edge.from)!.add(edge.to);
  }

  // Collapse cycles before deriving depth so imported graphs cannot loop forever.
  let cursor = 0;
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const groups: string[][] = [];
  function visit(id: string) {
    indices.set(id, cursor);
    low.set(id, cursor++);
    stack.push(id);
    stacked.add(id);
    for (const next of adjacency.get(id)!) {
      if (!indices.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (stacked.has(next)) {
        low.set(id, Math.min(low.get(id)!, indices.get(next)!));
      }
    }
    if (low.get(id) !== indices.get(id)) return;
    const group: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      stacked.delete(member);
      group.push(member);
    } while (member !== id);
    groups.push(group);
  }
  for (const node of document.nodes) if (!indices.has(node.id)) visit(node.id);
  const order = new Map(document.nodes.map((node, index) => [node.id, index]));
  for (const group of groups)
    group.sort((a, b) => order.get(a)! - order.get(b)!);
  groups.sort((a, b) => order.get(a[0])! - order.get(b[0])!);
  const membership = new Map(
    groups.flatMap((group, index) => group.map((id) => [id, index] as const)),
  );
  const parents = groups.map(() => new Set<number>());
  const outgoing = groups.map(() => new Set<number>());
  for (const [id, targets] of adjacency) {
    const source = membership.get(id)!;
    for (const target of targets) {
      const destination = membership.get(target)!;
      if (source === destination) continue;
      parents[destination].add(source);
      outgoing[source].add(destination);
    }
  }
  const depths = groups.map(() => 0);
  const pending = parents.map((items) => items.size);
  const queue = groups
    .map((_, index) => index)
    .filter((index) => !pending[index]);
  for (let index = 0; index < queue.length; index++) {
    const source = queue[index];
    for (const destination of outgoing[source]) {
      depths[destination] = Math.max(depths[destination], depths[source] + 1);
      if (--pending[destination] === 0) queue.push(destination);
    }
  }

  // A shared node has one layout parent; all of its real edges remain intact.
  const children = groups.map(() => [] as number[]);
  const roots: number[] = [];
  groups.forEach((_, index) => {
    const candidates = [...parents[index]].sort(
      (a, b) => depths[b] - depths[a] || a - b,
    );
    if (candidates.length) children[candidates[0]].push(index);
    else roots.push(index);
  });
  const rowHeight = CARD_HEIGHT + 64;
  const sizes = groups.map(() => 0);
  function measure(index: number): number {
    sizes[index] = Math.max(
      groups[index].length * rowHeight,
      children[index].reduce((sum, child) => sum + measure(child), 0),
    );
    return sizes[index];
  }
  roots.forEach(measure);
  const positions = new Map<string, { x: number; y: number }>();
  function place(index: number, top: number) {
    const height = groups[index].length * rowHeight;
    groups[index].forEach((id, row) =>
      positions.set(id, {
        x: 40 + depths[index] * (CARD_WIDTH + 180),
        y: top + (sizes[index] - height) / 2 + row * rowHeight,
      }),
    );
    const childHeight = children[index].reduce(
      (sum, child) => sum + sizes[child],
      0,
    );
    let childTop = top + (sizes[index] - childHeight) / 2;
    for (const child of children[index]) {
      place(child, childTop);
      childTop += sizes[child];
    }
  }
  let top = 40;
  for (const root of roots) {
    place(root, top);
    top += sizes[root] + 80;
  }
  return {
    ...document,
    nodes: document.nodes.map((node) => ({
      ...node,
      ...positions.get(node.id)!,
    })),
  };
}

export function canvasBranchPath(x: number, y: number, tx: number, ty: number) {
  if (tx - x < 48) {
    return {
      path: `M ${x} ${y} C ${x + 100} ${y}, ${tx - 100} ${ty}, ${tx} ${ty}`,
      labelX: (x + tx) / 2,
      labelY: (y + ty) / 2 - 10,
    };
  }
  const middle = (x + tx) / 2;
  const radius = Math.min(16, Math.abs(ty - y) / 2);
  const direction = ty >= y ? 1 : -1;
  return {
    path: `M ${x} ${y} H ${middle - radius} Q ${middle} ${y} ${middle} ${y + direction * radius} V ${ty - direction * radius} Q ${middle} ${ty} ${middle + radius} ${ty} H ${tx}`,
    labelX: (middle + tx) / 2,
    labelY: ty - 12,
  };
}
