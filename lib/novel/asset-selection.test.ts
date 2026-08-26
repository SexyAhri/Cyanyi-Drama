import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaAssetFindFirst = vi.hoisted(() => vi.fn());
const assetReferenceDeleteMany = vi.hoisted(() => vi.fn());
const assetReferenceCreate = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    mediaAsset: { findFirst: mediaAssetFindFirst },
    $transaction: transaction,
  },
}));

import { selectProjectAsset } from "./asset-selection";

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        assetReference: {
          create: assetReferenceCreate,
          deleteMany: assetReferenceDeleteMany,
        },
      }),
  );
});

describe("project asset selection", () => {
  it("replaces the selected prop baseline within the owned project", async () => {
    mediaAssetFindFirst.mockResolvedValue({ id: "asset-1" });

    const result = await selectProjectAsset({
      userId: "user-1",
      projectId: "project-1",
      targetType: "prop",
      targetId: "prop-1",
      assetId: "asset-1",
    });

    expect(mediaAssetFindFirst).toHaveBeenCalledWith({
      where: {
        id: "asset-1",
        kind: "image",
        task: { userId: "user-1", projectId: "project-1" },
        references: {
          some: {
            projectId: "project-1",
            entityType: "prop",
            entityId: "prop-1",
          },
        },
      },
      select: { id: true },
    });
    expect(assetReferenceDeleteMany).toHaveBeenCalledWith({
      where: {
        projectId: "project-1",
        entityType: "prop",
        entityId: "prop-1",
        role: "selected",
      },
    });
    expect(assetReferenceCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "asset-1_prop-1_prop_selected",
        mediaAssetId: "asset-1",
        entityId: "prop-1",
        role: "selected",
      }),
    });
    expect(result).toEqual({
      entityType: "prop",
      entityId: "prop-1",
      assetId: "asset-1",
    });
  });

  it("does not mutate selection when the asset is not owned by the target", async () => {
    mediaAssetFindFirst.mockResolvedValue(null);

    await expect(
      selectProjectAsset({
        userId: "user-1",
        projectId: "project-1",
        targetType: "prop",
        targetId: "prop-1",
        assetId: "foreign-asset",
      }),
    ).resolves.toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });
});
