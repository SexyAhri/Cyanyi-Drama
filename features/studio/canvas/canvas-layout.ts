import type { CanvasDocument } from "./types";
import { CARD_HEIGHT, CARD_WIDTH } from "./canvas-view-model";
import type { StudioLocale, StudioStoryboardPanel } from "../types";
import type { ProjectAssetCatalog } from "../types";
import {
  canvasAssetCards,
  linkedCanvasAsset,
  panelCard,
} from "./canvas-view-model";

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
    return nodes.filter((node) => node.kind === kind && document.edges.some(
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
      for (const branch of reused) branch.episodeLayer = "shot_video";
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

/** Keep the story spine easy to scan and place reference assets in a separate lane. */
export function arrangeEpisodeCausalGraph(
  document: CanvasDocument,
  panels: StudioStoryboardPanel[],
): CanvasDocument {
  const orderedPanels = [...panels].sort((a, b) => a.panelIndex - b.panelIndex);
  const panelOrder = new Map(orderedPanels.map((panel, index) => [panel.id, index]));
  const panelNodes = document.nodes
    .filter(
      (node) =>
        node.kind === "panel" &&
        node.panelId &&
        panelOrder.has(node.panelId),
    )
    .sort((a, b) => panelOrder.get(a.panelId!)! - panelOrder.get(b.panelId!)!);
  const panelPosition = new Map<string, { x: number; y: number }>();
  const panelColumns = Math.max(1, Math.min(6, panelNodes.length));
  const panelGap = CARD_WIDTH + 120;
  const panelRowGap = CARD_HEIGHT + 320;
  panelNodes.forEach((node, index) => {
    const row = Math.floor(index / panelColumns);
    const inRow = index % panelColumns;
    const column = row % 2 === 0 ? inRow : panelColumns - 1 - inRow;
    panelPosition.set(node.id, {
      x: 40 + column * panelGap,
      y: 40 + row * panelRowGap,
    });
  });

  const positions = new Map(panelPosition);
  const videoNodes = document.nodes.filter(
    (node) => node.episodeLayer === "shot_video",
  );
  for (const node of videoNodes) {
    const parentEdge = document.edges.find((edge) => edge.to === node.id && panelPosition.has(edge.from));
    const panel = panelNodes.find((item) => item.id === parentEdge?.from || (node.panelId && item.panelId === node.panelId));
    const position = positions.get(panel?.id ?? "");
    const siblings = videoNodes.filter((item) => document.edges.some((edge) => edge.from === panel?.id && edge.to === item.id));
    const slot = Math.max(0, siblings.findIndex((item) => item.id === node.id));
    if (position)
      positions.set(node.id, {
        x: position.x,
        y: position.y - (slot + 1) * (CARD_HEIGHT + 80),
      });
  }

  const assetFirstUse = new Map(
    document.edges
      .filter((edge) => edge.purpose === "story_asset")
      .flatMap((edge) => {
        const asset = document.nodes.find((item) => item.id === edge.from);
        const panel = document.nodes.find((item) => item.id === edge.to);
        return asset &&
          ["character", "location", "prop"].includes(asset.kind) &&
          panel?.kind === "panel" &&
          panel.panelId
          ? [[edge.from, panelOrder.get(panel.panelId) ?? Infinity] as const]
          : [];
      })
      .reduce((entries, [assetId, index]) => {
        const previous = entries.get(assetId);
        if (previous === undefined || index < previous)
          entries.set(assetId, index);
        return entries;
      }, new Map<string, number>()),
  );
  const assetNodes = document.nodes
    .filter((node) => ["character", "location", "prop"].includes(node.kind))
    .sort((a, b) =>
      (assetFirstUse.get(a.id) ?? Infinity) -
        (assetFirstUse.get(b.id) ?? Infinity),
    );
  const panelRows = Math.ceil(panelNodes.length / panelColumns);
  const assetGap = CARD_WIDTH + 40;
  const assetColumns = Math.max(1, Math.min(6, assetNodes.length));
  const assetTop = 40 + panelRows * panelRowGap + 80;
  const occupiedAssetPositions: Array<{ x: number; y: number }> = [];
  const groupSlots = new Map<number, number>();
  assetNodes.forEach((node, index) => {
    const useIndex = assetFirstUse.get(node.id) ?? Infinity;
    const panel = Number.isFinite(useIndex) ? panelNodes[useIndex] : undefined;
    const parent = positions.get(panel?.id ?? "");
    const slot = groupSlots.get(useIndex) ?? 0;
    groupSlots.set(useIndex, slot + 1);
    const column = slot % 3;
    let row = Math.floor(slot / 3);
    const x = (parent?.x ?? 40 + (index % assetColumns) * assetGap) +
      [0, 1, -1][column] * assetGap;
    let y = assetTop + row * (2 * CARD_HEIGHT + 160);
    while (
      occupiedAssetPositions.some(
        (item) =>
          Math.abs(item.x - x) < CARD_WIDTH + 32 &&
          Math.abs(item.y - y) < CARD_HEIGHT + 32,
      )
    ) {
      row++;
      y = assetTop + row * (2 * CARD_HEIGHT + 160);
    }
    occupiedAssetPositions.push({ x, y });
    positions.set(node.id, { x, y });
  });

  const imageNodes = document.nodes.filter(
    (node) => node.episodeLayer === "asset_image",
  );
  const occupiedImagePositions: Array<{ x: number; y: number }> = [];
  for (const node of imageNodes) {
    const sourceEdge = document.edges.find(
      (edge) => edge.to === node.id && assetNodes.some((asset) => asset.id === edge.from),
    );
    const parent = sourceEdge ? positions.get(sourceEdge.from) : undefined;
    if (!parent) continue;
    let y = parent.y + CARD_HEIGHT + 80;
    while (
      occupiedImagePositions.some(
        (item) =>
          Math.abs(item.x - parent.x) < CARD_WIDTH + 32 &&
          Math.abs(item.y - y) < CARD_HEIGHT + 32,
      )
    )
      y += CARD_HEIGHT + 48;
    occupiedImagePositions.push({ x: parent.x, y });
    positions.set(node.id, { x: parent.x, y });
  }
  const previousNodes = document.nodes.filter((node) => node.sourceEpisodeId);
  for (const node of previousNodes) {
    const first = panelNodes[0];
    positions.set(node.id, {
      x: (panelPosition.get(first?.id ?? "")?.x ?? 40) - CARD_WIDTH - 80,
      y: panelPosition.get(first?.id ?? "")?.y ?? 40,
    });
  }
  const customNodes = document.nodes.filter(
    (node) =>
      !node.panelId &&
      !node.sourceEpisodeId &&
      !node.episodeLayer &&
      !["character", "location", "prop"].includes(node.kind),
  );
  const assetBottom =
    assetTop + Math.ceil(assetNodes.length / assetColumns) * (CARD_HEIGHT + 48);
  const imageBottom = imageNodes.reduce(
    (bottom, node) =>
      Math.max(bottom, (positions.get(node.id)?.y ?? 0) + CARD_HEIGHT),
    assetBottom,
  );
  const customTop = imageBottom + 80;
  customNodes.forEach((node, index) => {
    positions.set(node.id, {
      x: 40 + (index % 4) * (CARD_WIDTH + 40),
      y: customTop + Math.floor(index / 4) * (CARD_HEIGHT + 48),
    });
  });
  return {
    ...document,
    layoutMode: "episode",
    branchGroups: [],
    nodes: document.nodes.map((node) => ({
      ...node,
      ...(positions.get(node.id) ?? {}),
    })),
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
