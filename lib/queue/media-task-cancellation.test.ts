import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  eventCreate: vi.fn(),
  settle: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({
  prisma: {
    mediaTask: { findFirst: mocks.findFirst, updateMany: mocks.updateMany },
    mediaTaskEvent: { create: mocks.eventCreate },
  },
}));
vi.mock("@/lib/billing/service", () => ({ settleMediaTaskCharge: mocks.settle }));

import { finalizeMediaTaskCancellation } from "./media-task-cancellation";

describe("media task cancellation finalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({
      status: "running",
      progress: 42,
      cancelRequestedAt: new Date(),
      providerTaskId: "provider-task-1",
      executionPhase: "generating",
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.eventCreate.mockResolvedValue(undefined);
    mocks.settle.mockResolvedValue(undefined);
  });

  it("settles cancellation and records the unsupported remote-cancel/late-result policy", async () => {
    await expect(finalizeMediaTaskCancellation("task-1", "user-1")).resolves.toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ["queued", "running"] }, cancelRequestedAt: { not: null } }),
      data: expect.objectContaining({ status: "canceled", executionPhase: "canceled" }),
    }));
    expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "canceled",
        message: expect.stringContaining("late results are discarded"),
        payload: { cancellationPolicy: {
          provider: "cancellation_unsupported",
          lateResult: "discard",
          providerMayStillCharge: true,
        } },
      }),
    }));
    expect(mocks.settle).toHaveBeenCalledWith("user-1", "task-1", false);
  });

  it("does not change or settle a task without a persisted cancellation request", async () => {
    mocks.findFirst.mockResolvedValue({ status: "running", progress: 42, cancelRequestedAt: null });

    await expect(finalizeMediaTaskCancellation("task-1", "user-1")).resolves.toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();
  });
});
