import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ panels: vi.fn(), panelUpdate: vi.fn(), assets: vi.fn(), assetUpdate: vi.fn(), editorUpdate: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({ prisma: {} }));

import { markAssetDependentPanelsStale, storyboardPanelUsesChangedAsset } from "./asset-dependencies";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.panels.mockResolvedValue([
    { id: "panel-a", storyboard: { episodeId: "episode-1" }, charactersJson: '["A"]', locationName: "Hall", propsJson: '["Key"]', imageAssetId: "image-a", videoAssetId: null, lipSyncAssetId: null },
    { id: "panel-b", storyboard: { episodeId: "episode-1" }, charactersJson: '["B"]', locationName: "Garden", propsJson: '["Coin"]', imageAssetId: "image-b", videoAssetId: null, lipSyncAssetId: null },
    { id: "panel-c", storyboard: { episodeId: "episode-2" }, charactersJson: '["A"]', locationName: "Hall", propsJson: '["Key"]', imageAssetId: null, videoAssetId: "video-c", lipSyncAssetId: null },
  ]);
  mocks.assets.mockResolvedValue([{ id: "image-a", metadataJson: '{"kept":true}' }]);
});

describe("referenced asset invalidation", () => {
  it("matches exact character, location and prop references", () => {
    const panel = { charactersJson: '["Alice","Bob"]', locationName: "Hall", propsJson: '["Key"]' };
    expect(storyboardPanelUsesChangedAsset(panel, { kind: "character", name: "Bob", fields: ["visual_profile"] })).toBe(true);
    expect(storyboardPanelUsesChangedAsset(panel, { kind: "character", name: "Bobby", fields: ["visual_profile"] })).toBe(false);
    expect(storyboardPanelUsesChangedAsset(panel, { kind: "location", name: "Hall", fields: ["selected_reference"] })).toBe(true);
    expect(storyboardPanelUsesChangedAsset(panel, { kind: "prop", name: "Key", fields: ["visual_profile"] })).toBe(true);
  });

  it("stales only dependent panels, their media, and their episode render", async () => {
    const db = {
      storyboardPanel: { findMany: mocks.panels, updateMany: mocks.panelUpdate },
      mediaAsset: { findMany: mocks.assets, update: mocks.assetUpdate },
      editorProject: { updateMany: mocks.editorUpdate },
    } as never;
    const result = await markAssetDependentPanelsStale(db, {
      userId: "user-1",
      projectId: "project-1",
      assets: [{ kind: "character", name: "A", fields: ["visual_profile"] }],
    });

    expect(result).toEqual({ panelIds: ["panel-a", "panel-c"], episodeIds: ["episode-1", "episode-2"] });
    expect(mocks.panelUpdate).toHaveBeenCalledWith({ where: { id: { in: ["panel-a", "panel-c"] } }, data: { status: "stale" } });
    expect(mocks.assetUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "image-a" },
      data: { metadataJson: expect.stringContaining("asset.character.A.visual_profile") },
    }));
    expect(JSON.parse(mocks.assetUpdate.mock.calls[0][0].data.metadataJson)).toMatchObject({ kept: true,
      productionConfigurationStale: { reason: "referenced_asset_changed" } });
    expect(mocks.editorUpdate).toHaveBeenCalledWith({ where: { episodeId: { in: ["episode-1", "episode-2"] } }, data: { renderStatus: "stale" } });
  });
});
