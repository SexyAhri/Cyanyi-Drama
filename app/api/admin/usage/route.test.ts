import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  findMany: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => {
  class AdminRequiredError extends Error {}
  return {
    AdminRequiredError,
    requireAdmin: mocks.requireAdmin,
  };
});

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    usageCost: {
      aggregate: mocks.aggregate,
      findMany: mocks.findMany,
    },
  },
}));

import { AdminRequiredError } from "@/lib/server/auth";
import { GET } from "./route";

describe("admin usage route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  it("rejects non-administrators before reading usage data", async () => {
    mocks.requireAdmin.mockRejectedValue(new AdminRequiredError());

    const response = await GET(
      new Request("http://localhost/api/admin/usage"),
    );

    expect(response.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("applies filters and serializes decimal and date values", async () => {
    const createdAt = new Date("2026-09-03T02:00:00.000Z");
    mocks.findMany
      .mockResolvedValueOnce([{ apiType: "video" }])
      .mockResolvedValueOnce([
        {
          id: "usage-1",
          apiType: "video",
          model: "seedance-1.5-pro",
          action: "generate-video",
          quantity: 8,
          unit: "second",
          cost: new Prisma.Decimal("1.250000"),
          createdAt,
          project: { id: "project-1", name: "Demo" },
          user: { id: "user-1", displayName: "User", email: "u@example.com" },
        },
      ]);
    mocks.aggregate.mockResolvedValue({
      _count: 1,
      _sum: { cost: new Prisma.Decimal("1.250000") },
    });

    const response = await GET(
      new Request(
        "http://localhost/api/admin/usage?query=seedance&apiType=video&limit=999",
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        take: 100,
        where: expect.objectContaining({
          apiType: "video",
          OR: expect.arrayContaining([
            { model: { contains: "seedance", mode: "insensitive" } },
          ]),
        }),
      }),
    );
    expect(payload.costs[0]).toMatchObject({
      cost: "1.25",
      createdAt: createdAt.toISOString(),
    });
    expect(payload.summary).toEqual({ count: 1, cost: "1.25" });
  });
});
