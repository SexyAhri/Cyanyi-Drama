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
  createDependencyHash,
  createProductionDeliverable,
  transitionProductionDeliverable,
} from "./deliverables";

beforeEach(() => {
  vi.clearAllMocks();
  projectFindFirst.mockResolvedValue({ id: "project-1" });
  deliverableFindMany.mockResolvedValue([]);
  deliverableUpdate.mockResolvedValue({});
  deliverableUpdateMany.mockResolvedValue({ count: 1 });
});

describe("production deliverable persistence", () => {
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
});
