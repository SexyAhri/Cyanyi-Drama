import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { BillingError } from "./service";
import { currentModelBilling, type ModelBillingIdentity } from "./context";
import { priceUsage, type BillingUsage, type PricingComponent } from "./pricing";
import { isTokenPriceUnit, validatePricePlan } from "./pricing-contract";
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
  estimatedOutputTokens?: number;
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
  const tokenMetered = prices.some(price => isTokenPriceUnit(price.unit));
  if (tokenMetered) {
    try { validatePricePlan(input.capability, prices.map(price => ({ ...price, unitPrice: price.unitPrice.toString() }))); }
    catch { throw new BillingError("模型 Token 价格方案不完整或混用了其他计费方式，请重新配置", 400); }
  }
  // Reservation is an estimate only. Successful responses settle using reported tokens.
  const reservationUsage = tokenMetered ? { ...input.usage,
    inputTokens: Math.max(1, (input.usage.inputCharacters ?? 0) * 3 + 256),
    outputTokens: input.estimatedOutputTokens ?? 8192, cachedInputTokens: 0, cacheWriteTokens: 0,
  } : input.usage;
  try { pricing = priceUsage(prices, reservationUsage); }
  catch { throw new BillingError("模型计费方式或用量无效，已停止调用", 400); }
  const requestId = input.requestId ?? randomUUID();
  const metadata = JSON.stringify({
    provider, model: input.model, capability: input.capability, action: input.action,
    channelId, projectId: identity.projectId, episodeId: identity.episodeId,
    sourceType: identity.sourceType ?? "model_request", sourceId: identity.sourceId ?? requestId,
    usage: input.usage, components: pricing.components, ...(tokenMetered ? { tokenMetered: true, reservationUsage } : {}),
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

export async function settleModelRequestCharge(charge: ModelCharge | null, succeeded: boolean, usage?: BillingUsage | null): Promise<ModelChargeReceipt | null> {
  if (!charge) return null;
  if (succeeded) {
    const freeze = await prisma.balanceFreeze.findFirst({ where: { id: charge.id, userId: charge.userId, source: "model_request" } });
    if (!freeze) throw new BillingError("模型计费冻结记录不存在", 404);
    const snapshot = JSON.parse(freeze.metadata ?? "{}") as { tokenMetered?: boolean; components: PricingComponent[]; requestSucceeded?: boolean };
    if (snapshot.tokenMetered && freeze.status === "pending" && !snapshot.requestSucceeded) {
      try { priceUsage(snapshot.components, usage ?? {}); }
      catch {
        // Never bill estimated tokens as measured usage. Providers without usage can use a fixed request plan.
        await settleModelRequestCharge(charge, false);
        throw new BillingError("模型未返回有效的输入/输出 Token 用量，本次未扣费；请检查渠道用量回传，或将此模型改为按次计费", 502);
      }
    }
    // Commit the provider outcome separately so a wallet write outage can be recovered.
    await prisma.$executeRaw(Prisma.sql`UPDATE balance_freezes
      SET metadata = (COALESCE(metadata, '{}')::jsonb || ${JSON.stringify({ requestSucceeded: true, ...(usage ? { actualUsage: usage } : {}) })}::jsonb)::text
      WHERE id = ${charge.id} AND user_id = ${charge.userId} AND source = 'model_request' AND status = 'pending'
        AND COALESCE((metadata::jsonb ->> 'requestSucceeded')::boolean, false) = false`);
  }
  return billingTransaction(async tx => {
    const freeze = await tx.balanceFreeze.findFirst({ where: { id: charge.id, userId: charge.userId, source: "model_request" } });
    if (!freeze) throw new BillingError("模型计费冻结记录不存在", 404);
    const metadata = JSON.parse(freeze.metadata ?? "{}") as {
      provider: string; model: string; capability: string; action: string; channelId?: string;
      projectId?: string; episodeId?: string; sourceType: string; sourceId: string;
      components: PricingComponent[];
      tokenMetered?: boolean;
      actualUsage?: BillingUsage;
      requestSucceeded?: boolean;
    };
    succeeded ||= metadata.requestSucceeded === true;
    const idempotencyKey = `model:${freeze.requestId}:usage`;
    if (freeze.status !== "pending") {
      const existing = await tx.usageCost.findUnique({ where: { idempotencyKey } });
      return existing ? receipt(existing, freeze.requestId!) : null;
    }
    const actual = succeeded && metadata.tokenMetered ? priceUsage(metadata.components, metadata.actualUsage ?? {}) : null;
    const amount = succeeded ? actual?.amount ?? freeze.amount : new Prisma.Decimal(0);
    if (actual) metadata.components = actual.components;
    const settledMetadata = JSON.stringify(metadata);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM user_balances WHERE user_id = ${charge.userId} FOR UPDATE`);
    const currentBalance = await tx.userBalance.findUniqueOrThrow({ where: { userId: charge.userId } });
    if (succeeded && currentBalance.balance.sub(currentBalance.frozenAmount).add(freeze.amount).lt(amount))
      throw new BillingError("实际 Token 费用超出可用余额，已保留用量记录；充值后可重新对账结算", 402);
    const claimed = await tx.balanceFreeze.updateMany({ where: { id: freeze.id, status: "pending" }, data: { status: succeeded ? "settled" : "released", metadata: settledMetadata } });
    if (!claimed.count) return null;
    const balance = await tx.userBalance.update({ where: { userId: charge.userId }, data: {
      frozenAmount: { decrement: freeze.amount },
      ...(succeeded ? { balance: { decrement: amount }, totalSpent: { increment: amount } } : {}),
    } });
    await tx.balanceTransaction.create({ data: {
      userId: charge.userId, type: succeeded ? "charge" : "release",
      amount: amount.negated(),
      balanceAfter: balance.balance, freezeId: freeze.id, relatedId: freeze.requestId,
      idempotencyKey: `model:${freeze.requestId}:${succeeded ? "charge" : "release"}`,
      projectId: metadata.projectId, episodeId: metadata.episodeId, taskType: metadata.capability,
      description: succeeded ? `${metadata.model} 模型请求扣费` : "模型请求失败，释放冻结",
      billingMeta: settledMetadata,
    } });
    if (!succeeded) return null;
    const component = metadata.components[0];
    const entry = await tx.usageCost.upsert({ where: { idempotencyKey }, create: {
      userId: charge.userId, projectId: metadata.projectId ?? null,
      apiType: metadata.capability, model: metadata.model, action: metadata.action,
      quantity: metadata.tokenMetered ? (metadata.actualUsage?.inputTokens ?? 0) + (metadata.actualUsage?.outputTokens ?? 0) : metadata.components.length === 1 ? component.quantity : 1,
      unit: metadata.tokenMetered ? "tokens" : metadata.components.length === 1 ? component.unit : "mixed", cost: amount,
      sourceType: metadata.sourceType, sourceId: metadata.sourceId, idempotencyKey,
      metadata: settledMetadata,
    }, update: {} });
    return receipt(entry, freeze.requestId!);
  });
}

export async function releaseExpiredModelRequestCharges(now = new Date(), userId?: string) {
  const freezes = await prisma.balanceFreeze.findMany({ where: { source: "model_request", status: "pending", OR: [{ expiresAt: { lte: now } }, { metadata: { contains: '"requestSucceeded"' } }], ...(userId ? { userId } : {}) }, take: 200 });
  let settled = 0;
  for (const freeze of freezes) {
    try { await settleModelRequestCharge({ id: freeze.id, userId: freeze.userId }, false); settled++; }
    catch (error) {
      // One underfunded successful request must not block other users' reconciliation.
      if (!(error instanceof BillingError) || error.status !== 402) throw error;
    }
  }
  return settled;
}

function receipt(entry: { id: string; cost: Prisma.Decimal; quantity: number | Prisma.Decimal; unit: string }, requestId: string): ModelChargeReceipt {
  return { id: entry.id, requestId, amount: entry.cost.toString(), quantity: Number(entry.quantity), unit: entry.unit, charged: true };
}

