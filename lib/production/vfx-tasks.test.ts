import { beforeEach, describe, expect, it, vi } from "vitest";

const deliverableFindFirst = vi.hoisted(() => vi.fn());
const panelCount = vi.hoisted(() => vi.fn());
const createProductionTask = vi.hoisted(() => vi.fn());
const listOwnedProjectMediaAssets = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    productionDeliverable: { findFirst: deliverableFindFirst },
    storyboardPanel: { count: panelCount },
  },
}));
vi.mock("@/lib/media/production-tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/media/production-tasks")>();
  return { ...actual, createProductionTask };
});
vi.mock("@/lib/assets/project-store", () => ({
  listOwnedProjectMediaAssets,
}));

import { emptyVfxQc } from "./vfx-contract";
import { createVfxShotTask } from "./vfx-tasks";

beforeEach(() => {
  vi.clearAllMocks();
  panelCount.mockResolvedValue(1);
  createProductionTask.mockResolvedValue({ id: "task-1" });
  listOwnedProjectMediaAssets.mockResolvedValue([
    {
      id: "plate-1",
      kind: "image",
      url: "https://media.test/plate.png",
      mimeType: "image/png",
    },
  ]);
});

describe("VFX shot tasks", () => {
  it("rejects ordinary shots without an active VFX package", async () => {
    deliverableFindFirst.mockResolvedValue(null);
    await expect(createVfxShotTask(input())).rejects.toMatchObject({
      message: "VFX_SHOT_PACKAGE_NOT_FOUND",
      status: 404,
    });
    expect(createProductionTask).not.toHaveBeenCalled();
  });

  it("requires selected elements before compositing", async () => {
    deliverableFindFirst.mockResolvedValue(deliverable());
    await expect(
      createVfxShotTask({ ...input(), stage: "composite", kind: "video" }),
    ).rejects.toMatchObject({ message: "VFX_ELEMENTS_NOT_SELECTED", status: 409 });
  });

  it("queues an element task only for the validated VFX shot", async () => {
    deliverableFindFirst.mockResolvedValue(deliverable());
    await createVfxShotTask(input());
    expect(createProductionTask).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: "vfx_element",
        targetId: "panel-1",
        request: expect.objectContaining({
          deliverableId: "package-1",
          deliverableVersion: 2,
          panelId: "panel-1",
          referenceImages: [
            {
              url: "https://media.test/plate.png",
              mimeType: "image/png",
            },
          ],
        }),
      }),
    );
  });
});

function input() {
  return {
    userId: "user-1",
    projectId: "project-1",
    episodeId: "episode-1",
    deliverableId: "package-1",
    stage: "element" as const,
    kind: "image" as const,
    channelId: "channel-1",
    model: "image-model",
    prompt: "Dust element",
  };
}

function deliverable() {
  return {
    id: "package-1",
    scopeId: "panel-1",
    version: 2,
    sourceRefs: [{ type: "media_asset", id: "plate-1" }],
    payload: {
      schemaVersion: 1,
      panelId: "panel-1",
      category: "cleanup",
      complexity: "medium",
      summary: "Remove rig",
      colorSpace: "ACEScg",
      plate: { requirements: ["clean plate"], assetIds: ["plate-1"] },
      elements: { requirements: ["dust"], assetIds: [] },
      trackingRequirements: ["camera solve"],
      matteRequirements: ["subject roto"],
      compositeNotes: ["match grain"],
      qc: emptyVfxQc(),
    },
  };
}
