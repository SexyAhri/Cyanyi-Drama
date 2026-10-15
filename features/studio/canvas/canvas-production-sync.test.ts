import { describe, expect, it } from "vitest";
import { canvasDocumentSchema, compileCanvasInput } from "@/lib/studio/canvas-document";
import type { ProjectAssetCatalog, ProjectMediaAsset, StudioStoryboardPanel } from "../types";
import type { CanvasDocument } from "./types";
import { buildEpisodeCanvasGraph } from "./canvas-layout";
import { canvasAssetPromptDifference, syncCanvasProduction } from "./canvas-production-sync";
import { nodeCandidates } from "./canvas-view-model";

const panels = [{ id: "one", panelIndex: 0, imagePrompt: "Image one", videoPrompt: "Video one", characters: [], props: [], locationName: "庭院" },
  { id: "two", panelIndex: 1, imagePrompt: "Image two", videoPrompt: "Video two", characters: [], props: [], locationName: "庭院" }] as unknown as StudioStoryboardPanel[];
const empty: CanvasDocument = { nodes: [], edges: [], viewport: { x: 9, y: 12, k: .8 } };
function catalog(summary = "旧庭院设定"): ProjectAssetCatalog {
  return { assets: [], characters: [], props: [], locations: [{ id: "court", projectId: "project", name: "庭院", summary, images: [], selectedImageId: null, createdAt: "2026-10-15", updatedAt: "2026-10-15" }] };
}
const branchId = "episode-asset-image-location-court";

