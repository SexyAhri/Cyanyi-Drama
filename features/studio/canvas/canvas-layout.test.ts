import { describe, expect, it } from "vitest";
import type { StudioStoryboardPanel } from "../types";
import type { CanvasDocument } from "./types";
import { arrangeEpisodeCausalGraph, canvasEpisodeSequencePath, canvasEpisodeOutputPath, EPISODE_CANVAS_LAYOUT_VERSION, needsEpisodeCanvasLayout } from "./canvas-layout";

function document(): CanvasDocument {
  return {
    layoutMode: "episode",
    episodeLayoutVersion: EPISODE_CANVAS_LAYOUT_VERSION,
    viewport: { x: 40, y: 40, k: 0.75 },
    nodes: [
      { id: "shot", kind: "panel", panelId: "panel-1", title: "Shot 1", text: "Edited prompt", x: 900, y: 500 },
      { id: "video", kind: "video", panelId: "panel-1", episodeLayer: "shot_video", title: "Video", text: "Saved video prompt", assetId: "media-1", modelId: "selected-model", x: 1200, y: 500 },
    ],
    edges: [{ id: "shot-video", from: "shot", to: "video", purpose: "shot_video" }],
  };
}

describe("shared episode canvas layout", () => {
  it("upgrades a legacy branch layout even when its graph is already complete", () => {
    const graph = document();
    expect(needsEpisodeCanvasLayout({ ...graph, layoutMode: "branches" }, graph)).toBe(true);
    expect(needsEpisodeCanvasLayout({ ...graph, episodeLayoutVersion: 1 }, graph)).toBe(true);
  });

  it("preserves an explicitly selected free layout when graph structure changes", () => {
    const saved = { ...document(), layoutMode: "free" as const };
    const graph = document();
    graph.nodes.push({ id: "custom", kind: "text", title: "Note", text: "", x: 0, y: 0 });
    expect(needsEpisodeCanvasLayout(saved, graph)).toBe(false);
  });

  it("keeps current manual coordinates until automatic graph structure changes", () => {
    const saved = document();
    const graph = document();
    graph.nodes[0].x = 40;
    expect(needsEpisodeCanvasLayout(saved, graph)).toBe(false);
    graph.edges.push({ id: "reference", from: "video", to: "shot", purpose: "reference" });
    expect(needsEpisodeCanvasLayout(saved, graph)).toBe(true);
  });

  it("uses the same coordinates for original and adapted shots and retains media edits", () => {
    const panel = { id: "panel-1", panelIndex: 0, worldContext: {} } as StudioStoryboardPanel;
    const adapted = arrangeEpisodeCausalGraph(document(), [panel]);
    const original = arrangeEpisodeCausalGraph(document(), [{ ...panel, worldContext: { source: "story-package" } }]);
    expect(original).toEqual(adapted);
    expect(original.layoutMode).toBe("episode");
    expect(original.nodes[0].text).toBe("Edited prompt");
    expect(original.nodes[1]).toMatchObject({ assetId: "media-1", modelId: "selected-model", text: "Saved video prompt" });
    expect(original.edges).toEqual(document().edges);
  });

  it("keeps multiple video candidates below their shot without overlapping other columns", () => {
    const graph = document();
    const panels = Array.from({ length: 7 }, (_, index) => ({ id: `panel-${index + 1}`, panelIndex: index }) as StudioStoryboardPanel);
    for (const panel of panels.slice(1)) {
      graph.nodes.push({ id: panel.id, kind: "panel", panelId: panel.id, title: "Shot", text: "", x: 0, y: 0 });
    }
    for (const index of [1, 2]) {
      graph.nodes.push({ id: `candidate-${index}`, kind: "video", panelId: "panel-7", episodeLayer: "shot_video", title: "Candidate", text: "", x: 0, y: 0 });
      graph.edges.push({ id: `candidate-edge-${index}`, from: "panel-7", to: `candidate-${index}`, purpose: "shot_video" });
    }
    const arranged = arrangeEpisodeCausalGraph(graph, panels);
    const firstShot = arranged.nodes.find(node => node.id === "shot")!;
    const candidates = arranged.nodes.filter(node => node.id.startsWith("candidate-"));
    expect(Math.min(...candidates.map(node => node.y))).toBeGreaterThan(firstShot.y + 240);
    const shot = arranged.nodes.find(node => node.id === "panel-7")!;
    expect(new Set(candidates.map(node => node.x)).size).toBe(1);
    expect(candidates[0].x).toBe(shot.x);
    expect(candidates[0].y).toBeGreaterThan(shot.y + 240);
    expect(candidates[1].y - candidates[0].y).toBeGreaterThan(240);
  });

  it("keeps a long episode in reading order with distinct scene sections and nonoverlapping cards", () => {
    const panels = Array.from({ length: 24 }, (_, index) => ({ id: `panel-${index}`, panelIndex: index, sceneNumber: Math.floor(index / 4) + 1, locationName: "Courtyard" }) as StudioStoryboardPanel);
    const graph: CanvasDocument = {
      viewport: { x: 0, y: 0, k: 1 },
      nodes: panels.flatMap(panel => [
        { id: panel.id, kind: "panel" as const, panelId: panel.id, title: "Shot", text: "", x: 0, y: 0 },
        { id: `video-${panel.id}`, kind: "video" as const, panelId: panel.id, episodeLayer: "shot_video" as const, title: "Video", text: "", x: 0, y: 0 },
      ]),
      edges: panels.map(panel => ({ id: `edge-${panel.id}`, from: panel.id, to: `video-${panel.id}`, purpose: "shot_video" as const })),
    };
    const arranged = arrangeEpisodeCausalGraph(graph, panels);
    expect(arranged.branchGroups).toHaveLength(6);
    const shots = arranged.nodes.filter(node => node.kind === "panel");
    expect(new Set(shots.map(node => node.y)).size).toBe(1);
    for (let index = 1; index < shots.length; index++) expect(shots[index].x - shots[index - 1].x).toBeGreaterThan(300);
    for (const a of arranged.nodes) for (const b of arranged.nodes) {
      if (a.id === b.id) continue;
      expect(Math.abs(a.x - b.x) >= 300 || Math.abs(a.y - b.y) >= 240).toBe(true);
    }
  });

  it("routes sequence edges horizontally and additional candidates around earlier cards", () => {
    expect(canvasEpisodeSequencePath({ x: 40, y: 112 }, { x: 500, y: 112 }).path).toBe("M 340 232 H 500");
    expect(canvasEpisodeOutputPath({ x: 40, y: 112 }, { x: 40, y: 452 }).path).toBe("M 190 352 V 452");
    expect(canvasEpisodeOutputPath({ x: 40, y: 112 }, { x: 40, y: 792 }).path).toBe("M 190 352 V 388 H 396 V 756 H 190 V 792");
  });

  it("places asset categories beneath all shot outputs and numbers zero-based scenes from one", () => {
    const graph = document();
    graph.nodes.push({ id: "character", kind: "character", title: "Character", text: "", x: 0, y: 0 });
    const arranged = arrangeEpisodeCausalGraph(graph, [{ id: "panel-1", panelIndex: 0, sceneNumber: 0 } as StudioStoryboardPanel]);
    const asset = arranged.nodes.find(node => node.id === "character")!;
    const video = arranged.nodes.find(node => node.id === "video")!;
    expect(asset.y).toBeGreaterThan(video.y + 240);
    expect(arranged.branchGroups?.[0].label).toBe("场次 1");
    expect(arranged.branchGroups?.find(group => group.id === "episode-assets-character")?.label).toBe("角色资产");
  });

  it("retains the original first-use asset order and saved candidate order", () => {
    const graph = document();
    graph.nodes.push(
      { id: "later", kind: "character", title: "Later", text: "", x: 0, y: 0 },
      { id: "earlier", kind: "character", title: "Earlier", text: "", x: 0, y: 0 },
      { id: "shot-2", kind: "panel", panelId: "panel-2", title: "Shot 2", text: "", x: 0, y: 0 },
      { id: "a-candidate", kind: "video", panelId: "panel-1", title: "Second saved candidate", text: "", x: 0, y: 0 },
    );
    graph.edges.push(
      { id: "later-use", from: "later", to: "shot-2", purpose: "story_asset" },
      { id: "earlier-use", from: "earlier", to: "shot", purpose: "story_asset" },
    );
    const arranged = arrangeEpisodeCausalGraph(graph, [
      { id: "panel-1", panelIndex: 0 }, { id: "panel-2", panelIndex: 1 },
    ] as StudioStoryboardPanel[]);
    expect(arranged.nodes.find(node => node.id === "earlier")!.x).toBeLessThan(arranged.nodes.find(node => node.id === "later")!.x);
    expect(arranged.nodes.find(node => node.id === "video")!.y).toBeLessThan(arranged.nodes.find(node => node.id === "a-candidate")!.y);
  });
});
