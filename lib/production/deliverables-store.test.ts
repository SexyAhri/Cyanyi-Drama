import { beforeEach, describe, expect, it, vi } from "vitest";

const projectFindFirst = vi.hoisted(() => vi.fn());
const dependencyFindMany = vi.hoisted(() => vi.fn());
const deliverableFindMany = vi.hoisted(() => vi.fn());
const deliverableFindFirst = vi.hoisted(() => vi.fn());
const deliverableCreate = vi.hoisted(() => vi.fn());
const deliverableUpdate = vi.hoisted(() => vi.fn());
const deliverableUpdateMany = vi.hoisted(() => vi.fn());
const gateUpdateMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/prisma", () => {
  const transactionClient = {
    productionDeliverable: {
      create: deliverableCreate,
      findFirst: deliverableFindFirst,
      findMany: deliverableFindMany,
      findUniqueOrThrow: vi.fn(),
      update: deliverableUpdate,
      updateMany: deliverableUpdateMany,
    },
    productionDeliverableDependency: { findMany: dependencyFindMany },
    productionApprovalGate: {
      count: vi.fn(),
      update: vi.fn(),
      updateMany: gateUpdateMany,
    },
  };
  return {
    prisma: {
      project: { count: vi.fn(), findFirst: projectFindFirst },
      episode: { count: vi.fn() },
      productionDeliverable: { findMany: deliverableFindMany },
      $transaction: async (
        callback: (client: typeof transactionClient) => Promise<unknown>,
      ) => callback(transactionClient),
    },
  };
});

import {
  approveProductionDeliverablesBatch,
  createDependencyHash,
  createProductionDeliverable,
  transitionProductionDeliverable,
} from "./deliverables";

beforeEach(() => {
  vi.clearAllMocks();
  projectFindFirst.mockResolvedValue({ id: "project-1" });
  deliverableFindMany.mockResolvedValue([]);
  dependencyFindMany.mockResolvedValue([]);
  deliverableUpdate.mockResolvedValue({});
  deliverableUpdateMany.mockResolvedValue({ count: 1 });
});

