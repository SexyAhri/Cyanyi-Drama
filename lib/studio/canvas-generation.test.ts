import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasCard, CanvasDocument } from "./canvas-document";
const mocks = vi.hoisted(() => ({ character: vi.fn(), location: vi.fn(), prop: vi.fn(), media: vi.fn(), panel: vi.fn(), owned: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({ prisma: { characterAppearance: { findFirst: mocks.character }, novelLocation: { findFirst: mocks.location }, novelProp: { findFirst: mocks.prop }, mediaAsset: { findFirst: mocks.media }, storyboardPanel: { findFirst: mocks.panel } } }));
vi.mock("@/lib/assets/project-store", () => ({ listOwnedProjectMediaAssets: mocks.owned }));
import { resolveCanvasGeneration } from "./canvas-generation";

const source: CanvasCard = { id: "entity", entityId: "location", kind: "location", title: "场景", text: "设定", x: 0, y: 0 };
const node: CanvasCard = { id: "output", kind: "image", title: "图片", text: "生成", x: 400, y: 0 };
function document(from = source): CanvasDocument { return { nodes: [from, node], edges: [{ id: "ref", from: from.id, to: node.id, purpose: "reference" }], viewport: { x: 0, y: 0, k: 1 } }; }
function resolve(doc = document()) { return resolveCanvasGeneration({ document: doc, node, kind: "image", userId: "owner", projectId: "project", episodeId: "episode" }); }

describe("canvas generation shares real project references", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.media.mockResolvedValue(null); mocks.panel.mockResolvedValue(null);
    mocks.location.mockResolvedValue({ selectedImageId: "adopted", images: [{ id: "latest", imageAssetId: "new" }, { id: "adopted", imageAssetId: "baseline" }] });
    mocks.owned.mockImplementation(async (_user, _project, ids: string[]) => ids.map(id => ({ id, url: `https://storage.test/${id}`, mimeType: "image/png" })));
  });
  it("uses the selected scene image and freezes it without mutating canvas input", async () => {
    const doc = document(); const before = JSON.stringify(doc); const result = await resolve(doc);
    expect(result.references).toEqual([{ assetId: "baseline", role: "reference_image" }]);
    expect(result.inputs[0].source.assetId).toBe("baseline");
    expect(JSON.stringify(doc)).toBe(before);
    expect(mocks.location).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "location", projectId: "project", project: { userId: "owner" } } }));
    expect(mocks.owned).toHaveBeenCalledWith("owner", "project", ["baseline"], ["image"]);
    mocks.location.mockResolvedValue({ selectedImageId: "latest", images: [{ id: "latest", imageAssetId: "new" }] });
    expect((await resolve(doc)).references[0].assetId).toBe("new");
    expect(result.references[0].assetId).toBe("baseline");
  });
  it("respects explicitly pinned image versions", async () => {
    expect((await resolve(document({ ...source, assetId: "pinned" }))).references[0].assetId).toBe("pinned");
    expect(mocks.location).not.toHaveBeenCalled();
  });
  it("resolves legacy image branches through their unique entity parent", async () => {
    const image: CanvasCard = { ...node, id: "random-branch", episodeLayer: "asset_image" };
    const doc = document(image); doc.nodes.push(source); doc.edges.push({ id: "entity-link", from: source.id, to: image.id, purpose: "context" });
    expect((await resolve(doc)).references[0].assetId).toBe("baseline");
    mocks.media.mockResolvedValue({ id: "own-output" });
    expect((await resolve(doc)).references[0].assetId).toBe("own-output");
    expect(mocks.media).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ task: expect.objectContaining({ userId: "owner", projectId: "project", episodeId: "episode", targetId: image.id, status: "succeeded" }) }) }));
  });
  it("supports character and prop selected references", async () => {
    mocks.character.mockResolvedValue({ imageAssetId: "character-baseline" });
    expect((await resolve(document({ ...source, kind: "character" }))).references[0].assetId).toBe("character-baseline");
    mocks.prop.mockResolvedValue({ id: "location" }); mocks.media.mockResolvedValue({ id: "prop-baseline" });
    expect((await resolve(document({ ...source, kind: "prop" }))).references[0].assetId).toBe("prop-baseline");
  });
  it("rejects entities without media and inaccessible references", async () => {
    mocks.location.mockResolvedValue(null);
    await expect(resolve()).rejects.toThrow("还没有可用图片");
    expect(mocks.owned).not.toHaveBeenCalled();
    mocks.owned.mockRejectedValue(new Error("资产不存在或不属于当前项目"));
    await expect(resolve(document({ ...source, assetId: "foreign" }))).rejects.toThrow("不属于当前项目");
  });
  it("keeps story links separate from provider references", async () => {
    const doc = document(); doc.edges[0].purpose = "story_asset";
    expect((await resolve(doc)).references).toEqual([]);
    expect(mocks.location).not.toHaveBeenCalled();
  });
  it("keeps image/video connection restrictions after reference resolution", async () => {
    const doc = document(); doc.edges[0].purpose = "first_frame";
    await expect(resolve(doc)).rejects.toThrow("图片生成不能使用视频首尾帧");
  });
});
