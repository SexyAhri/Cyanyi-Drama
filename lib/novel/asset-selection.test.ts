import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaAssetFindFirst = vi.hoisted(() => vi.fn());
const storyboardPanelFindFirst = vi.hoisted(() => vi.fn());
const storyboardPanelUpdate = vi.hoisted(() => vi.fn());
const assetReferenceDeleteMany = vi.hoisted(() => vi.fn());
const assetReferenceCreate = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    mediaAsset: { findFirst: mediaAssetFindFirst },
    storyboardPanel: { findFirst: storyboardPanelFindFirst },
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
        storyboardPanel: { update: storyboardPanelUpdate },
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

  it.each([
    ["image", "imageAssetId", "selected"],
    ["video", "videoAssetId", "selected_video"],
  ] as const)(
    "selects a storyboard %s candidate produced for the owned panel",
    async (assetKind, field, role) => {
      storyboardPanelFindFirst.mockResolvedValue({
        id: "panel-1",
        imageAssetId: null,
        videoAssetId: null,
      });
      mediaAssetFindFirst.mockResolvedValue({ id: `asset-${assetKind}` });

      const result = await selectProjectAsset({
        userId: "user-1",
        projectId: "project-1",
        targetType: "storyboard_panel",
        targetId: "panel-1",
        assetId: `asset-${assetKind}`,
        assetKind,
      });

      expect(mediaAssetFindFirst).toHaveBeenCalledWith({
        where: {
          id: `asset-${assetKind}`,
          kind: assetKind,
          task: {
            userId: "user-1",
            projectId: "project-1",
            targetType: "storyboard_panel",
            targetId: "panel-1",
          },
        },
        select: { id: true },
      });
      expect(storyboardPanelUpdate).toHaveBeenCalledWith({
        where: { id: "panel-1" },
        data: { [field]: `asset-${assetKind}` },
      });
      expect(assetReferenceDeleteMany).toHaveBeenCalledWith({
        where: {
          projectId: "project-1",
          entityType: "storyboard_panel",
          entityId: "panel-1",
          role,
        },
      });
      expect(result).toEqual({
        entityType: "storyboard_panel",
        entityId: "panel-1",
        assetId: `asset-${assetKind}`,
        assetKind,
      });
    },
  );

  it("rejects a storyboard candidate that belongs to another panel", async () => {
    storyboardPanelFindFirst.mockResolvedValue({
      id: "panel-1",
      imageAssetId: null,
      videoAssetId: null,
    });
    mediaAssetFindFirst.mockResolvedValue(null);

    await expect(
      selectProjectAsset({
        userId: "user-1",
        projectId: "project-1",
        targetType: "storyboard_panel",
        targetId: "panel-1",
        assetId: "asset-from-panel-2",
        assetKind: "image",
      }),
    ).resolves.toBeNull();
    expect(transaction).not.toHaveBeenCalled();
  });
});
