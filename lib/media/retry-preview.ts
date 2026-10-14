import { Prisma } from "@prisma/client";

import { mediaBillingUsage } from "@/lib/billing/service";
import { priceUsage } from "@/lib/billing/pricing";
import { getMediaBudgetSummary } from "@/lib/billing/media-budget";
import type { MediaTask } from "./task-contract";
import { prisma } from "@/lib/server/prisma";

export type MediaTaskRetryPreview = {
  taskId: string;
  targetType: string;
  targetId: string;
  retryCount: number;
  requestCount: number;
  reusesSavedOutput: boolean;
  estimatedCredits: string | null;
  reservationOnly?: boolean;
  availableCredits: string | null;
  projectBudget: Awaited<ReturnType<typeof getMediaBudgetSummary>> | null;
  batchBudget: Awaited<ReturnType<typeof getMediaBudgetSummary>> | null;
  blockers: Array<{ code: string; message: string }>;
};

export async function previewMediaTaskRetry(task: MediaTask, userId: string): Promise<MediaTaskRetryPreview> {
  const reusesSavedOutput = task.hasSavedProviderOutput === true
    || (Array.isArray(task.request.providerOutput) && task.request.providerOutput.length > 0);
  const requestCount = reusesSavedOutput ? 0 : 1;
  const prices = requestCount ? await prisma.modelPrice.findMany({
    where: { provider: task.provider, model: task.model, capability: task.kind, active: true },
    select: { unit: true, unitPrice: true },
  }) : [];
  const usage = mediaBillingUsage(task.request);
  const reservationOnly = !reusesSavedOutput && !usage.seconds && prices.some(price => ["second", "minute"].includes(price.unit));
  let estimated: Prisma.Decimal | null = reusesSavedOutput ? new Prisma.Decimal(0) : null;
  let invalidPricing = false;
  try { if (prices.length) estimated = priceUsage(prices, { ...usage, ...(reservationOnly ? { seconds: 1 } : {}) }).amount; }
  catch { invalidPricing = true; }
  const balance = estimated ? await prisma.userBalance.findUnique({ where: { userId }, select: { balance: true, frozenAmount: true } }) : null;
  const available = estimated ? balance ? balance.balance.sub(balance.frozenAmount) : new Prisma.Decimal(0) : null;
  const projectBudget = task.projectId
    ? await getMediaBudgetSummary({ userId, projectId: task.projectId, scope: { type: "project", id: task.projectId } })
    : null;
  const batchBudget = task.projectId && task.batchId
    ? await getMediaBudgetSummary({ userId, projectId: task.projectId, scope: { type: "batch", id: task.batchId } })
    : null;
  const blockers: Array<{ code: string; message: string }> = [];
  if (!reusesSavedOutput && !prices.length) blockers.push({ code: "model_price_missing", message: "该模型尚未配置有效价格，请先配置价格" });
  if (invalidPricing) blockers.push({ code: "model_usage_invalid", message: "计费单位或用量无效，无法计算预留费用" });
  if (estimated && available?.lt(estimated)) blockers.push({ code: "insufficient_credits", message: "可用余额不足以再次预留该请求额度" });
  if (reservationOnly && estimated && estimated.gt(0)) {
    const minimum = estimated;
    estimated = available ?? new Prisma.Decimal(0);
    for (const budget of [projectBudget, batchBudget]) if (budget?.remaining !== null && budget?.remaining !== undefined) estimated = Prisma.Decimal.min(estimated, budget.remaining);
    if (estimated.lt(minimum)) blockers.push({ code: "budget_exceeded", message: "余额或预算剩余额度不足以预留该请求" });
  }
  for (const [scope, budget] of [["项目", projectBudget], ["批次", batchBudget]] as const) {
    if (!budget?.configured || reusesSavedOutput) continue;
    if (estimated === null) blockers.push({ code: "budget_price_unknown", message: `${scope}媒体预算已启用，但该模型没有计价配置` });
    else if (budget.exceeded || estimated.gt(budget.remaining ?? "0")) blockers.push({ code: "budget_exceeded", message: `${scope}预算剩余额度不足以重试` });
  }
  return {
    taskId: task.id,
    targetType: task.targetType ?? task.kind,
    targetId: task.targetId ?? task.id,
    retryCount: task.retryCount,
    requestCount,
    reusesSavedOutput,
    estimatedCredits: estimated?.toString() ?? null,
    reservationOnly,
    availableCredits: available?.toString() ?? null,
    projectBudget,
    batchBudget,
    blockers,
  };
}
