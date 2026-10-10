import type { CanvasDocument } from "./types";
import { CARD_HEIGHT, CARD_WIDTH } from "./canvas-view-model";
import type { StudioLocale, StudioStoryboardPanel } from "../types";

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
