import { beforeEach, describe, expect, it, vi } from "vitest";

const projectFindFirst = vi.hoisted(() => vi.fn());
const mediaAssetFindMany = vi.hoisted(() => vi.fn());
const mediaTaskCreate = vi.hoisted(() => vi.fn());
const mediaAssetCreate = vi.hoisted(() => vi.fn());
const assetReferenceCreate = vi.hoisted(() => vi.fn());
const storeMediaBytes = vi.hoisted(() => vi.fn());
const resolveStoredMediaUrl = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    project: { findFirst: projectFindFirst },
    episode: { findFirst: vi.fn() },
    mediaAsset: { findMany: mediaAssetFindMany },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        mediaTask: { create: mediaTaskCreate },
        mediaAsset: { create: mediaAssetCreate },
        assetReference: { create: assetReferenceCreate },
      }),
  },
}));

vi.mock("@/lib/storage", () => ({
  storeMediaBytes,
  resolveStoredMediaUrl,
}));

import {
  createUploadedProjectAsset,
  listOwnedProjectMediaAssets,
} from "./project-store";

beforeEach(() => {
  vi.clearAllMocks();
  projectFindFirst.mockResolvedValue({ id: "project-1" });
  storeMediaBytes.mockResolvedValue("projects/project-1/uploads/hash.png");
  resolveStoredMediaUrl.mockResolvedValue("https://media.test/signed.png");
  mediaAssetCreate.mockImplementation(async ({ data }) => ({
    ...data,
    createdAt: new Date(),
  }));
});

describe("project asset store", () => {
  it("persists upload ownership and provenance as an asset reference", async () => {
    const result = await createUploadedProjectAsset({
      userId: "user-1",
      projectId: "project-1",
      kind: "image",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      source: { sourceType: "upload", fileName: "reference.png" },
    });

    expect(mediaTaskCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        projectId: "project-1",
        provider: "upload",
        targetType: "project",
        targetId: "project-1",
      }),
    });
    expect(assetReferenceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "project-1",
        entityType: "project",
        entityId: "project-1",
        role: "uploaded_source",
      }),
    });
    expect(result.url).toBe("https://media.test/signed.png");
    expect(result.source.fileName).toBe("reference.png");
  });

  it("rejects a mixed list when any asset is outside the owned project", async () => {
    mediaAssetFindMany.mockResolvedValue([
      {
        id: "owned",
        kind: "image",
        url: "https://media.test/owned.png",
        storageKey: null,
        mimeType: "image/png",
        metadataJson: null,
      },
    ]);

    await expect(
      listOwnedProjectMediaAssets(
        "user-1",
        "project-1",
        ["owned", "foreign"],
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(mediaAssetFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          task: { userId: "user-1", projectId: "project-1" },
        }),
      }),
    );
  });
});
