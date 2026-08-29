import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  balanceFreeze: { findFirst: vi.fn(), updateMany: vi.fn() },
  balanceTransaction: { findFirst: vi.fn(), create: vi.fn() },
  mediaTask: { findFirst: vi.fn() },
  userBalance: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  usageCost: { upsert: vi.fn() },
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { $transaction: mocks.transaction, userBalance: mocks.userBalance },
}));

import {
  classifyPendingMediaCharge,
  getUserBalance,
  quantityForBillingUnit,
  settleMediaTaskCharge,
} from "./service";

describe("billing reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((callback) => callback({
      balanceFreeze: mocks.balanceFreeze,
      balanceTransaction: mocks.balanceTransaction,
      mediaTask: mocks.mediaTask,
      userBalance: mocks.userBalance,
      usageCost: mocks.usageCost,
    }));
  });

  it("classifies only terminal tasks and expired orphans", () => {
    const now = new Date("2026-08-26T00:00:00.000Z");
    expect(classifyPendingMediaCharge({ taskStatus: "succeeded", now })).toBe("settle");
    expect(classifyPendingMediaCharge({ taskStatus: "failed", now })).toBe("release");
    expect(classifyPendingMediaCharge({ taskStatus: "running", now })).toBe("skip");
    expect(
      classifyPendingMediaCharge({
        expiresAt: new Date("2026-08-25T00:00:00.000Z"),
        now,
      }),
    ).toBe("release");
  });

  it("bills image units by the requested output count", () => {
    expect(quantityForBillingUnit("image", { count: 4 })).toBe(4);
    expect(quantityForBillingUnit("image", { n: "3" })).toBe(3);
    expect(quantityForBillingUnit("image", { count: 0 })).toBe(1);
    expect(quantityForBillingUnit("request", { count: 4 })).toBe(1);
  });

  it("reads the balance created by a concurrent first request", async () => {
    const balance = {
      balance: new Prisma.Decimal("10"),
      frozenAmount: new Prisma.Decimal("1.25"),
      totalSpent: new Prisma.Decimal("2"),
    };
    mocks.userBalance.upsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        clientVersion: "6.19.2",
        code: "P2002",
      }),
    );
    mocks.userBalance.findUnique.mockResolvedValue(balance);

    await expect(getUserBalance("user-1")).resolves.toEqual({
      available: "8.75",
      balance: "10",
      frozenAmount: "1.25",
      totalSpent: "2",
    });
    expect(mocks.userBalance.findUnique).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
  });

  it("settles a successful task once across repeated calls", async () => {
    let status = "pending";
    const transaction = { id: "transaction-1" };
    mocks.balanceFreeze.findFirst.mockImplementation(() =>
      Promise.resolve({
        id: "freeze-1",
        userId: "user-1",
        taskId: "task-1",
        status,
        amount: new Prisma.Decimal("1.25"),
        metadata: "{}",
        createdAt: new Date(),
      }),
    );
    mocks.balanceTransaction.findFirst.mockImplementation(() =>
      Promise.resolve(status === "pending" ? null : transaction),
    );
    mocks.balanceFreeze.updateMany.mockImplementation(() => {
      status = "settled";
      return Promise.resolve({ count: 1 });
    });
    mocks.mediaTask.findFirst.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      episodeId: "episode-1",
      kind: "image",
      model: "model-1",
      targetType: "character",
    });
    mocks.userBalance.update.mockResolvedValue({ balance: new Prisma.Decimal("8.75") });
    mocks.balanceTransaction.create.mockResolvedValue(transaction);
    mocks.usageCost.upsert.mockResolvedValue({ id: "cost-1" });

    await expect(settleMediaTaskCharge("user-1", "task-1", true)).resolves.toBe(
      transaction,
    );
    await expect(settleMediaTaskCharge("user-1", "task-1", true)).resolves.toBe(
      transaction,
    );
    expect(mocks.userBalance.update).toHaveBeenCalledTimes(1);
    expect(mocks.balanceTransaction.create).toHaveBeenCalledTimes(1);
    expect(mocks.usageCost.upsert).toHaveBeenCalledTimes(1);
  });
});
