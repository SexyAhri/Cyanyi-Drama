import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  mediaAssetCount: vi.fn(),
  mediaAssetDelete: vi.fn(),
  mediaAssetFindFirst: vi.fn(),
  characterAppearanceUpdateMany: vi.fn(),
  locationImageFindMany: vi.fn(),
  locationImageUpdateMany: vi.fn(),
  mediaHashDeleteMany: vi.fn(),
  mediaTaskUpdate: vi.fn(),
  novelLocationUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/storage", () => ({
  deleteObject: mocks.deleteObject,
}));

import { deleteMediaAsset } from "./asset-actions";

describe("media asset actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        mediaAsset: {
          count: mocks.mediaAssetCount,
          delete: mocks.mediaAssetDelete,
          findFirst: mocks.mediaAssetFindFirst,
        },
        characterAppearance: {
          updateMany: mocks.characterAppearanceUpdateMany,
        },
        locationImage: {
          findMany: mocks.locationImageFindMany,
          updateMany: mocks.locationImageUpdateMany,
        },
        mediaHash: { deleteMany: mocks.mediaHashDeleteMany },
        mediaTask: { update: mocks.mediaTaskUpdate },
        novelLocation: { updateMany: mocks.novelLocationUpdateMany },
      }),
    );
    mocks.mediaAssetCount.mockResolvedValue(0);
    mocks.locationImageFindMany.mockResolvedValue([]);
    mocks.deleteObject.mockResolvedValue(undefined);
    mocks.mediaAssetFindFirst.mockResolvedValue({
      id: "asset-1",
      storageKey: "projects/project-1/media/image/asset-1.png",
      taskId: "task-1",
      task: {
        payload: {
          request: { prompt: "frame" },
          output: [
            { id: "asset-1", kind: "image" },
            { id: "asset-2", kind: "image" },
          ],
        },
      },
    });
  });

  it("removes the asset from both persistence and its task output", async () => {
    await deleteMediaAsset({ assetId: "asset-1", userId: "user-1" });

    expect(mocks.mediaAssetFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "asset-1", task: { userId: "user-1" } },
      }),
    );
    expect(mocks.mediaTaskUpdate).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        payload: {
          request: { prompt: "frame" },
          output: [{ id: "asset-2", kind: "image" }],
        },
      },
    });
    expect(mocks.mediaAssetDelete).toHaveBeenCalledWith({
      where: { id: "asset-1" },
    });
    expect(mocks.characterAppearanceUpdateMany).toHaveBeenCalledWith({
      where: { imageAssetId: "asset-1" },
      data: { imageAssetId: null, selected: false },
    });
    expect(mocks.locationImageUpdateMany).toHaveBeenCalledWith({
      where: { imageAssetId: "asset-1" },
      data: { imageAssetId: null, selected: false },
    });
    expect(mocks.mediaHashDeleteMany).toHaveBeenCalledWith({
      where: { storageKey: "projects/project-1/media/image/asset-1.png" },
    });
    expect(mocks.deleteObject).toHaveBeenCalledWith(
      "projects/project-1/media/image/asset-1.png",
    );
  });

  it("keeps shared stored objects while another asset still uses them", async () => {
    mocks.mediaAssetCount.mockResolvedValue(1);

    await deleteMediaAsset({ assetId: "asset-1", userId: "user-1" });

    expect(mocks.mediaHashDeleteMany).not.toHaveBeenCalled();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });

  it("clears a location baseline that pointed at the deleted media", async () => {
    mocks.locationImageFindMany.mockResolvedValue([
      { id: "location-image-1" },
    ]);

    await deleteMediaAsset({ assetId: "asset-1", userId: "user-1" });

    expect(mocks.novelLocationUpdateMany).toHaveBeenCalledWith({
      where: { selectedImageId: { in: ["location-image-1"] } },
      data: { selectedImageId: null },
    });
  });

  it("does not reveal or delete assets owned by another user", async () => {
    mocks.mediaAssetFindFirst.mockResolvedValue(null);

    await expect(
      deleteMediaAsset({ assetId: "asset-1", userId: "user-1" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.mediaAssetDelete).not.toHaveBeenCalled();
    expect(mocks.deleteObject).not.toHaveBeenCalled();
  });
});
