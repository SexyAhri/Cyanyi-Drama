import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ add: vi.fn(), getJob: vi.fn(), eval: vi.fn(), get: vi.fn(), update: vi.fn(), claimFailedTaskForRetry: vi.fn() }));
vi.mock("bullmq", () => ({ Queue: class { add = mocks.add; getJob = mocks.getJob; } }));
vi.mock("./connection", () => ({ getRedisConnection: () => ({ eval: mocks.eval }) }));
vi.mock("@/lib/billing/service", () => ({
  BillingError: class BillingError extends Error { status = 402; },
  reserveMediaTaskCharge: vi.fn().mockResolvedValue(null),
  settleMediaTaskCharge: vi.fn(),
}));
vi.mock("@/lib/media/task-store", () => ({
  createDatabaseMediaTaskStore: () => ({ get: mocks.get, update: mocks.update, claimFailedTaskForRetry: mocks.claimFailedTaskForRetry }),
}));

import { enqueueMediaJob } from "./media-queue";
import { controlMediaTask } from "@/lib/media/task-actions";
import { createMediaTask } from "@/lib/media/task-contract";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getJob.mockResolvedValue(null);
  mocks.eval.mockResolvedValue([1, 101]);
});

describe("media queue retry", () => {
  it.each(["image", "video", "audio"] as const)("enqueues %s retries even when BullMQ retains the old terminal job", async kind => {
    const failed = { ...createMediaTask({
      id: "task-1", kind, model: "test", provider: "test", protocol: "openai-compatible", request: {},
    }), status: "failed" as const, queueJobId: "task-1" };
    mocks.get.mockResolvedValue(failed);
    mocks.claimFailedTaskForRetry.mockResolvedValue(true);
    const retained = { id: failed.id, state: "completed" };
    const jobs = new Map([[failed.id, retained]]);
    mocks.add.mockImplementation(async (_name, _data, options: { jobId: string }) => {
      // BullMQ returns the existing terminal job if the same ID is added again.
      if (jobs.has(options.jobId)) return jobs.get(options.jobId);
      const added = { id: options.jobId, state: "waiting" };
      jobs.set(options.jobId, added); return added;
    });
    const queued = await controlMediaTask({ action: "retry", taskId: failed.id, userId: "user-1" });
    expect(queued.id).toBe(failed.id);
    expect(queued.queueJobId).not.toBe(failed.id);
    expect(jobs.get(queued.queueJobId!)).toMatchObject({ state: "waiting" });
    expect(jobs.get(failed.id)).toBe(retained);
    expect(mocks.claimFailedTaskForRetry).toHaveBeenCalledWith(expect.objectContaining({ queueJobId: queued.queueJobId }), failed.updatedAt);
    expect(mocks.add.mock.calls[0][1].taskId).toBe(failed.id);
    expect(mocks.add.mock.calls[0][2].priority).toBe(1);
  });

  it("keeps the initial task ID when no retry job ID is supplied", async () => {
    await enqueueMediaJob({ taskId: "new-task", userId: "user-1", kind: "image" });
    expect(mocks.add).toHaveBeenCalledWith("image", expect.anything(), expect.objectContaining({ jobId: "new-task", priority: 200 }));
  });

  it("gives batch work a project-load priority so another project's first job can go ahead", async () => {
    mocks.eval.mockResolvedValueOnce([1, 101]).mockResolvedValueOnce([1, 102]).mockResolvedValueOnce([1, 101]);
    mocks.add.mockResolvedValue({ id: "batch-job" });
    await enqueueMediaJob({ taskId: "batch-task-1", userId: "user-1", projectId: "project-a", priorityClass: "batch", kind: "image" });
    await enqueueMediaJob({ taskId: "batch-task-2", userId: "user-1", projectId: "project-a", priorityClass: "batch", kind: "image" });
    await enqueueMediaJob({ taskId: "other-project-task", userId: "user-2", projectId: "project-b", priorityClass: "batch", kind: "image" });
    expect(mocks.eval.mock.calls[0][0]).toContain("INCR");
    expect(mocks.eval.mock.calls[0][0]).toContain("math.min(pending, 1000)");
    expect(mocks.add.mock.calls.map((call) => call[2].priority)).toEqual([101, 102, 101]);
  });

  it("releases a project's fair-queue reservation when a queued job is removed", async () => {
    const job = { id: "queue-job", remove: vi.fn().mockResolvedValue(undefined) };
    mocks.getJob.mockResolvedValue(job);
    expect(await (await import("./media-queue")).cancelMediaJob("queue-job")).toBe(true);
    expect(job.remove).toHaveBeenCalledOnce();
    expect(mocks.eval.mock.calls[0][0]).toContain("DECR");
  });

  it("releases the project reservation when BullMQ rejects enqueue", async () => {
    mocks.eval.mockResolvedValueOnce([1, 101]).mockResolvedValueOnce(1);
    mocks.add.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(enqueueMediaJob({ taskId: "failed-enqueue", userId: "user-1", projectId: "project-a", priorityClass: "batch", kind: "image" }))
      .rejects.toThrow("queue unavailable");
    expect(mocks.eval).toHaveBeenCalledTimes(2);
    expect(mocks.eval.mock.calls[1][0]).toContain("DECR");
  });
});
