import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEpayConfig: vi.fn(),
  transaction: vi.fn(),
  paymentFindUnique: vi.fn(),
  paymentUpdateMany: vi.fn(),
  balanceUpsert: vi.fn(),
  balanceUpdate: vi.fn(),
  transactionCreate: vi.fn(),
}));

vi.mock("@/lib/server/system-settings", () => ({
  getEpayConfig: mocks.getEpayConfig,
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

import {
  settleEpayNotification,
  signEpayParameters,
  verifyEpaySignature,
} from "./epay";

describe("Epay integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEpayConfig.mockResolvedValue({
      merchantId: "1001",
      merchantKey: "merchant-secret",
    });
    mocks.transaction.mockImplementation((callback) =>
      callback({
        paymentOrder: {
          findUnique: mocks.paymentFindUnique,
          updateMany: mocks.paymentUpdateMany,
        },
        userBalance: {
          upsert: mocks.balanceUpsert,
          update: mocks.balanceUpdate,
        },
        balanceTransaction: { create: mocks.transactionCreate },
      }),
    );
  });

  it("signs sorted non-empty fields and rejects tampering", () => {
    const parameters = {
      money: "10.00",
      out_trade_no: "ORDER-1",
      pid: "1001",
      sign_type: "MD5",
      empty: "",
    };
    const expected = createHash("md5")
      .update(
        "money=10.00&out_trade_no=ORDER-1&pid=1001merchant-secret",
        "utf8",
      )
      .digest("hex");

    expect(signEpayParameters(parameters, "merchant-secret")).toBe(expected);
    expect(
      verifyEpaySignature({ ...parameters, sign: expected }, "merchant-secret"),
    ).toBe(true);
    expect(
      verifyEpaySignature(
        { ...parameters, money: "100.00", sign: expected },
        "merchant-secret",
      ),
    ).toBe(false);
  });

  it("credits one payment only once across repeated notifications", async () => {
    let status = "pending";
    const order = {
      id: "order-id",
      userId: "user-1",
      tradeNo: "ORDER-1",
      provider: "epay",
      paymentMethod: "alipay",
      amount: new Prisma.Decimal("10"),
      creditAmount: new Prisma.Decimal("20"),
      get status() {
        return status;
      },
    };
    mocks.paymentFindUnique.mockImplementation(() => Promise.resolve(order));
    mocks.paymentUpdateMany.mockImplementation(() => {
      status = "paid";
      return Promise.resolve({ count: 1 });
    });
    mocks.balanceUpsert.mockResolvedValue({ id: "balance-1" });
    mocks.balanceUpdate.mockResolvedValue({ balance: new Prisma.Decimal("20") });
    mocks.transactionCreate.mockResolvedValue({ id: "transaction-1" });
    const parameters = {
      pid: "1001",
      type: "alipay",
      out_trade_no: "ORDER-1",
      trade_no: "UPSTREAM-1",
      trade_status: "TRADE_SUCCESS",
      money: "10.00",
      sign_type: "MD5",
    };
    const signed = {
      ...parameters,
      sign: signEpayParameters(parameters, "merchant-secret"),
    };

    await expect(settleEpayNotification(signed)).resolves.toEqual({
      settled: true,
      duplicate: false,
    });
    await expect(settleEpayNotification(signed)).resolves.toEqual({
      settled: false,
      duplicate: true,
    });
    expect(mocks.balanceUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.transactionCreate).toHaveBeenCalledTimes(1);
  });
});
