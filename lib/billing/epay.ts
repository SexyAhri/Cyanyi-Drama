import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/server/prisma";
import { getEpayConfig } from "@/lib/server/system-settings";

import { BillingError } from "./service";

const ORDER_TTL_MS = 30 * 60 * 1000;
const MAX_TOPUP_AMOUNT = new Prisma.Decimal(100_000);

export async function getTopupConfiguration() {
  try {
    const config = await getEpayConfig();
    return {
      enabled: true,
      methods: config.methods,
      minimumAmount: config.minimumAmount.toString(),
      creditRate: config.creditRate.toString(),
    };
  } catch {
    return { enabled: false, methods: [], minimumAmount: "0", creditRate: "0" };
  }
}

export async function createEpayOrder(input: {
  userId: string;
  amount: string | number;
  paymentMethod: string;
  request: Request;
}) {
  const config = await getEpayConfig();
  const amount = decimal(input.amount, "TOPUP_AMOUNT_INVALID");
  const paymentMethod = input.paymentMethod.trim().toLowerCase();
  if (amount.lt(config.minimumAmount) || amount.gt(MAX_TOPUP_AMOUNT)) {
    throw new BillingError("TOPUP_AMOUNT_OUT_OF_RANGE");
  }
  if (!config.methods.includes(paymentMethod)) {
    throw new BillingError("TOPUP_METHOD_INVALID");
  }
  const creditAmount = amount.mul(config.creditRate).toDecimalPlaces(6);
  if (creditAmount.lte(0)) throw new BillingError("TOPUP_CREDIT_INVALID");
  const tradeNo = createTradeNumber();
  const baseUrl = applicationBaseUrl(input.request);
  const order = await prisma.paymentOrder.create({
    data: {
      userId: input.userId,
      tradeNo,
      paymentMethod,
      amount,
      creditAmount,
      expiresAt: new Date(Date.now() + ORDER_TTL_MS),
    },
  });
  const parameters: Record<string, string> = {
    pid: config.merchantId,
    type: paymentMethod,
    out_trade_no: tradeNo,
    notify_url: `${baseUrl}/api/billing/topup/notify`,
    return_url: `${baseUrl}/api/billing/topup/return`,
    name: "Cyanyi Drama 账户充值",
    money: amount.toFixed(2),
    sign_type: "MD5",
  };
  parameters.sign = signEpayParameters(parameters, config.merchantKey);
  const paymentUrl = epaySubmitUrl(config.gatewayUrl);
  for (const [key, value] of Object.entries(parameters)) {
    paymentUrl.searchParams.set(key, value);
  }
  return {
    order: serializeOrder(order),
    paymentUrl: paymentUrl.toString(),
  };
}

export async function listPaymentOrders(userId: string, limit = 20) {
  const orders = await prisma.paymentOrder.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, Math.trunc(limit) || 20)),
  });
  return orders.map(serializeOrder);
}

