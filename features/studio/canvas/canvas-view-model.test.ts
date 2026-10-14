import { describe, expect, it } from "vitest";
import { createMediaTask } from "@/lib/media/task-contract";
import type { ProjectAssetCatalog, ProjectMediaAsset, StudioStoryboardPanel } from "../types";
import type { CanvasCard, CanvasDocument } from "./types";
import { canvasAssetSource } from "@/lib/studio/canvas-document";
import { buildEpisodeCanvasGraph, needsEpisodeCanvasLayout } from "./canvas-layout";
import { canvasImageAvailability, canvasNodeTask, nodeCandidates, nodeMedia } from "./canvas-view-model";

const at = "2026-10-15T00:00:00.000Z";
const entity: CanvasCard = { id: "location-courtyard", entityId: "courtyard", kind: "location", title: "庭院", text: "设定", x: 0, y: 0 };
const branch: CanvasCard = { id: "legacy-random-id", kind: "image", episodeLayer: "asset_image", title: "庭院 · 图片", text: "我的编辑", x: 400, y: 0 };
const doc: CanvasDocument = { viewport: { x: 0, y: 0, k: 1 }, nodes: [entity, branch], edges: [{ id: "shared", from: entity.id, to: branch.id, purpose: "context" }] };
function asset(id: string, targetId = "candidate-1"): ProjectMediaAsset {
  return { id, kind: "image", url: `/api/media/assets/${id}/content`, mimeType: "image/png", metadata: {}, references: [], sourceTargetId: targetId, sourceTargetType: "location_image", taskStatus: "succeeded", createdAt: at };
}
function catalog(): ProjectAssetCatalog {
  return { assets: [asset("baseline"), { ...asset("newer", "candidate-2"), createdAt: "2026-10-15T01:00:00.000Z" }], characters: [], props: [], locations: [{
    id: "courtyard", projectId: "project", name: "庭院", summary: "庭院设定", selectedImageId: "candidate-1", createdAt: at, updatedAt: at,
    images: ["baseline", "newer"].map((id, index) => ({ id: `candidate-${index + 1}`, imageAssetId: id, locationId: "courtyard", imageIndex: index, description: "图", selected: false, availableSlots: [], createdAt: at, updatedAt: at })),
  }] };
}
function task(targetId: string, status: "running" | "failed" = "running", targetType = "location_image") {
  return { ...createMediaTask({ id: `task-${targetId}`, kind: "image", provider: "test", protocol: "openai-compatible", model: "test", request: {}, targetType, targetId }), status };
}

