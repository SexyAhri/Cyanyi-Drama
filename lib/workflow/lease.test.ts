import { afterEach, describe, expect, it, vi } from "vitest";

const workflowRun = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: { workflowRun } }));

import {
  assertWorkflowRunActive,
  claimWorkflowRunLease,
} from "./lease";

afterEach(() => {
  vi.clearAllMocks();
});

describe("workflow run lease", () => {
  it("claims only an unowned, same-owner, or expired lease", async () => {
    workflowRun.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      claimWorkflowRunLease({
        runId: "run-1",
        userId: "user-1",
        workerId: "worker-1",
        leaseMs: 10_000,
      }),
    ).resolves.toBe(true);

    expect(workflowRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { leaseOwner: null },
            { leaseOwner: "worker-1" },
          ]),
        }),
      }),
    );
  });

  it("stops persistence after cancellation or lease loss", async () => {
    workflowRun.findUnique.mockResolvedValueOnce({
      status: "canceling",
      leaseOwner: "worker-1",
      leaseExpiresAt: new Date(Date.now() + 10_000),
    });
    await expect(
      assertWorkflowRunActive({ runId: "run-1", workerId: "worker-1" }),
    ).rejects.toMatchObject({ reason: "canceled" });

    workflowRun.findUnique.mockResolvedValueOnce({
      status: "running",
      leaseOwner: "worker-2",
      leaseExpiresAt: new Date(Date.now() + 10_000),
    });
    await expect(
      assertWorkflowRunActive({ runId: "run-1", workerId: "worker-1" }),
    ).rejects.toMatchObject({ reason: "lease_lost" });
  });
});
