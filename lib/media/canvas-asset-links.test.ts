import { beforeEach, describe, expect, it, vi } from "vitest";
import { canvasAssetTargets, type CanvasDocument } from "@/lib/studio/canvas-document";

const mocks = vi.hoisted(() => ({ tasks: vi.fn(), existing: vi.fn(), transaction: vi.fn(), prop: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({ prisma: {
  mediaTask: { findMany: mocks.tasks }, assetReference: { findMany: mocks.existing }, $transaction: mocks.transaction,
} }));
import { frozenCanvasAssetTargets, reconcileCanvasAssetImages } from "./canvas-asset-links";

const document: CanvasDocument = {
  nodes: [
    { id: "entity", kind: "prop", entityId: "new-prop", title: "新道具", text: "新", x: 0, y: 0 },
    { id: "image", kind: "image", episodeLayer: "asset_image", title: "图片", text: "测试", x: 1, y: 0 },
  ], edges: [{ id: "binding", from: "entity", to: "image", purpose: "story_asset" }], viewport: { x: 0, y: 0, k: 1 },
};
function task(request: Record<string, unknown>, stale = false) {
  return { id: "task", targetId: "image", episodeId: "episode", payload: { request }, assets: [{ id: "asset", metadataJson: stale ? '{"productionConfigurationStale":{"fields":["source"]}}' : "{}" }] };
}
async function reconcile() { await reconcileCanvasAssetImages(document, "owner", "project", "episode", 8); }

beforeEach(() => {
  vi.resetAllMocks(); mocks.tasks.mockResolvedValue([]); mocks.existing.mockResolvedValue([]);
  mocks.prop.mockImplementation(async ({ where }) => ({ id: where.id }));
  mocks.transaction.mockImplementation(async callback => callback({ novelProp: { findFirst: mocks.prop }, assetReference: { upsert: mocks.upsert } }));
});

describe("canvas output ownership", () => {
  it("does not infer ownership from references on a free image", () => {
    const free = { ...document.nodes[1], episodeLayer: undefined };
    for (const purpose of ["reference", "context", "story_asset"] as const) {
      expect(canvasAssetTargets(free, { ...document, edges: [{ ...document.edges[0], purpose }] })).toEqual([]);
    }
    expect(canvasAssetTargets(document.nodes[1], document)).toEqual([{ entityType: "prop", entityId: "new-prop" }]);
  });
  it("distinguishes frozen no-target requests from truly legacy requests", () => {
    expect(frozenCanvasAssetTargets({})).toBeUndefined();
    expect(frozenCanvasAssetTargets({ canvasAssetTargets: [] })).toEqual([]);
    expect(frozenCanvasAssetTargets({ canvasAssetTargets: null })).toEqual([]);
  });
  it("preserves the submitted owner after rewiring and never changes selection", async () => {
    mocks.tasks.mockResolvedValue([task({ canvasAssetTargets: [{ entityType: "prop", entityId: "original-prop" }] })]);
    await reconcile();
    expect(mocks.prop).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "original-prop", projectId: "project", project: { userId: "owner" } } }));
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ entityId: "original-prop", role: "generated_candidate" }), update: {} }));
    expect(mocks.upsert.mock.calls.some(([value]) => value.create.role === "selected")).toBe(false);
  });
  it("never falls back from explicit empty or invalid ownership and skips stale outputs", async () => {
    mocks.tasks.mockResolvedValue([
      task({ canvasAssetTargets: [], canvasRevision: 8 }),
      task({ canvasAssetTargets: null, canvasRevision: 8 }),
      task({ canvasAssetTargets: [{ entityType: "prop", entityId: "original-prop" }] }, true),
    ]);
    await reconcile(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("uses legacy inference only while the exact submitted canvas is still current", async () => {
    mocks.tasks.mockResolvedValue([task({ canvasRevision: 7 }), task({})]);
    await reconcile(); expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.tasks.mockResolvedValue([task({ canvasRevision: 8 })]);
    await reconcile(); expect(mocks.prop).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "new-prop" }) }));
  });
  it("does not write the same target twice on repeated reconciliation", async () => {
    mocks.tasks.mockResolvedValue([task({ canvasAssetTargets: [{ entityType: "prop", entityId: "original-prop" }] })]);
    await reconcile();
    mocks.existing.mockResolvedValue([{ entityType: "prop", entityId: "original-prop" }]);
    await reconcile(); expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});
