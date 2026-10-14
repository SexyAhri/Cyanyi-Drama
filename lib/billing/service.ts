import { Prisma } from "@prisma/client";

import type { MediaTask, MediaAsset } from "@/lib/media/task-contract";
import { prisma } from "@/lib/server/prisma";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { assertMediaTaskWithinBudgets, getMediaBudgetSummary, MediaBudgetError } from "./media-budget";
import { billingTransaction } from "./transaction";
import { inputCharacterCount } from "./usage";
import { billingQuantity, CAPABILITY_BILLING_UNITS, priceUsage } from "./pricing";

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function getUserBalance(userId: string) {
  let balance;
  try {
    balance = await prisma.userBalance.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    )
      throw error;
    balance = await prisma.userBalance.findUnique({ where: { userId } });
    if (!balance) throw error;
  }
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
  return billingTransaction(
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
  cursor?: { createdAt: Date; id: string },
) {
  const where = {
    userId,
    ...(projectId ? { projectId } : {}),
    ...(cursor ? {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    } : {}),
  };
  const page = await prisma.usageCost.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: clampLimit(limit) + 1,
  });
  const hasMore = page.length > clampLimit(limit);
  const costs = hasMore ? page.slice(0, clampLimit(limit)) : page;
  return {
    costs,
    hasMore,
    summary: await prisma.usageCost.aggregate({
      where: { userId, ...(projectId ? { projectId } : {}) },
      _sum: { cost: true, quantity: true },
      _count: { _all: true },
    }),
  };
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
  if (!CAPABILITY_BILLING_UNITS[capability]?.includes(unit))
    throw new BillingError("该能力不支持此计费方式", 400);
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
  if (["merge_episode_audio", "render_timeline"].includes(String(task.request.operation))) return null;
  if (task.channelId) {
    const channel = await prisma.channel.findFirst({ where: accessibleChannelWhere(userId, task.channelId), select: { providerKey: true } });
    if (!channel) throw new BillingError("计费渠道不存在或无权使用", 403);
    if (channel.providerKey !== task.provider) throw new BillingError("供应商已变更，请重新创建媒体请求", 409);
  }
  const prices = await prisma.modelPrice.findMany({
    where: {
      provider: task.provider,
      model: task.model,
      capability: task.kind,
      active: true,
    },
  });
  if (!prices.length) {
    throw new BillingError(`模型 ${task.model} 尚未配置有效价格，请先配置价格`, 400);
  }
  let pricing: ReturnType<typeof priceUsage>;
  const usage = mediaBillingUsage(task.request);
  const meteredDuration = prices.some(price => ["second", "minute"].includes(price.unit));
  const unknownDuration = meteredDuration && !usage.seconds;
  try { pricing = priceUsage(prices, { ...usage, ...(unknownDuration ? { seconds: 1 } : {}) }); }
  catch { throw new BillingError("模型计费用量缺失或单位无效，请补充时长或改用按次/字符计价", 400); }
  const { components } = pricing;
  let reservationCap: Prisma.Decimal | undefined;
  if (unknownDuration && task.projectId) {
    for (const scope of [{ type: "project" as const, id: task.projectId }, ...(task.batchId ? [{ type: "batch" as const, id: task.batchId }] : [])]) {
      const budget = await getMediaBudgetSummary({ userId, projectId: task.projectId, scope });
      if (budget.remaining !== null) reservationCap = reservationCap ? Prisma.Decimal.min(reservationCap, budget.remaining) : new Prisma.Decimal(budget.remaining);
    }
  }
  const attemptKey = mediaTaskAttemptKey(task.id, task.retryCount);
  const idempotencyKey = `media:${attemptKey}`;

  return billingTransaction(
    async (tx) => {
      let existing = await tx.balanceFreeze.findUnique({
        where: { idempotencyKey },
      });
      if (!existing && task.retryCount === 0) {
        existing = await tx.balanceFreeze.findUnique({ where: { idempotencyKey: `media:${task.id}` } });
      }
      if (existing) return existing;
      await tx.userBalance.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });
      await tx.$queryRaw(Prisma.sql`SELECT id FROM user_balances WHERE user_id = ${userId} FOR UPDATE`);
      const balance = await tx.userBalance.findUniqueOrThrow({ where: { userId } });
      const available = balance.balance.sub(balance.frozenAmount);
      const amount = unknownDuration && pricing.amount.gt(0)
        ? reservationCap ? Prisma.Decimal.min(available, reservationCap) : available
        : pricing.amount;
      if (amount.lt(pricing.amount)) throw new BillingError("BILLING_INSUFFICIENT_BALANCE", 402);
      try { await assertMediaTaskWithinBudgets(tx, userId, task, amount); }
      catch (error) { throw asBillingError(error); }
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
          requestId: attemptKey,
          idempotencyKey,
          metadata: JSON.stringify({
            provider: task.provider,
            model: task.model,
            capability: task.kind,
            channelId: task.channelId,
            meteredDuration,
            retryCount: task.retryCount,
            components,
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
  durationSeconds?: number,
  imageCount?: number,
) {
  return billingTransaction(
    async (tx) => {
      const task = await tx.mediaTask.findFirst({ where: { id: taskId, userId } });
      const attemptKey = task ? mediaTaskAttemptKey(taskId, task.retryCount) : undefined;
      let freeze = attemptKey ? await tx.balanceFreeze.findFirst({ where: { userId, taskId, requestId: attemptKey } }) : null;
      if (!freeze && (!task || task.retryCount === 0)) {
        freeze = await tx.balanceFreeze.findFirst({ where: { userId, taskId }, orderBy: { createdAt: "desc" } });
      }
      if (!freeze) freeze = await tx.balanceFreeze.findFirst({ where: { userId, taskId, status: "pending" }, orderBy: { createdAt: "desc" } });
      if (!freeze) return null;
      const taskPayload = task?.payload as { providerOutput?: unknown[]; billingDurationSeconds?: number; billingImageCount?: number; request?: Record<string, unknown> } | null;
      if (taskPayload?.providerOutput?.length) {
        succeeded = true;
        durationSeconds ??= taskPayload.billingDurationSeconds;
        imageCount ??= taskPayload.billingImageCount;
      }
      const transactionType = succeeded ? "charge" : "release";
      const chargeKey = freeze.requestId ?? attemptKey ?? taskId;
      const idempotencyKey = `media:${chargeKey}:${transactionType}`;
      const existing = await tx.balanceTransaction.findFirst({
        where: { userId, type: transactionType, idempotencyKey },
      });
      if (freeze.status !== "pending") return existing;
      const billingMetadata = JSON.parse(freeze.metadata ?? "{}") as {
        meteredDuration?: boolean; components?: Array<{ unit: string; quantity: number; unitPrice: string }>;
      };
      let chargedAmount = freeze.amount;
      if (succeeded && (billingMetadata.meteredDuration || (imageCount !== undefined && billingMetadata.components?.some(component => component.unit === "image")))) {
        if (!task || (billingMetadata.meteredDuration && !durationSeconds)) throw new BillingError("媒体产物时长尚未核实，无法结算；请重试产物交付", 409);
        const payload = task.payload as { request?: Record<string, unknown> } | null;
        const actual = priceUsage(billingMetadata.components ?? [], { ...mediaBillingUsage(payload?.request ?? {}), seconds: durationSeconds, ...(imageCount !== undefined ? { images: imageCount } : {}) });
        chargedAmount = actual.amount;
        if (chargedAmount.gt(freeze.amount)) {
          await tx.$queryRaw(Prisma.sql`SELECT id FROM user_balances WHERE user_id = ${userId} FOR UPDATE`);
          const balance = await tx.userBalance.findUniqueOrThrow({ where: { userId } });
          if (balance.balance.sub(balance.frozenAmount).add(freeze.amount).lt(chargedAmount))
            throw new BillingError("媒体实际费用超过预留余额，请补充余额后继续交付", 402);
          try { await assertMediaTaskWithinBudgets(tx, userId, { ...task, request: payload?.request ?? {} } as unknown as MediaTask, chargedAmount.sub(freeze.amount)); }
          catch (error) { throw asBillingError(error); }
        }
        billingMetadata.components = actual.components;
      }
      const billingMeta = JSON.stringify(billingMetadata);
      const claimed = await tx.balanceFreeze.updateMany({
        where: { id: freeze.id, status: "pending" },
        data: { status: succeeded ? "settled" : "released" },
      });
      if (!claimed.count) return existing;
      const balance = await tx.userBalance.update({
        where: { userId },
        data: succeeded
          ? {
              balance: { decrement: chargedAmount },
              frozenAmount: { decrement: freeze.amount },
              totalSpent: { increment: chargedAmount },
            }
          : { frozenAmount: { decrement: freeze.amount } },
      });
      const transaction = await tx.balanceTransaction.create({
        data: {
          userId,
          type: transactionType,
          amount: succeeded ? chargedAmount.negated() : new Prisma.Decimal(0),
          balanceAfter: balance.balance,
          description: succeeded
            ? "媒体模型请求扣费"
            : "媒体任务冻结已释放",
          relatedId: taskId,
          freezeId: freeze.id,
          idempotencyKey,
          projectId: task?.projectId,
          episodeId: task?.episodeId,
          taskType: task?.kind,
          billingMeta,
        },
      });
      if (succeeded && task) {
        const usageIdempotencyKey = `media:${chargeKey}:usage`;
        const components = billingMetadata.components ?? [];
        await tx.usageCost.upsert({
          where: { idempotencyKey: usageIdempotencyKey },
          create: {
            projectId: task.projectId,
            userId,
            apiType: task.kind,
            model: task.model,
            action: task.targetType ?? task.kind,
            quantity: components.length === 1 ? components[0].quantity : 1,
            unit: components.length === 1 ? components[0].unit : components.length > 1 ? "mixed" : "task",
            cost: chargedAmount,
            sourceType: "media_task",
            sourceId: taskId,
            idempotencyKey: usageIdempotencyKey,
            metadata: billingMeta,
          },
          update: {},
        });
      }
      return transaction;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/** Settle media quantities from measured output using the reserved price snapshot. */
export async function settleMediaTaskProviderOutput(userId: string, taskId: string, output: MediaAsset[]) {
  const freeze = await prisma.balanceFreeze.findFirst({ where: { userId, taskId, source: "media_task", status: "pending" }, orderBy: { createdAt: "desc" } });
  if (!freeze) return null;
  const metadata = JSON.parse(freeze.metadata ?? "{}") as { meteredDuration?: boolean; components?: Array<{ unit: string }> };
  const metered = metadata.meteredDuration;
  const imageCount = metadata.components?.some(component => component.unit === "image") ? output.filter(asset => asset.kind === "image").length : undefined;
  if (!metered && imageCount === undefined) return settleMediaTaskCharge(userId, taskId, true);
  const { probeAudioUrlDuration } = await import("@/lib/providers/local/ffmpeg-audio");
  const media = output.filter(asset => asset.kind === "audio" || asset.kind === "video");
  if (metered && !media.length) throw new BillingError("媒体响应缺少可测量产物，无法结算", 409);
  let seconds: number | undefined;
  if (metered) { seconds = 0; for (const asset of media) seconds += await probeAudioUrlDuration(asset.url); }
  const task = await prisma.mediaTask.findFirstOrThrow({ where: { id: taskId, userId } });
  const payload = task.payload && typeof task.payload === "object" && !Array.isArray(task.payload) ? task.payload : {};
  await prisma.mediaTask.update({ where: { id: taskId }, data: { payload: { ...payload, ...(seconds ? { billingDurationSeconds: seconds } : {}), ...(imageCount !== undefined ? { billingImageCount: imageCount } : {}) } } });
  return settleMediaTaskCharge(userId, taskId, true, seconds, imageCount);
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
  return billingTransaction(
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
  return billingTransaction(
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

export function quantityForBillingUnit(
  unit: string,
  request: Record<string, unknown>,
) {
  return billingQuantity(unit, mediaBillingUsage(request));
}

export function mediaBillingUsage(request: Record<string, unknown>) {
  const input = request.input ?? request.prompt ?? [request.voicePrompt, request.previewText].filter(value => typeof value === "string").join("");
  const duration = request.duration ?? request.durationSeconds;
  const seconds = typeof duration === "number" ? duration : typeof duration === "string" && /^\d+(?:\.\d+)?s?$/i.test(duration.trim()) ? Number(duration.trim().replace(/s$/i, "")) : undefined;
  return { requests: 1, images: positiveInteger(request.count ?? request.n, 1),
    inputCharacters: typeof input === "string" ? inputCharacterCount(input) : undefined, seconds };
}

export function mediaTaskAttemptKey(taskId: string, retryCount: number) {
  return `${taskId}:attempt:${Math.max(0, Math.floor(retryCount))}`;
}

function positiveInteger(value: unknown, fallback: number) {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.floor(parsed))
    : fallback;
}

function decimalAmount(value: number | string) {
  try {
    const amount = new Prisma.Decimal(value);
    if (!amount.isFinite()) throw new Error("non-finite billing amount");
    return amount;
  } catch {
    throw new BillingError("BILLING_AMOUNT_INVALID");
  }
}

function required(value: string, code: string) {
  const normalized = value.trim();
  if (!normalized) throw new BillingError(code);
  return normalized;
}

function asBillingError(error: unknown) {
  return error instanceof MediaBudgetError
    ? new BillingError(error.code, error.status)
    : error;
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