describe("production deliverable persistence", () => {
  it("approves every pending gate in one atomic batch", async () => {
    deliverableFindMany
      .mockResolvedValueOnce([
        {
          id: "art-v1",
          status: "review",
          approvalGates: [{ status: "pending" }],
          dependencies: [],
        },
        {
          id: "post-v1",
          status: "review",
          approvalGates: [{ status: "pending" }],
          dependencies: [],
        },
      ])
      .mockResolvedValueOnce([]);
    deliverableUpdateMany.mockResolvedValueOnce({ count: 2 });

    await approveProductionDeliverablesBatch("user-1", "project-1", [
      "art-v1",
      "post-v1",
    ]);

    expect(gateUpdateMany).toHaveBeenCalledWith({
      where: {
        deliverableId: { in: ["art-v1", "post-v1"] },
        status: "pending",
      },
      data: expect.objectContaining({
        status: "approved",
        decidedByUserId: "user-1",
      }),
    });
    expect(deliverableUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["art-v1", "post-v1"] },
        projectId: "project-1",
        userId: "user-1",
        status: "review",
      },
      data: expect.objectContaining({ status: "approved" }),
    });
  });

  it("rejects a batch when a deliverable changes during approval", async () => {
    deliverableFindMany.mockResolvedValueOnce([
      {
        id: "art-v1",
        status: "review",
        approvalGates: [{ status: "pending" }],
        dependencies: [],
      },
    ]);
    deliverableUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      approveProductionDeliverablesBatch("user-1", "project-1", ["art-v1"]),
    ).rejects.toMatchObject({
      message: "PRODUCTION_BATCH_CONFLICT",
      status: 409,
    });
  });

  it("marks every downstream level stale when creating an upstream version", async () => {
    deliverableFindFirst.mockResolvedValue({ id: "bible-v2", version: 2 });
    dependencyFindMany
      .mockResolvedValueOnce([{ deliverableId: "previs-v1" }])
      .mockResolvedValueOnce([{ deliverableId: "shot-v1" }])
      .mockResolvedValueOnce([]);
    deliverableCreate.mockImplementation(async ({ data }) => ({
      ...data,
      episodeId: null,
      sourceRefs: null,
      promptTrace: null,
      approvedByUserId: null,
      submittedAt: null,
      approvedAt: null,
      lockedAt: null,
      supersededAt: null,
      approvalGates: [],
      dependencies: [],
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
      updatedAt: new Date("2026-08-27T00:00:00.000Z"),
    }));

    const result = await createProductionDeliverable("user-1", "project-1", {
      department: "development",
      deliverableType: "production_bible",
      title: "Production Bible",
      scopeType: "project",
      scopeId: "project-1",
      payload: { premise: "A story" },
    });

    expect(deliverableUpdate).toHaveBeenCalledWith({
      where: { id: "bible-v2" },
      data: expect.objectContaining({ status: "superseded" }),
    });
    expect(deliverableUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { id: { in: ["previs-v1"] }, status: { not: "superseded" } },
      data: expect.objectContaining({ status: "stale" }),
    });
    expect(deliverableUpdateMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ["shot-v1"] }, status: { not: "superseded" } },
      data: expect.objectContaining({ status: "stale" }),
    });
    expect(result.version).toBe(3);
    expect(result.dependencyHash).toBe(createDependencyHash([]));
  });

  it("blocks review while an upstream dependency is not approved", async () => {
    deliverableFindFirst.mockResolvedValue({
      id: "shot-v1",
      status: "draft",
      approvalGates: [],
      dependencies: [
        {
          dependsOn: {
            id: "previs-v1",
            title: "Previs",
            version: 1,
            status: "stale",
          },
        },
      ],
    });

    await expect(
      transitionProductionDeliverable(
        "user-1",
        "project-1",
        "shot-v1",
        { action: "submit" },
      ),
    ).rejects.toMatchObject({
      message: "PRODUCTION_DEPENDENCY_NOT_APPROVED",
      status: 409,
    });
    expect(gateUpdateMany).not.toHaveBeenCalled();
  });

  it("restores historical content as a new audited draft version", async () => {
    const cost = { toFixed: () => "0.000000" };
    deliverableFindFirst
      .mockResolvedValueOnce({
        id: "vfx-v1",
        userId: "user-1",
        projectId: "project-1",
        episodeId: "episode-1",
        scopeType: "storyboard_panel",
        scopeId: "panel-1",
        department: "vfx",
        deliverableType: "vfx_shot_package",
        title: "VFX 001",
        status: "superseded",
        version: 1,
        payload: { summary: "Historical treatment" },
        sourceRefs: [],
        promptTrace: null,
        cost,
        dependencyHash: "old-hash",
        approvalGates: [{ gateKey: "vfx" }, { gateKey: "technical" }],
        dependencies: [],
      })
      .mockResolvedValueOnce({
        id: "vfx-v3",
        status: "approved",
        version: 3,
      });
    deliverableCreate.mockImplementation(async ({ data }) => ({
      ...data,
      sourceRefs: data.sourceRefs ?? null,
      promptTrace: data.promptTrace ?? null,
      approvedByUserId: null,
      submittedAt: null,
      approvedAt: null,
      lockedAt: null,
      supersededAt: null,
      approvalGates: [],
      dependencies: [],
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
      updatedAt: new Date("2026-08-27T00:00:00.000Z"),
    }));

    const restored = await transitionProductionDeliverable(
      "user-1",
      "project-1",
      "vfx-v1",
      { action: "restore" },
    );

    expect(deliverableUpdate).toHaveBeenCalledWith({
      where: { id: "vfx-v3" },
      data: expect.objectContaining({ status: "superseded" }),
    });
    expect(restored).toMatchObject({
      status: "draft",
      version: 4,
      payload: { summary: "Historical treatment" },
    });
  });
});
