import type { CanvasDocument } from "./types";

function content(document: CanvasDocument) {
  return JSON.stringify({
    nodes: document.nodes
      .map(({ x, y, ...node }) => node)
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...document.edges].sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export function mergeCanvasPresentation(
  base: CanvasDocument,
  local: CanvasDocument,
  remote: CanvasDocument,
): CanvasDocument | undefined {
  if (local === base) return remote;
  if (content(base) !== content(local)) return;
  const baseNodes = new Map(base.nodes.map((node) => [node.id, node]));
  const localNodes = new Map(local.nodes.map((node) => [node.id, node]));
  const sameTopology =
    JSON.stringify(base.nodes.map((node) => node.id).sort()) ===
      JSON.stringify(remote.nodes.map((node) => node.id).sort()) &&
    JSON.stringify(base.edges) === JSON.stringify(remote.edges);
  return {
    ...remote,
    nodes: remote.nodes.map((node) => {
      const original = baseNodes.get(node.id);
      const moved = localNodes.get(node.id);
      return original &&
        moved &&
        (moved.x !== original.x || moved.y !== original.y)
        ? { ...node, x: moved.x, y: moved.y }
        : node;
    }),
    viewport:
      JSON.stringify(local.viewport) !== JSON.stringify(base.viewport)
        ? local.viewport
        : remote.viewport,
    ...(sameTopology && local.layoutMode !== base.layoutMode
      ? { layoutMode: local.layoutMode }
      : {}),
    ...(sameTopology &&
    JSON.stringify(local.branchGroups) !== JSON.stringify(base.branchGroups)
      ? { branchGroups: local.branchGroups }
      : {}),
  };
}