export async function settleEpayNotification(
  parameters: Record<string, string>,
) {
  const config = await getEpayConfig({ requireEnabled: false });
  if (parameters.pid && parameters.pid !== config.merchantId) {
    throw new BillingError("EPAY_MERCHANT_MISMATCH");
  }
  if (!verifyEpaySignature(parameters, config.merchantKey)) {
    throw new BillingError("EPAY_SIGNATURE_INVALID", 403);
  }
  if (parameters.trade_status !== "TRADE_SUCCESS") {
    return { settled: false, ignored: true };
  }
  const tradeNo = parameters.out_trade_no?.trim();
  if (!tradeNo) throw new BillingError("EPAY_TRADE_NO_REQUIRED");
  const notifiedAmount = decimal(parameters.money, "EPAY_AMOUNT_INVALID");

  return prisma.$transaction(
    async (tx) => {
      const order = await tx.paymentOrder.findUnique({ where: { tradeNo } });
      if (!order || order.provider !== "epay") {
        throw new BillingError("EPAY_ORDER_NOT_FOUND", 404);
      }
      if (order.status === "paid") return { settled: false, duplicate: true };
      if (order.status !== "pending") {
        throw new BillingError("EPAY_ORDER_STATUS_INVALID");
      }
      if (!order.amount.equals(notifiedAmount)) {
        throw new BillingError("EPAY_AMOUNT_MISMATCH");
      }
      if (parameters.type && parameters.type !== order.paymentMethod) {
        throw new BillingError("EPAY_METHOD_MISMATCH");
      }
      const claimed = await tx.paymentOrder.updateMany({
        where: { id: order.id, status: "pending" },
        data: {
          status: "paid",
          paidAt: new Date(),
          providerTradeNo: parameters.trade_no?.trim() || null,
          notifyPayload: parameters,
        },
      });
      if (claimed.count !== 1) {
        const current = await tx.paymentOrder.findUnique({
          where: { id: order.id },
        });
        if (current?.status === "paid")
          return { settled: false, duplicate: true };
        throw new BillingError("EPAY_ORDER_STATUS_INVALID");
      }
      await tx.userBalance.upsert({
        where: { userId: order.userId },
        create: { userId: order.userId },
        update: {},
      });
      const balance = await tx.userBalance.update({
        where: { userId: order.userId },
        data: { balance: { increment: order.creditAmount } },
      });
      await tx.balanceTransaction.create({
        data: {
          userId: order.userId,
          type: "credit",
          amount: order.creditAmount,
          balanceAfter: balance.balance,
          description: "易支付充值到账",
          relatedId: order.tradeNo,
          idempotencyKey: `epay:${order.tradeNo}`,
          billingMeta: JSON.stringify({
            provider: "epay",
            paymentMethod: order.paymentMethod,
            paidAmount: order.amount.toString(),
          }),
        },
      });
      return { settled: true, duplicate: false };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export function signEpayParameters(
  parameters: Record<string, string>,
  merchantKey: string,
) {
  const payload = Object.entries(parameters)
    .filter(
      ([key, value]) => key !== "sign" && key !== "sign_type" && value !== "",
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("md5")
    .update(`${payload}${merchantKey}`, "utf8")
    .digest("hex");
}

export function verifyEpaySignature(
  parameters: Record<string, string>,
  merchantKey: string,
) {
  if ((parameters.sign_type || "MD5").toUpperCase() !== "MD5") return false;
  const actual = Buffer.from((parameters.sign || "").toLowerCase(), "utf8");
  const expected = Buffer.from(
    signEpayParameters(parameters, merchantKey),
    "utf8",
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function serializeOrder(order: {
  tradeNo: string;
  amount: Prisma.Decimal;
  creditAmount: Prisma.Decimal;
  paymentMethod: string;
  status: string;
  paidAt: Date | null;
  createdAt: Date;
}) {
  return {
    tradeNo: order.tradeNo,
    amount: order.amount.toString(),
    creditAmount: order.creditAmount.toString(),
    paymentMethod: order.paymentMethod,
    status: order.status,
    paidAt: order.paidAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

function createTradeNumber() {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `CD${timestamp}${randomBytes(6).toString("hex").toUpperCase()}`;
}

function decimal(value: string | number | undefined, code: string) {
  try {
    const result = new Prisma.Decimal(value ?? "");
    if (!result.isFinite() || result.lte(0)) throw new Error(code);
    return result;
  } catch {
    throw new BillingError(code);
  }
}

function epaySubmitUrl(gatewayUrl: string) {
  const normalized = gatewayUrl.replace(/\/$/, "");
  return new URL(
    /\.php$/i.test(new URL(normalized).pathname)
      ? normalized
      : `${normalized}/submit.php`,
  );
}

function applicationBaseUrl(request: Request) {
  return (
    process.env.APP_BASE_URL?.trim() || new URL(request.url).origin
  ).replace(/\/$/, "");
}
