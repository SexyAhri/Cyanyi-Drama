import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaTask } from "./task-contract";
import { BillingError } from "@/lib/billing/service";

const mocks = vi.hoisted(() => ({
  enqueueMediaJob: vi.fn(),
  reserveMediaTaskCharge: vi.fn(),
  settleMediaTaskCharge: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/billing/service", () => ({
  BillingError: class BillingError extends Error { status = 402; },
  reserveMediaTaskCharge: mocks.reserveMediaTaskCharge,
  settleMediaTaskCharge: mocks.settleMediaTaskCharge,
}));
vi.mock("@/lib/queue/media-queue", () => ({
  enqueueMediaJob: mocks.enqueueMediaJob,
}));
vi.mock("./task-store", () => ({
  createDatabaseMediaTaskStore: () => ({ update: mocks.update }),
}));

import { enqueuePersistedMediaTask } from "./task-submit";

describe("media task submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists the queue id before making the job visible to workers", async () => {
    const callOrder: string[] = [];
    mocks.reserveMediaTaskCharge.mockImplementation(async () => {
      callOrder.push("reserve");
      return null;
    });
    mocks.update.mockImplementation(async (value) => {
      callOrder.push("persist");
      return value;
    });
    mocks.enqueueMediaJob.mockImplementation(async () => {
      callOrder.push("enqueue");
      return { id: "task-1" };
    });

    const queued = await enqueuePersistedMediaTask("user-1", task());

    expect(callOrder).toEqual(["persist", "reserve", "persist", "enqueue"]);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ executionPhase: "waiting_quota", status: "queued" }),
    );
    expect(mocks.update).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ queueJobId: "task-1", status: "queued" }),
    );
    expect(mocks.enqueueMediaJob).toHaveBeenCalledWith(
      expect.objectContaining({ maxAttempts: 1 }),
    );
    expect(queued.queueJobId).toBe("task-1");
  });

  it("fails without enqueueing when the budget blocks a reservation", async () => {
    mocks.reserveMediaTaskCharge.mockRejectedValue(new BillingError("BILLING_MEDIA_BUDGET_EXCEEDED", 402));
    await expect(enqueuePersistedMediaTask("user-1", task())).rejects.toThrow("BILLING_MEDIA_BUDGET_EXCEEDED");
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "failed",
      executionPhase: "failed",
      error: { code: "BILLING_MEDIA_BUDGET_EXCEEDED", message: "BILLING_MEDIA_BUDGET_EXCEEDED", retryable: false },
    }));
    expect(mocks.enqueueMediaJob).not.toHaveBeenCalled();
  });
});

function task(): MediaTask {
  return {
    createdAt: "2026-08-30T00:00:00.000Z",
    id: "task-1",
    kind: "image",
    maxRetries: 2,
    model: "test-model",
    progress: 0,
    projectId: "project-1",
    protocol: "openai-compatible",
    provider: "test-provider",
    request: {},
    retryCount: 0,
    spanId: "span-1",
    status: "queued",
    traceId: "trace-1",
    updatedAt: "2026-08-30T00:00:00.000Z",
  };
}
