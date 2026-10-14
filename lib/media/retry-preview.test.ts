import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({ prices: vi.fn(), balance: vi.fn(), budget: vi.fn() }));
vi.mock("@/lib/server/prisma", () => ({ prisma: { modelPrice: { findMany: mocks.prices }, userBalance: { findUnique: mocks.balance } } }));
vi.mock("@/lib/billing/service", () => ({ mediaBillingUsage: vi.fn(() => ({ requests: 1, images: 2 })) }));
vi.mock("@/lib/billing/media-budget", () => ({ getMediaBudgetSummary: mocks.budget }));

import { previewMediaTaskRetry } from "./retry-preview";
import type { MediaTask } from "./task-contract";

const budget = (configured = false, remaining: string | null = null) => ({ configured, limit: configured ? "10" : null, unit: "credit", actual: "0", reserved: "0", remaining, exceeded: false });
const task = (request: Record<string, unknown> = {}) => ({
  id: "task-1", projectId: "project-1", batchId: "batch-1", targetType: "storyboard_panel", targetId: "panel-1",
  kind: "image", provider: "provider", model: "image-model", request, retryCount: 1,
} as MediaTask);

describe("media retry preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prices?.mockReset?.();
    mocks.prices.mockResolvedValue([{ unit: "image", unitPrice: "3" }]);
    mocks.balance.mockResolvedValue({ balance: new Prisma.Decimal(20), frozenAmount: new Prisma.Decimal(2) });
    mocks.budget.mockImplementation(async () => budget(false));
  });

  it("estimates one new provider request against available credits and saved budgets", async () => {
    const result = await previewMediaTaskRetry(task({ count: 2 }), "user-1");
    expect(result).toMatchObject({ requestCount: 1, reusesSavedOutput: false, estimatedCredits: "6", availableCredits: "18" });
    expect(mocks.prices).toHaveBeenCalledTimes(1);
  });

  it("shows zero new requests and zero additional charge when a provider output checkpoint exists", async () => {
    const result = await previewMediaTaskRetry({ ...task(), hasSavedProviderOutput: true }, "user-1");
    expect(result).toMatchObject({ requestCount: 0, reusesSavedOutput: true, estimatedCredits: "0" });
    expect(mocks.prices).not.toHaveBeenCalled();
  });

  it("blocks a retry that would exceed a project or batch budget", async () => {
    mocks.budget.mockImplementation(async ({ scope }: { scope: { type: string } }) => budget(true, scope.type === "project" ? "5" : "4"));
    const result = await previewMediaTaskRetry(task(), "user-1");
    expect(result.blockers).toHaveLength(2);
    expect(result.blockers.every((item) => item.code === "budget_exceeded")).toBe(true);
  });
  it("blocks unpriced requests instead of silently allowing free generation", async () => {
    mocks.prices.mockResolvedValue([]);
    expect((await previewMediaTaskRetry(task(), "user-1")).blockers).toContainEqual(expect.objectContaining({ code: "model_price_missing" }));
  });
  it("shows the reservation ceiling for outputs whose duration is not known before generation", async () => {
    mocks.prices.mockResolvedValue([{ unit: "minute", unitPrice: "0.3" }]);
    expect(await previewMediaTaskRetry({ ...task(), kind: "audio" }, "user-1"))
      .toMatchObject({ reservationOnly: true, estimatedCredits: "18", availableCredits: "18", blockers: [] });
  });
});
