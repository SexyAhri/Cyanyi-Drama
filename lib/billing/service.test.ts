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

  it("settles measured fractional minutes and releases the unused reservation", async () => {
    mocks.balanceFreeze.findFirst.mockResolvedValue({ id: "f", status: "pending", requestId: "r", amount: new Prisma.Decimal(5), metadata: JSON.stringify({ meteredDuration: true, components: [{ unit: "minute", unitPrice: "0.3", quantity: 1 / 60 }] }) });
    mocks.balanceFreeze.updateMany.mockResolvedValue({ count: 1 });
    mocks.mediaTask.findFirst.mockResolvedValue({ id: "t", projectId: "p", kind: "audio", model: "audio", retryCount: 0, payload: { request: { input: "你好" } } });
    mocks.userBalance.update.mockResolvedValue({ balance: new Prisma.Decimal("4.925") });
    await settleMediaTaskCharge("u", "t", true, 15);
    const debit = mocks.userBalance.update.mock.calls[0][0].data;
    expect(debit.balance.decrement.toString()).toBe("0.075");
    expect(debit.frozenAmount.decrement.toString()).toBe("5");
    expect(mocks.usageCost.upsert.mock.calls[0][0].create).toMatchObject({ quantity: 0.25, unit: "minute" });
  });

  it("charges generated output even when later delivery fails", async () => {
    mocks.balanceFreeze.findFirst.mockResolvedValue({ id: "f", status: "pending", amount: new Prisma.Decimal(1), metadata: JSON.stringify({ components: [{ unit: "image", quantity: 1 }] }) });
    mocks.balanceFreeze.updateMany.mockResolvedValue({ count: 1 });
    mocks.mediaTask.findFirst.mockResolvedValue({ id: "t", projectId: null, kind: "image", model: "image", payload: { providerOutput: [{ id: "a", kind: "image", url: "fixture" }] } });
    mocks.userBalance.update.mockResolvedValue({ balance: new Prisma.Decimal(9) });
    await settleMediaTaskCharge("u", "t", false);
    expect(mocks.balanceTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "charge" }) }));
    expect(mocks.usageCost.upsert.mock.calls[0][0].create).toMatchObject({ projectId: null, quantity: 1, unit: "image" });
  });
});
