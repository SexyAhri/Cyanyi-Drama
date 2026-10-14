import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { getMediaBudgetSummary } from "@/lib/billing/media-budget";

const mocks = vi.hoisted(() => ({
  channelFindFirst: vi.fn(),
  modelFindFirst: vi.fn(),
  taskFindMany: vi.fn(),
  priceFindMany: vi.fn(),
  balanceFindUnique: vi.fn(),
  preview: vi.fn(),
}));

vi.mock("@/lib/media/project-asset-tasks", () => ({
  previewStoryboardPanelPrompt: mocks.preview,
  ProjectAssetTaskError: class ProjectAssetTaskError extends Error { status = 400; },
}));
vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    channel: { findFirst: mocks.channelFindFirst },
    providerModel: { findFirst: mocks.modelFindFirst },
    mediaTask: { findMany: mocks.taskFindMany },
    modelPrice: { findMany: mocks.priceFindMany },
    userBalance: { findUnique: mocks.balanceFindUnique },
  },
}));
vi.mock("@/lib/server/channel-access", () => ({ accessibleChannelWhere: vi.fn(() => ({})) }));
vi.mock("@/lib/providers/media/registry", () => ({ isMediaChannelProtocol: vi.fn(() => true) }));
vi.mock("@/lib/billing/media-budget", () => ({ getMediaBudgetSummary: vi.fn(async () => ({ configured: false, limit: null, unit: "credit", actual: "0", reserved: "0", remaining: null, exceeded: false })) }));

import { estimateMediaBatchCharge, preflightStoryboardBatch } from "./storyboard-batch-preflight";

describe("storyboard batch billing preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.channelFindFirst.mockResolvedValue({ id: "channel-1", providerKey: "provider", protocol: "openai-compatible" });
    mocks.modelFindFirst.mockResolvedValue({ id: "model-1" });
    mocks.taskFindMany.mockResolvedValue([]);
    mocks.priceFindMany.mockResolvedValue([]);
    mocks.balanceFindUnique.mockResolvedValue(null);
  });

  it("sums configured per-request, image, and duration prices across split tasks", () => {
    const estimate = estimateMediaBatchCharge(
      [
        { unit: "request", unitPrice: "0.25" },
        { unit: "second", unitPrice: "0.1" },
      ],
      [{ duration: "4s" }, { duration: "6s" }],
    );
    expect(estimate?.toString()).toBe("1.5");
  });

  it("returns unknown when there is no configured price or no billable request", () => {
    expect(estimateMediaBatchCharge([], [{ prompt: "x" }])).toBeNull();
    expect(estimateMediaBatchCharge([{ unit: "request", unitPrice: 1 }], [])).toBeNull();
  });

  it("collects blocking issues for every target and estimates configured balance before dispatch", async () => {
    mocks.preview.mockImplementation(async ({ panelId }: { panelId: string }) => ({
      kind: "image",
      finalPrompt: `prompt ${panelId}`,
      issues: panelId === "panel-b" ? [{ blocking: true, code: "missing_reference", message: "缺少参考素材" }] : [],
      segments: undefined,
    }));
    mocks.priceFindMany.mockResolvedValue([{ unit: "image", unitPrice: "2" }]);
    mocks.balanceFindUnique.mockResolvedValue({ balance: new Prisma.Decimal(5), frozenAmount: new Prisma.Decimal(1) });
    // Prisma.Decimal is used for exact arithmetic by the production balance path.
    const result = await preflightStoryboardBatch({
      userId: "user-1", projectId: "project-1", episodeId: "episode-1",
      channelId: "channel-1", model: "image-model", kind: "image",
      items: [{ panelId: "panel-a" }, { panelId: "panel-b" }],
      mediaDefaults: { imageGenerationCount: 1 } as never,
    });
    expect(result.items).toHaveLength(2);
    expect(result.requestCount).toBe(1);
    expect(result.items[1]?.issues).toContainEqual(expect.objectContaining({ code: "missing_reference", blocking: true }));
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: "missing_reference" }));
    expect(result.quota).toMatchObject({ status: "sufficient", availableCredits: "4", estimatedCredits: "2" });
    expect(mocks.preview).toHaveBeenCalledTimes(2);
  });

  it("blocks the full batch when the project budget would be exceeded", async () => {
    mocks.preview.mockImplementation(async ({ panelId }: { panelId: string }) => ({ kind: "image", finalPrompt: panelId, issues: [] }));
    mocks.priceFindMany.mockResolvedValue([{ unit: "request", unitPrice: "2" }]);
    mocks.balanceFindUnique.mockResolvedValue({ balance: new Prisma.Decimal(100), frozenAmount: new Prisma.Decimal(0) });
    vi.mocked(getMediaBudgetSummary).mockResolvedValue({ configured: true, limit: "10", unit: "credit", actual: "8", reserved: "1", remaining: "1", exceeded: false });
    const result = await preflightStoryboardBatch({
      userId: "user-1", projectId: "project-1", episodeId: "episode-1",
      channelId: "channel-1", model: "image-model", kind: "image",
      items: [{ panelId: "panel-a" }, { panelId: "panel-b" }],
      mediaDefaults: {} as never,
    });
    expect(result.requestCount).toBe(2);
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: "media_project_budget_exceeded", blocking: true }));
    expect(result.projectBudget.remaining).toBe("1");
  });
});
