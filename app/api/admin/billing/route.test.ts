import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  balanceFindMany: vi.fn(),
  requireAdmin: vi.fn(),
  transactionFindMany: vi.fn(),
  userFindMany: vi.fn(),
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
    balanceTransaction: { findMany: mocks.transactionFindMany },
    user: { findMany: mocks.userFindMany },
    userBalance: { findMany: mocks.balanceFindMany },
  },
}));

import { AdminRequiredError } from "@/lib/server/auth";
import { GET } from "./route";

describe("admin billing route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  });

  it("rejects non-administrators before reading billing data", async () => {
    mocks.requireAdmin.mockRejectedValue(new AdminRequiredError());

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.balanceFindMany).not.toHaveBeenCalled();
  });

  it("serializes balance and transaction values for the client", async () => {
    const createdAt = new Date("2026-09-03T01:00:00.000Z");
    const updatedAt = new Date("2026-09-03T02:00:00.000Z");
    const user = {
      id: "user-1",
      displayName: "User",
      email: "u@example.com",
    };
    mocks.balanceFindMany.mockResolvedValue([
      {
        id: "balance-1",
        balance: new Prisma.Decimal("20.500000"),
        frozenAmount: new Prisma.Decimal("2.000000"),
        totalSpent: new Prisma.Decimal("8.250000"),
        createdAt,
        updatedAt,
        user,
      },
    ]);
    mocks.transactionFindMany.mockResolvedValue([
      {
        id: "transaction-1",
        type: "charge",
        amount: new Prisma.Decimal("1.250000"),
        balanceAfter: new Prisma.Decimal("19.250000"),
        createdAt,
        user,
      },
    ]);
    mocks.userFindMany.mockResolvedValue([user]);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.balances[0]).toMatchObject({
      balance: "20.5",
      frozenAmount: "2",
      totalSpent: "8.25",
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });
    expect(payload.transactions[0]).toMatchObject({
      amount: "1.25",
      balanceAfter: "19.25",
      createdAt: createdAt.toISOString(),
    });
  });
});
