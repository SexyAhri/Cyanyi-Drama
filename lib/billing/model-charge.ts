import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { BillingError } from "./service";
import { currentModelBilling, type ModelBillingIdentity } from "./context";
import { priceUsage, type BillingUsage } from "./pricing";
import { billingTransaction } from "./transaction";

export type ModelChargeReceipt = { id: string; requestId: string; amount: string; quantity: number; unit: string; charged: true };
export type ModelCharge = { id: string; userId: string };

export async function reserveModelRequestCharge(input: {
  identity?: ModelBillingIdentity;
  channelId?: string;
  provider?: string;
  model: string;
  capability: string;
  action: string;
  usage: BillingUsage;
  requestId?: string;
}): Promise<ModelCharge | null> {
  const identity = { ...currentModelBilling(), ...Object.fromEntries(Object.entries(input.identity ?? {}).filter(([, value]) => value !== undefined)) } as Partial<ModelBillingIdentity>;
  if (!identity.userId) {
    // Unit-level provider tests do not have an authenticated business context.
    if (process.env.NODE_ENV === "test") return null;
    throw new BillingError("模型请求缺少计费用户，已停止调用", 400);
  }
  const channelId = input.channelId ?? identity.channelId;
  let provider = input.provider ?? identity.provider;
  if (channelId) {
    const channel = await prisma.channel.findFirst({
      where: accessibleChannelWhere(identity.userId, channelId), select: { providerKey: true },
    });
    if (!channel) throw new BillingError("计费渠道不存在或无权使用", 403);
    provider = channel.providerKey;
  }
  if (identity.projectId && !await prisma.project.count({ where: { id: identity.projectId, userId: identity.userId } }))
    throw new BillingError("计费项目不存在或无权访问", 403);
  if (identity.episodeId && !await prisma.episode.count({ where: { id: identity.episodeId, ...(identity.projectId ? { projectId: identity.projectId } : {}), project: { userId: identity.userId } } }))
    throw new BillingError("计费剧集不存在或无权访问", 403);
  if (!provider) throw new BillingError("模型请求缺少计费供应商，已停止调用", 400);
  const prices = await prisma.modelPrice.findMany({
    where: { provider, model: input.model, capability: input.capability, active: true },
    select: { unit: true, unitPrice: true },
  });
  if (!prices.length) throw new BillingError(`模型 ${input.model} 尚未配置有效价格，请先配置价格`, 400);
  let pricing: ReturnType<typeof priceUsage>;
  try { pricing = priceUsage(prices, input.usage); }
  catch { throw new BillingError("模型计费方式或用量无效，已停止调用", 400); }
  const requestId = input.requestId ?? randomUUID();
  const metadata = JSON.stringify({
    provider, model: input.model, capability: input.capability, action: input.action,
    channelId, projectId: identity.projectId, episodeId: identity.episodeId,
    sourceType: identity.sourceType ?? "model_request", sourceId: identity.sourceId ?? requestId,
    usage: input.usage, components: pricing.components,
  });
  const freeze = await billingTransaction(async tx => {
    const existing = await tx.balanceFreeze.findUnique({ where: { idempotencyKey: `model:${requestId}` } });
    if (existing) {
      if (existing.userId !== identity.userId || existing.metadata !== metadata) throw new BillingError("计费请求标识冲突", 409);
      throw new BillingError("此模型请求已预留或结算，不能重复调用", 409);
    }
    await tx.userBalance.upsert({ where: { userId: identity.userId! }, create: { userId: identity.userId! }, update: {} });
    await tx.$queryRaw(Prisma.sql`SELECT id FROM user_balances WHERE user_id = ${identity.userId!} FOR UPDATE`);
    const balance = await tx.userBalance.findUniqueOrThrow({ where: { userId: identity.userId! } });
    if (balance.balance.sub(balance.frozenAmount).lt(pricing.amount)) throw new BillingError("余额不足，请先充值", 402);
    await tx.userBalance.update({ where: { userId: identity.userId! }, data: { frozenAmount: { increment: pricing.amount } } });
    return tx.balanceFreeze.create({ data: {
      userId: identity.userId!, source: "model_request", requestId,
      amount: pricing.amount, metadata, idempotencyKey: `model:${requestId}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    } });
  });
  return { id: freeze.id, userId: identity.userId };
}

export async function settleModelRequestCharge(charge: ModelCharge | null, succeeded: boolean): Promise<ModelChargeReceipt | null> {
  if (!charge) return null;
  if (succeeded) {
    // Commit the provider outcome separately so a wallet write outage can be recovered.
    await prisma.$executeRaw(Prisma.sql`UPDATE balance_freezes
      SET metadata = jsonb_set(COALESCE(metadata, '{}')::jsonb, '{requestSucceeded}', 'true'::jsonb)::text
      WHERE id = ${charge.id} AND user_id = ${charge.userId} AND source = 'model_request' AND status = 'pending'`);
  }
  return billingTransaction(async tx => {
    const freeze = await tx.balanceFreeze.findFirst({ where: { id: charge.id, userId: charge.userId, source: "model_request" } });
    if (!freeze) throw new BillingError("模型计费冻结记录不存在", 404);
    const metadata = JSON.parse(freeze.metadata ?? "{}") as {
      provider: string; model: string; capability: string; action: string; channelId?: string;
      projectId?: string; episodeId?: string; sourceType: string; sourceId: string;
      components: Array<{ unit: string; quantity: number }>;
      requestSucceeded?: boolean;
    };
    succeeded ||= metadata.requestSucceeded === true;
    const idempotencyKey = `model:${freeze.requestId}:usage`;
    if (freeze.status !== "pending") {
      const existing = await tx.usageCost.findUnique({ where: { idempotencyKey } });
      return existing ? receipt(existing, freeze.requestId!) : null;
    }
    const claimed = await tx.balanceFreeze.updateMany({ where: { id: freeze.id, status: "pending" }, data: { status: succeeded ? "settled" : "released" } });
    if (!claimed.count) return null;
    const balance = await tx.userBalance.update({ where: { userId: charge.userId }, data: {
      frozenAmount: { decrement: freeze.amount },
      ...(succeeded ? { balance: { decrement: freeze.amount }, totalSpent: { increment: freeze.amount } } : {}),
    } });
    await tx.balanceTransaction.create({ data: {
      userId: charge.userId, type: succeeded ? "charge" : "release",
      amount: succeeded ? freeze.amount.negated() : new Prisma.Decimal(0),
      balanceAfter: balance.balance, freezeId: freeze.id, relatedId: freeze.requestId,
      idempotencyKey: `model:${freeze.requestId}:${succeeded ? "charge" : "release"}`,
      projectId: metadata.projectId, episodeId: metadata.episodeId, taskType: metadata.capability,
      description: succeeded ? `${metadata.model} 模型请求扣费` : "模型请求失败，释放冻结",
      billingMeta: freeze.metadata,
    } });
    if (!succeeded) return null;
    const component = metadata.components[0];
    const entry = await tx.usageCost.upsert({ where: { idempotencyKey }, create: {
      userId: charge.userId, projectId: metadata.projectId ?? null,
      apiType: metadata.capability, model: metadata.model, action: metadata.action,
      quantity: metadata.components.length === 1 ? component.quantity : 1,
      unit: metadata.components.length === 1 ? component.unit : "mixed", cost: freeze.amount,
      sourceType: metadata.sourceType, sourceId: metadata.sourceId, idempotencyKey,
      metadata: freeze.metadata,
    }, update: {} });
    return receipt(entry, freeze.requestId!);
  });
}

export async function releaseExpiredModelRequestCharges(now = new Date(), userId?: string) {
  const freezes = await prisma.balanceFreeze.findMany({ where: { source: "model_request", status: "pending", OR: [{ expiresAt: { lte: now } }, { metadata: { contains: '"requestSucceeded"' } }], ...(userId ? { userId } : {}) }, take: 200 });
  for (const freeze of freezes) await settleModelRequestCharge({ id: freeze.id, userId: freeze.userId }, false);
  return freezes.length;
}

function receipt(entry: { id: string; cost: Prisma.Decimal; quantity: number | Prisma.Decimal; unit: string }, requestId: string): ModelChargeReceipt {
  return { id: entry.id, requestId, amount: entry.cost.toString(), quantity: Number(entry.quantity), unit: entry.unit, charged: true };
}

