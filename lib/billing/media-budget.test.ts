import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { assertMediaTaskWithinBudgets, MediaBudgetError } from "./media-budget";
import type { MediaTask } from "@/lib/media/task-contract";

function tx(input: { limit?: string; actual?: string; reserved?: string; scopeType?: string } = {}) {
  const models = {
    mediaBudget: { findMany: vi.fn().mockResolvedValue(input.limit ? [{ id: "budget-1", scopeType: input.scopeType ?? "project", scopeId: "project-1", limit: new Prisma.Decimal(input.limit) }] : []) },
    mediaTask: { findMany: vi.fn().mockResolvedValue([{ id: "task-1" }, { id: "task-current" }]) },
    usageCost: { aggregate: vi.fn().mockResolvedValue({ _sum: { cost: new Prisma.Decimal(input.actual ?? "0") } }) },
    balanceFreeze: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: new Prisma.Decimal(input.reserved ?? "0") } }) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  return { models, client: models as unknown as Prisma.TransactionClient };
}

const task = { id: "task-current", projectId: "project-1", batchId: "batch-1" } as MediaTask;

describe("media budget enforcement", () => {
  it("counts settled and pending project spend before admitting another task", async () => {
    const { client, models } = tx({ limit: "10", actual: "3", reserved: "4" });
    await expect(assertMediaTaskWithinBudgets(client, "user-1", task, new Prisma.Decimal("3"))).resolves.toBeUndefined();
    expect(models.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("rejects a task that would exceed a project or batch cap", async () => {
    const { client } = tx({ limit: "10", actual: "3", reserved: "4" });
    await expect(assertMediaTaskWithinBudgets(client, "user-1", task, new Prisma.Decimal("4")))
      .rejects.toBeInstanceOf(MediaBudgetError);
  });

  it("does not perform extra accounting when no budget is configured", async () => {
    const { client, models } = tx();
    await expect(assertMediaTaskWithinBudgets(client, "user-1", task, new Prisma.Decimal("4"))).resolves.toBeUndefined();
    expect(models.mediaTask.findMany).not.toHaveBeenCalled();
    expect(models.usageCost.aggregate).not.toHaveBeenCalled();
  });
});
