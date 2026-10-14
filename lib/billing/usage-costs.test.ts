import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), aggregate: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({ prisma: { usageCost: { findMany: mocks.findMany, aggregate: mocks.aggregate } } }));

import { listUsageCosts } from "./service";

describe("usage cost keyset pagination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([{ id: "c3" }, { id: "c2" }, { id: "c1" }]);
    mocks.aggregate.mockResolvedValue({ _sum: { cost: { toString: () => "9.5" }, quantity: 18 }, _count: { _all: 63 } });
  });

  it("uses stable descending date/id order, fetches one lookahead row and summarizes all scoped costs", async () => {
    const result = await listUsageCosts("u1", "p1", 2);
    expect(result.costs).toEqual([{ id: "c3" }, { id: "c2" }]);
    expect(result.hasMore).toBe(true);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "u1", projectId: "p1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 3,
    }));
    expect(mocks.aggregate).toHaveBeenCalledWith({ where: { userId: "u1", projectId: "p1" }, _sum: { cost: true, quantity: true }, _count: { _all: true } });
  });

  it("uses a strict tie-break cursor so equal timestamps cannot repeat records", async () => {
    const createdAt = new Date("2026-10-14T10:00:00.000Z");
    await listUsageCosts("u1", "p1", 20, { createdAt, id: "cursor-id" });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId: "u1", projectId: "p1",
        OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: "cursor-id" } }],
      },
    }));
  });
});