describe("canvas uses shared workflow assets", () => {
  it("legacy random image branches display the adopted project baseline", () => {
    const shared = catalog();
    expect(nodeMedia(entity, shared, [], doc)?.id).toBe("baseline");
    expect(nodeMedia(branch, shared, [], doc)?.id).toBe("baseline");
    expect(nodeCandidates(branch, shared, doc).map(item => item.id)).toEqual(["newer", "baseline"]);
    expect(branch.text).toBe("我的编辑");
  });
  it("follows a changed baseline without changing canvas revision or local edits", () => {
    const next = catalog(); next.locations[0].selectedImageId = "candidate-2";
    expect(nodeMedia(branch, next, [], doc)?.id).toBe("newer");
    expect(branch.text).toBe("我的编辑");
  });
  it("keeps explicit selections and own experiment outputs ahead of inheritance", () => {
    const shared = catalog(); shared.assets.push(asset("own", branch.id));
    expect(nodeMedia(branch, shared, [], doc)?.id).toBe("own");
    expect(nodeMedia({ ...branch, assetId: "baseline" }, shared, [], doc)?.id).toBe("baseline");
  });
  it("does not substitute another result for a deleted explicit selection", () => {
    expect(nodeMedia({ ...branch, assetId: "deleted" }, catalog(), [], doc)).toBeUndefined();
  });
  it("keeps free nodes and ambiguous entity branches independent", () => {
    expect(nodeMedia({ ...branch, episodeLayer: undefined }, catalog(), [], doc)).toBeUndefined();
    const ambiguous = { ...doc, nodes: [...doc.nodes, { ...entity, id: "other", entityId: "other" }], edges: [...doc.edges, { id: "other", from: "other", to: branch.id }] };
    expect(canvasAssetSource(branch, ambiguous)).toBeUndefined();
    expect(nodeMedia(branch, catalog(), [], ambiguous)).toBeUndefined();
  });
  it("still reads older automatic branches without a document argument", () => {
    expect(nodeMedia({ ...branch, id: "episode-asset-image-location-courtyard" }, catalog())?.id).toBe("baseline");
  });
  it("shows shared candidate task progress and failures on entities and branches", () => {
    const tasks = [task("candidate-1", "failed"), task("candidate-2")];
    expect(canvasNodeTask(entity, tasks, catalog(), doc)?.targetId).toBe("candidate-2");
    expect(canvasNodeTask(branch, [tasks[0]], catalog(), doc)?.status).toBe("failed");
    expect(canvasNodeTask(branch, [task(branch.id, "failed", "canvas_node"), ...tasks], catalog(), doc)?.targetId).toBe(branch.id);
  });
  it("distinguishes completed visual design from an actual generated image", () => {
    const shared = catalog(); shared.assets = []; shared.locations[0].images = [];
    shared.locations[0].visualProfile = { spec: { visualIdentity: "设定", shapeAndStructure: "空间", surfaceAndStyling: "材质", colorPalette: "色彩", lightingAndPresentation: "灯光", negativePrompt: "排除", signatureDetails: ["特征"], consistencyRules: ["规则"], inferenceNotes: ["依据"] } };
    expect(nodeMedia(branch, shared, [], doc)).toBeUndefined();
    expect(canvasImageAvailability(branch, shared, doc, "zh-CN")).toBe("设定已完成 · 图片未生成");
    expect(canvasImageAvailability(entity, shared, doc, "en")).toBe("Design ready · image not generated");
    (shared.locations[0].visualProfile.spec as Record<string, unknown>).shapeAndStructure = "";
    // A changed catalog is a new object, as it is in the request cache.
    expect(canvasImageAvailability(entity, { ...shared }, doc, "zh-CN")).toBe("设定待完善 · 图片未生成");
  });
  it("links legacy shot video branches to the real panel while preserving edits", () => {
    const panel = { id: "panel", panelIndex: 0, characters: [], props: [], imagePrompt: "图片", videoPrompt: "视频" } as unknown as StudioStoryboardPanel;
    const saved: CanvasDocument = { ...doc, nodes: [{ id: "shot", panelId: "panel", kind: "panel", text: "镜头编辑", title: "镜头", x: 0, y: 0 }, { id: "video", kind: "video", title: "视频", text: "独立编辑", assetId: "pinned", x: 0, y: 400 }], edges: [{ id: "manual", from: "shot", to: "video", purpose: "context" }] };
    const graph = buildEpisodeCanvasGraph(saved, [panel], catalog());
    expect(graph.nodes.find(node => node.id === "video")).toMatchObject({ panelId: "panel", episodeLayer: "shot_video", text: "独立编辑", assetId: "pinned" });
    expect(needsEpisodeCanvasLayout(saved, graph)).toBe(true);
    expect(needsEpisodeCanvasLayout({ ...saved, layoutMode: "free" }, graph)).toBe(false);
  });
  it("does not reassign another shot's video merely because it has a reference edge", () => {
    const panels = ["first", "second"].map((id, panelIndex) => ({ id, panelIndex, characters: [], props: [] })) as unknown as StudioStoryboardPanel[];
    const saved: CanvasDocument = { ...doc, nodes: [
      { id: "shot", panelId: "first", kind: "panel", title: "一", text: "", x: 0, y: 0 },
      { id: "other-video", panelId: "second", kind: "video", title: "二", text: "保留", x: 0, y: 400 },
    ], edges: [{ id: "ref", from: "shot", to: "other-video", purpose: "first_frame" }] };
    const graph = buildEpisodeCanvasGraph(saved, panels, catalog());
    expect(graph.nodes.find(node => node.id === "episode-video-first")?.panelId).toBe("first");
    expect(graph.nodes.find(node => node.id === "other-video")).toMatchObject({ panelId: "second", text: "保留" });
    expect(graph.edges.find(edge => edge.id === "ref")?.purpose).toBe("first_frame");
  });
});