describe("canvas production synchronization", () => {
  it("updates untouched automatic asset templates in the actual compiled input, including free layout", () => {
    const graph = buildEpisodeCanvasGraph(empty, panels, catalog());
    const baseline = graph.nodes.find(node => node.id === branchId)!;
    expect(baseline.assetPromptBase?.prompt).toBe(baseline.text);
    const document = { ...graph, layoutMode: "free" as const };
    const synced = syncCanvasProduction(document, panels, catalog("新庭院深绿色设定"));
    const next = synced.nodes.find(node => node.id === branchId)!;
    expect(next.text).toContain("新庭院深绿色设定");
    expect(compileCanvasInput(synced, next, "image").prompt).toContain("新庭院深绿色设定");
    expect(synced.viewport).toEqual(empty.viewport);
    expect(synced.nodes.map(node => [node.id, node.x, node.y])).toEqual(document.nodes.map(node => [node.id, node.x, node.y]));
    expect(syncCanvasProduction(synced, panels, catalog("新庭院深绿色设定"))).toBe(synced);
  });
  it("keeps edited prompts, pinned media and historical prompt versions and exposes the difference", () => {
    const graph = buildEpisodeCanvasGraph(empty, panels, catalog());
    const branch = graph.nodes.find(node => node.id === branchId)!;
    branch.text = "我的自定义创作"; branch.assetId = "pinned";
    branch.promptVersions = [{ id: "history", kind: "image", prompt: "历史任务提示词", createdAt: "2026-10-15" }];
    const nextCatalog = catalog("新正式设定");
    const synced = syncCanvasProduction(graph, panels, nextCatalog);
    const next = synced.nodes.find(node => node.id === branchId)!;
    expect(next).toEqual(branch);
    expect(canvasAssetPromptDifference(next, synced, nextCatalog)).toMatchObject({ officialChanged: true, previousPrompt: branch.assetPromptBase!.prompt });
    expect(canvasAssetPromptDifference(next, synced, nextCatalog)?.currentPrompt).toContain("新正式设定");
  });
  it("does not guess missing legacy baselines but can recognize an exact current template", () => {
    const graph = buildEpisodeCanvasGraph(empty, panels, catalog());
    const branch = graph.nodes.find(node => node.id === branchId)!;
    delete branch.assetPromptBase;
    const recognized = syncCanvasProduction(graph, panels, catalog());
    expect(recognized.nodes.find(node => node.id === branchId)?.assetPromptBase?.prompt).toBe(branch.text);
    branch.text = "无法确认是否手改的旧文本";
    const kept = syncCanvasProduction(graph, panels, catalog("新正式设定"));
    expect(kept.nodes.find(node => node.id === branchId)).toEqual(branch);
    expect(canvasAssetPromptDifference(branch, graph, catalog("新正式设定"))?.previousPrompt).toBeUndefined();
  });
  it("detaches every deleted shot branch while preserving adopted media, edits and reference connections", () => {
    const graph = buildEpisodeCanvasGraph(empty, panels, catalog());
    const shot = graph.nodes.find(node => node.id === "panel-two")!;
    const video = graph.nodes.find(node => node.id === "episode-video-two")!;
    shot.text = "保留的镜头草稿";
    video.videoText = "保留的视频草稿";
    graph.edges.push({ id: "keep-reference", from: shot.id, to: "panel-one", purpose: "reference" });
    const shared = catalog();
    shared.assets = [
      { id: "adopted", kind: "image", sourceTargetId: "two", taskStatus: "succeeded", url: "/adopted", createdAt: "2026-10-14", references: [] },
      { id: "latest", kind: "image", sourceTargetId: "two", taskStatus: "succeeded", url: "/latest", createdAt: "2026-10-15", references: [] },
      { id: "video", kind: "video", sourceTargetId: "two", taskStatus: "succeeded", url: "/video", createdAt: "2026-10-15", references: [] },
    ] as unknown as ProjectMediaAsset[];
    const previous = panels.map(panel => panel.id === "two" ? { ...panel, imageAssetId: "adopted", videoAssetId: "video" } : panel);
    const synced = syncCanvasProduction(graph, panels.slice(0, 1), shared, previous);
    expect(synced.nodes.find(node => node.id === shot.id)).toMatchObject({ panelId: undefined, detachedPanelId: "two", assetId: "adopted", text: "保留的镜头草稿" });
    expect(synced.nodes.find(node => node.id === video.id)).toMatchObject({ panelId: undefined, detachedPanelId: "two", assetId: "video", videoText: "保留的视频草稿" });
    expect(synced.nodes).toHaveLength(graph.nodes.length);
    expect(synced.edges.some(edge => edge.id === "keep-reference")).toBe(true);
    expect(synced.edges.some(edge => edge.purpose === "shot_video" && edge.from === shot.id)).toBe(false);
    expect(synced.nodes.every(node => !node.panelId || node.panelId === "one")).toBe(true);
    const reloaded = canvasDocumentSchema.parse(JSON.parse(JSON.stringify(synced)));
    expect(syncCanvasProduction(reloaded, panels.slice(0, 1), shared)).toBe(reloaded);
  });
  it("clears a deleted last shot even in free layout without changing pinned versions", () => {
    const graph = buildEpisodeCanvasGraph(empty, panels.slice(0, 1), catalog());
    graph.layoutMode = "free";
    graph.nodes.find(node => node.kind === "panel")!.assetId = "explicit";
    const synced = syncCanvasProduction(graph, [], catalog());
    expect(synced.nodes.every(node => !node.panelId)).toBe(true);
    expect(synced.nodes.find(node => node.kind === "panel")?.assetId).toBe("explicit");
    expect(synced.layoutMode).toBe("free");
  });
  it("preserves a recorded adopted version when reopening after deletion without an in-memory panel snapshot", () => {
    const graph = buildEpisodeCanvasGraph(empty, panels.slice(0, 1), catalog());
    const shared = catalog();
    shared.assets = [
      { id: "latest", kind: "image", sourceTargetId: "one", taskStatus: "succeeded", url: "/latest", createdAt: "2026-10-15", references: [] },
      { id: "adopted", kind: "image", sourceTargetId: "one", taskStatus: "succeeded", url: "/adopted", createdAt: "2026-10-14", references: [{ entityType: "storyboard_panel", entityId: "one", role: "selected" }] },
    ] as unknown as ProjectMediaAsset[];
    const synced = syncCanvasProduction(graph, [], shared);
    const detached = synced.nodes.find(node => node.id === "panel-one")!;
    expect(detached.assetId).toBe("adopted");
    expect(nodeCandidates(detached, shared).map(asset => asset.id)).toEqual(["latest", "adopted"]);
  });
  it("renumbers default shot/video titles and preserves custom names across reload", () => {
    const graph = buildEpisodeCanvasGraph(empty, panels, catalog());
    graph.nodes.find(node => node.id === "episode-video-one")!.title = "自定义视频名";
    const reordered = panels.map(panel => ({ ...panel, panelIndex: 1 - panel.panelIndex }));
    const synced = syncCanvasProduction(graph, reordered, catalog());
    expect(synced.nodes.find(node => node.id === "panel-one")?.title).toBe("镜头 2");
    expect(synced.nodes.find(node => node.id === "episode-video-two")?.title).toBe("镜头 1 · 视频");
    expect(synced.nodes.find(node => node.id === "episode-video-one")?.title).toBe("自定义视频名");
    const reloaded = canvasDocumentSchema.parse(JSON.parse(JSON.stringify(synced)));
    expect(syncCanvasProduction(reloaded, reordered, catalog())).toBe(reloaded);
  });
  it("updates untouched shot/video prompts while keeping their edited fields", () => {
    const graph = buildEpisodeCanvasGraph(empty, panels, catalog());
    graph.nodes.find(node => node.id === "panel-one")!.text = "手改图片";
    const changed = panels.map(panel => ({ ...panel, imagePrompt: "新的图", videoPrompt: "新的视频" }));
    const synced = syncCanvasProduction(graph, changed, catalog());
    expect(synced.nodes.find(node => node.id === "panel-one")?.text).toBe("手改图片");
    expect(synced.nodes.find(node => node.id === "panel-two")?.text).toBe("新的图");
    expect(synced.nodes.find(node => node.id === "episode-video-two")).toMatchObject({ text: "新的视频", videoText: "新的视频" });
  });
  it("preserves custom template titles when rebuilding a disconnected branch", () => {
    const graph = buildEpisodeCanvasGraph(empty, panels, catalog());
    const video = graph.nodes.find(node => node.id === "episode-video-one")!;
    const image = graph.nodes.find(node => node.id === branchId)!;
    video.title = "自定义动态候选"; image.title = "自定义场景候选";
    graph.edges = graph.edges.filter(edge => edge.to !== video.id && edge.to !== image.id);
    const rebuilt = buildEpisodeCanvasGraph(graph, panels, catalog());
    expect(rebuilt.nodes.find(node => node.id === video.id)?.title).toBe(video.title);
    expect(rebuilt.nodes.find(node => node.id === image.id)?.title).toBe(image.title);
  });
});
