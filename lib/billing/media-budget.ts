import { Prisma } from "@prisma/client";

import type { MediaTask } from "@/lib/media/task-contract";
import { prisma } from "@/lib/server/prisma";

export type MediaBudgetScope = { type: "project"; id: string } | { type: "batch"; id: string };

export class MediaBudgetError extends Error {
  constructor(readonly code: "BILLING_MEDIA_BUDGET_EXCEEDED" | "BILLING_MEDIA_BUDGET_PRICE_UNKNOWN", readonly status = 402) {
    super(code);
  }
}

export async function getMediaBudgetSummary(input: {
  userId: string;
  projectId: string;
  scope: MediaBudgetScope;
}) {
  const project = await prisma.project.findFirst({ where: { id: input.projectId, userId: input.userId }, select: { id: true } });
  if (!project) throw new MediaBudgetError("BILLING_MEDIA_BUDGET_EXCEEDED", 404);
  if (input.scope.type === "batch") {
    const batch = await prisma.mediaTask.findFirst({
      where: { userId: input.userId, projectId: input.projectId, batchId: input.scope.id },
      select: { id: true },
    });
    if (!batch) {
      const budget = await prisma.mediaBudget.findUnique({
        where: { projectId_scopeType_scopeId: { projectId: input.projectId, scopeType: "batch", scopeId: input.scope.id } },
        select: { limit: true, unit: true },
      });
      return summarize({ budget, actual: new Prisma.Decimal(0), reserved: new Prisma.Decimal(0) });
    }
  }
  const budget = await prisma.mediaBudget.findUnique({
    where: { projectId_scopeType_scopeId: { projectId: input.projectId, scopeType: input.scope.type, scopeId: input.scope.id } },
    select: { limit: true, unit: true },
  });
  const taskWhere = input.scope.type === "batch"
    ? { userId: input.userId, projectId: input.projectId, batchId: input.scope.id }
    : { userId: input.userId, projectId: input.projectId };
  const tasks = await prisma.mediaTask.findMany({ where: taskWhere, select: { id: true } });
  const taskIds = tasks.map((task) => task.id);
  const [costs, freezes] = taskIds.length ? await Promise.all([
    prisma.usageCost.aggregate({ where: { userId: input.userId, projectId: input.projectId, sourceType: "media_task", sourceId: { in: taskIds } }, _sum: { cost: true } }),
    prisma.balanceFreeze.aggregate({ where: { userId: input.userId, status: "pending", taskId: { in: taskIds } }, _sum: { amount: true } }),
  ]) : [null, null];
  return summarize({
    budget,
    actual: costs?._sum.cost ?? new Prisma.Decimal(0),
    reserved: freezes?._sum.amount ?? new Prisma.Decimal(0),
  });
}

export async function setMediaBudgetLimit(input: {
  userId: string;
  projectId: string;
  scope: MediaBudgetScope;
  limit: string | number | null;
}) {
  const project = await prisma.project.findFirst({ where: { id: input.projectId, userId: input.userId }, select: { id: true } });
  if (!project) throw new MediaBudgetError("BILLING_MEDIA_BUDGET_EXCEEDED", 404);
  const where = { projectId_scopeType_scopeId: { projectId: input.projectId, scopeType: input.scope.type, scopeId: input.scope.id } };
  if (input.limit === null) {
    await prisma.mediaBudget.deleteMany({ where: { projectId: input.projectId, scopeType: input.scope.type, scopeId: input.scope.id } });
  } else {
    const limit = new Prisma.Decimal(input.limit);
    if (!limit.isFinite() || limit.lt(0) || limit.gt("999999999999.999999")) throw new MediaBudgetError("BILLING_MEDIA_BUDGET_EXCEEDED", 400);
    await prisma.mediaBudget.upsert({
      where,
      create: { userId: input.userId, projectId: input.projectId, scopeType: input.scope.type, scopeId: input.scope.id, limit, unit: "credit" },
      update: { limit, unit: "credit" },
    });
  }
  return getMediaBudgetSummary(input);
}

export async function assertMediaTaskWithinBudgets(
  tx: Prisma.TransactionClient,
  userId: string,
  task: MediaTask,
  amount: Prisma.Decimal,
) {
  const budgets = await tx.mediaBudget.findMany({
    where: {
      userId,
      projectId: task.projectId,
      OR: [
        { scopeType: "project", scopeId: task.projectId },
        ...(task.batchId ? [{ scopeType: "batch", scopeId: task.batchId }] : []),
      ],
    },
    select: { id: true, scopeType: true, scopeId: true, limit: true },
  });
  if (!budgets.length) return;
  await tx.$queryRaw(Prisma.sql`SELECT id FROM media_budgets WHERE id IN (${Prisma.join(budgets.map((budget) => budget.id))}) FOR UPDATE`);
  for (const budget of budgets) {
    const taskWhere = budget.scopeType === "batch"
      ? { userId, projectId: task.projectId, batchId: budget.scopeId }
      : { userId, projectId: task.projectId };
    const tasks = await tx.mediaTask.findMany({ where: taskWhere, select: { id: true } });
    const taskIds = tasks.map((item) => item.id);
    const [costs, freezes] = taskIds.length ? await Promise.all([
      tx.usageCost.aggregate({ where: { userId, projectId: task.projectId, sourceType: "media_task", sourceId: { in: taskIds } }, _sum: { cost: true } }),
      tx.balanceFreeze.aggregate({ where: { userId, status: "pending", taskId: { in: taskIds } }, _sum: { amount: true } }),
    ]) : [null, null];
    const current = (costs?._sum.cost ?? new Prisma.Decimal(0)).add(freezes?._sum.amount ?? new Prisma.Decimal(0));
    if (current.add(amount).gt(budget.limit)) throw new MediaBudgetError("BILLING_MEDIA_BUDGET_EXCEEDED");
  }
}

export async function assertUnknownMediaTaskCostAllowed(userId: string, task: MediaTask) {
  const budget = await prisma.mediaBudget.findFirst({
    where: {
      userId,
      projectId: task.projectId,
      OR: [
        { scopeType: "project", scopeId: task.projectId },
        ...(task.batchId ? [{ scopeType: "batch", scopeId: task.batchId }] : []),
      ],
    },
    select: { id: true },
  });
  if (budget) throw new MediaBudgetError("BILLING_MEDIA_BUDGET_PRICE_UNKNOWN");
}

function summarize(input: {
  budget: { limit: Prisma.Decimal; unit: string } | null;
  actual: Prisma.Decimal;
  reserved: Prisma.Decimal;
}) {
  const consumed = input.actual.add(input.reserved);
  const remaining = input.budget ? input.budget.limit.sub(consumed) : null;
  return {
    configured: Boolean(input.budget),
    limit: input.budget?.limit.toString() ?? null,
    unit: input.budget?.unit ?? "credit",
    actual: input.actual.toString(),
    reserved: input.reserved.toString(),
    remaining: remaining?.lt(0) ? "0" : remaining?.toString() ?? null,
    exceeded: Boolean(remaining?.lt(0)),
  };
}
