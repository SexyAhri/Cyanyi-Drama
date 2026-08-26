import { Prisma } from "@prisma/client";

import type { MediaTask } from "@/lib/media/task-contract";
import { prisma } from "@/lib/server/prisma";

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function getUserBalance(userId: string) {
  const balance = await prisma.userBalance.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  return toBalance(balance);
}

export async function creditUserBalance(input: {
  userId: string;
  amount: number | string;
  description?: string;
  idempotencyKey: string;
}) {
  const amount = decimalAmount(input.amount);
  if (amount.lte(0)) throw new BillingError("BILLING_CREDIT_AMOUNT_INVALID");
  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.balanceTransaction.findFirst({
        where: {
          userId: input.userId,
          type: "credit",
          idempotencyKey: input.idempotencyKey,
        },
      });
      if (existing) return existing;
      await tx.userBalance.upsert({
        where: { userId: input.userId },
        create: { userId: input.userId },
        update: {},
      });
      const balance = await tx.userBalance.update({
        where: { userId: input.userId },
        data: { balance: { increment: amount } },
      });
      return tx.balanceTransaction.create({
        data: {
          userId: input.userId,
          type: "credit",
          amount,
          balanceAfter: balance.balance,
          description: input.description?.trim() || "Manual credit",
          idempotencyKey: input.idempotencyKey,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function listBalanceTransactions(userId: string, limit = 100) {
  return prisma.balanceTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: clampLimit(limit),
  });
}

export async function listUsageCosts(
  userId: string,
  projectId?: string,
  limit = 100,
) {
  return prisma.usageCost.findMany({
    where: { userId, ...(projectId ? { projectId } : {}) },
    orderBy: { createdAt: "desc" },
    take: clampLimit(limit),
  });
}

export async function listModelPrices() {
  return prisma.modelPrice.findMany({
    orderBy: [{ provider: "asc" }, { model: "asc" }, { capability: "asc" }],
  });
}

export async function upsertModelPrice(input: {
  provider: string;
  model: string;
  capability: string;
  unit: string;
  unitPrice: number | string;
  active?: boolean;
  metadata?: Record<string, unknown>;
}) {
  const provider = required(input.provider, "BILLING_PROVIDER_REQUIRED");
  const model = required(input.model, "BILLING_MODEL_REQUIRED");
  const capability = required(input.capability, "BILLING_CAPABILITY_REQUIRED");
  const unit = required(input.unit, "BILLING_UNIT_REQUIRED");
  const unitPrice = decimalAmount(input.unitPrice);
  if (unitPrice.lt(0)) throw new BillingError("BILLING_UNIT_PRICE_INVALID");
  return prisma.modelPrice.upsert({
    where: {
      provider_model_capability_unit: { provider, model, capability, unit },
    },
    create: {
      provider,
      model,
      capability,
      unit,
      unitPrice,
      active: input.active ?? true,
      metadata: toJson(input.metadata),
    },
    update: {
      unitPrice,
      active: input.active ?? true,
      metadata: toJson(input.metadata),
    },
  });
}

export async function reserveMediaTaskCharge(userId: string, task: MediaTask) {
  const prices = await prisma.modelPrice.findMany({
    where: {
      provider: task.provider,
      model: task.model,
      capability: task.kind,
      active: true,
    },
  });
  if (!prices.length) return null;
  const components = prices
    .map((price) => {
      const quantity = quantityForUnit(price.unit, task.request);
      return {
        unit: price.unit,
        quantity,
        unitPrice: price.unitPrice.toString(),
        amount: price.unitPrice.mul(quantity),
      };
    })
    .filter((component) => component.amount.gt(0));
  const amount = components.reduce(
    (total, component) => total.add(component.amount),
    new Prisma.Decimal(0),
  );
  if (amount.lte(0)) return null;
  const idempotencyKey = `media:${task.id}`;

  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.balanceFreeze.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return existing;
      const balance = await tx.userBalance.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      if (balance.balance.sub(balance.frozenAmount).lt(amount))
        throw new BillingError("BILLING_INSUFFICIENT_BALANCE", 402);
      await tx.userBalance.update({
        where: { userId },
        data: { frozenAmount: { increment: amount } },
      });
      return tx.balanceFreeze.create({
        data: {
          userId,
          amount,
          source: "media_task",
          taskId: task.id,
          requestId: task.idempotencyKey,
          idempotencyKey,
          metadata: JSON.stringify({
            provider: task.provider,
            model: task.model,
            capability: task.kind,
            components: components.map((component) => ({
              ...component,
              amount: component.amount.toString(),
            })),
          }),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function settleMediaTaskCharge(
  userId: string,
  taskId: string,
  succeeded: boolean,
) {
  return prisma.$transaction(
    async (tx) => {
      const freeze = await tx.balanceFreeze.findFirst({
        where: { userId, taskId },
        orderBy: { createdAt: "desc" },
      });
      if (!freeze) return null;
      const transactionType = succeeded ? "charge" : "release";
      const idempotencyKey = `media:${taskId}:${transactionType}`;
      const existing = await tx.balanceTransaction.findFirst({
        where: { userId, type: transactionType, idempotencyKey },
      });
      if (freeze.status !== "pending") return existing;
      const claimed = await tx.balanceFreeze.updateMany({
        where: { id: freeze.id, status: "pending" },
        data: { status: succeeded ? "settled" : "released" },
      });
      if (!claimed.count) return existing;
      const task = await tx.mediaTask.findFirst({
        where: { id: taskId, userId },
      });
      const balance = await tx.userBalance.update({
        where: { userId },
        data: succeeded
          ? {
              balance: { decrement: freeze.amount },
              frozenAmount: { decrement: freeze.amount },
              totalSpent: { increment: freeze.amount },
            }
          : { frozenAmount: { decrement: freeze.amount } },
      });
      const transaction = await tx.balanceTransaction.create({
        data: {
          userId,
          type: transactionType,
          amount: succeeded ? freeze.amount.negated() : new Prisma.Decimal(0),
          balanceAfter: balance.balance,
          description: succeeded
            ? "Media task charge"
            : "Media task hold released",
          relatedId: taskId,
          freezeId: freeze.id,
          idempotencyKey,
          projectId: task?.projectId,
          episodeId: task?.episodeId,
          taskType: task?.kind,
          billingMeta: freeze.metadata,
        },
      });
      if (succeeded && task?.projectId) {
        const usageIdempotencyKey = `media:${taskId}:usage`;
        await tx.usageCost.upsert({
          where: { idempotencyKey: usageIdempotencyKey },
          create: {
            projectId: task.projectId,
            userId,
            apiType: task.kind,
            model: task.model,
            action: task.targetType ?? task.kind,
            quantity: 1,
            unit: "task",
            cost: freeze.amount,
            sourceType: "media_task",
            sourceId: taskId,
            idempotencyKey: usageIdempotencyKey,
            metadata: freeze.metadata,
          },
          update: {},
        });
      }
      return transaction;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export type BillingReconciliationReport = {
  inspected: number;
  settled: number;
  released: number;
  skippedActive: number;
  repairedBalances: number;
  failures: Array<{ taskId: string | null; message: string }>;
};

export function classifyPendingMediaCharge(input: {
  taskStatus?: string;
  expiresAt?: Date | null;
  now: Date;
}): "settle" | "release" | "skip" {
  if (input.taskStatus === "succeeded") return "settle";
  if (input.taskStatus === "failed" || input.taskStatus === "canceled")
    return "release";
  if (!input.taskStatus && input.expiresAt && input.expiresAt <= input.now)
    return "release";
  return "skip";
}

export async function reconcilePendingMediaCharges(input?: {
  userId?: string;
  now?: Date;
  limit?: number;
}): Promise<BillingReconciliationReport> {
  const now = input?.now ?? new Date();
  const freezes = await prisma.balanceFreeze.findMany({
    where: {
      status: "pending",
      source: "media_task",
      ...(input?.userId ? { userId: input.userId } : {}),
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(Math.max(input?.limit ?? 200, 1), 500),
  });
  const taskIds = freezes
    .map((freeze) => freeze.taskId)
    .filter((taskId): taskId is string => !!taskId);
  const tasks = taskIds.length
    ? await prisma.mediaTask.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, userId: true, status: true },
      })
    : [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const report: BillingReconciliationReport = {
    inspected: freezes.length,
    settled: 0,
    released: 0,
    skippedActive: 0,
    repairedBalances: 0,
    failures: [],
  };
  const touchedUsers = new Set<string>(input?.userId ? [input.userId] : []);

  for (const freeze of freezes) {
    const task = freeze.taskId ? taskById.get(freeze.taskId) : undefined;
    const action = classifyPendingMediaCharge({
      taskStatus: task?.status,
      expiresAt: freeze.expiresAt,
      now,
    });
    if (action === "skip") {
      report.skippedActive += 1;
      continue;
    }
    try {
      if (freeze.taskId)
        await settleMediaTaskCharge(
          freeze.userId,
          freeze.taskId,
          action === "settle",
        );
      else await releaseOrphanMediaFreeze(freeze.userId, freeze.id);
      touchedUsers.add(freeze.userId);
      if (action === "settle") report.settled += 1;
      else report.released += 1;
    } catch (error) {
      report.failures.push({
        taskId: freeze.taskId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const userId of touchedUsers) {
    try {
      if (await reconcileUserFrozenAmount(userId)) report.repairedBalances += 1;
    } catch (error) {
      report.failures.push({
        taskId: null,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return report;
}

async function releaseOrphanMediaFreeze(userId: string, freezeId: string) {
  return prisma.$transaction(
    async (tx) => {
      const freeze = await tx.balanceFreeze.findFirst({
        where: { id: freezeId, userId },
      });
      if (!freeze) return null;
      const idempotencyKey = `media-freeze:${freeze.id}:release`;
      const existing = await tx.balanceTransaction.findFirst({
        where: { userId, type: "release", idempotencyKey },
      });
      if (freeze.status !== "pending") return existing;
      const claimed = await tx.balanceFreeze.updateMany({
        where: { id: freeze.id, status: "pending" },
        data: { status: "released" },
      });
      if (!claimed.count) return existing;
      const balance = await tx.userBalance.update({
        where: { userId },
        data: { frozenAmount: { decrement: freeze.amount } },
      });
      return tx.balanceTransaction.create({
        data: {
          userId,
          type: "release",
          amount: new Prisma.Decimal(0),
          balanceAfter: balance.balance,
          description: "Orphaned media task hold released",
          relatedId: freeze.taskId ?? freeze.requestId ?? freeze.id,
          freezeId: freeze.id,
          idempotencyKey,
          billingMeta: freeze.metadata,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function reconcileUserFrozenAmount(userId: string) {
  return prisma.$transaction(
    async (tx) => {
      await tx.userBalance.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM user_balances WHERE user_id = ${userId} FOR UPDATE`,
      );
      const balance = await tx.userBalance.findUniqueOrThrow({ where: { userId } });
      const pending = await tx.balanceFreeze.aggregate({
        where: { userId, status: "pending" },
        _sum: { amount: true },
      });
      const expected = pending._sum.amount ?? new Prisma.Decimal(0);
      if (balance.frozenAmount.equals(expected)) return false;
      await tx.userBalance.update({
        where: { userId },
        data: { frozenAmount: expected },
      });
      return true;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function quantityForUnit(unit: string, request: Record<string, unknown>) {
  if (unit === "request" || unit === "image" || unit === "task") return 1;
  if (unit === "character") return textLength(request);
  if (unit === "1k_character")
    return Math.max(1, Math.ceil(textLength(request) / 1000));
  const seconds = durationSeconds(request.duration);
  if (unit === "second") return seconds;
  if (unit === "minute") return Math.max(1, seconds / 60);
  return 1;
}

function textLength(request: Record<string, unknown>) {
  const value = request.input ?? request.prompt;
  return typeof value === "string" ? Math.max(1, value.length) : 1;
}

function durationSeconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.max(1, value);
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(/s$/i, ""));
    if (Number.isFinite(parsed)) return Math.max(1, parsed);
  }
  return 5;
}

function decimalAmount(value: number | string) {
  try {
    return new Prisma.Decimal(value);
  } catch {
    throw new BillingError("BILLING_AMOUNT_INVALID");
  }
}

function required(value: string, code: string) {
  const normalized = value.trim();
  if (!normalized) throw new BillingError(code);
  return normalized;
}

function toJson(value?: Record<string, unknown>) {
  return value
    ? (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue)
    : undefined;
}

function toBalance(balance: {
  balance: Prisma.Decimal;
  frozenAmount: Prisma.Decimal;
  totalSpent: Prisma.Decimal;
}) {
  return {
    balance: balance.balance.toString(),
    frozenAmount: balance.frozenAmount.toString(),
    available: balance.balance.sub(balance.frozenAmount).toString(),
    totalSpent: balance.totalSpent.toString(),
  };
}

function clampLimit(limit: number) {
  return Math.min(
    Math.max(Number.isFinite(limit) ? Math.floor(limit) : 100, 1),
    200,
  );
}
