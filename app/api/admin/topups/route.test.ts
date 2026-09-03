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
    paymentOrder: {
      aggregate: mocks.aggregate,
      findMany: mocks.findMany,
    },
  },
}));

import { AdminRequiredError } from "@/lib/server/auth";
import { GET } from "./route";

describe("admin topups route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  it("rejects non-administrators before reading payment orders", async () => {
    mocks.requireAdmin.mockRejectedValue(new AdminRequiredError());

    const response = await GET(
      new Request("http://localhost/api/admin/topups"),
    );

    expect(response.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("rejects unknown order statuses", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/topups?status=unknown"),
    );

    expect(response.status).toBe(400);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("serializes orders and only totals paid matches", async () => {
    const createdAt = new Date("2026-09-03T01:00:00.000Z");
    const updatedAt = new Date("2026-09-03T02:00:00.000Z");
    const paidAt = new Date("2026-09-03T01:30:00.000Z");
    mocks.findMany.mockResolvedValue([
      {
        id: "order-1",
        tradeNo: "CY202609030001",
        providerTradeNo: "EPAY-1",
        provider: "epay",
        paymentMethod: "alipay",
        amount: new Prisma.Decimal("10.000000"),
        creditAmount: new Prisma.Decimal("20.000000"),
        status: "paid",
        expiresAt: null,
        paidAt,
        createdAt,
        updatedAt,
        user: { id: "user-1", displayName: "User", email: "u@example.com" },
      },
    ]);
    mocks.aggregate
      .mockResolvedValueOnce({ _count: 2 })
      .mockResolvedValueOnce({
        _sum: {
          amount: new Prisma.Decimal("10.000000"),
          creditAmount: new Prisma.Decimal("20.000000"),
        },
      });

    const response = await GET(
      new Request("http://localhost/api/admin/topups?query=CY2026"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.aggregate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ status: "paid" }),
      }),
    );
    expect(payload.orders[0]).toMatchObject({
      amount: "10",
      creditAmount: "20",
      paidAt: paidAt.toISOString(),
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });
    expect(payload.summary).toEqual({
      count: 2,
      amount: "10",
      creditAmount: "20",
    });
  });
});
