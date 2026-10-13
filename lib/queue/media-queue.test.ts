import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ add: vi.fn(), getJob: vi.fn(), get: vi.fn(), update: vi.fn() }));
vi.mock("bullmq", () => ({ Queue: class { add = mocks.add; getJob = mocks.getJob; } }));
vi.mock("./connection", () => ({ getRedisConnection: () => ({}) }));
vi.mock("@/lib/billing/service", () => ({ settleMediaTaskCharge: vi.fn() }));
vi.mock("@/lib/media/task-store", () => ({
  createDatabaseMediaTaskStore: () => ({ get: mocks.get, update: mocks.update }),
}));

import { enqueueMediaJob } from "./media-queue";
import { controlMediaTask } from "@/lib/media/task-actions";
import { createMediaTask } from "@/lib/media/task-contract";

beforeEach(() => vi.resetAllMocks());

describe("media queue retry", () => {
  it.each(["image", "video", "audio"] as const)("enqueues %s retries even when BullMQ retains the old terminal job", async kind => {
    const failed = { ...createMediaTask({
      id: "task-1", kind, model: "test", provider: "test", protocol: "openai-compatible", request: {},
    }), status: "failed" as const, queueJobId: "task-1" };
    mocks.get.mockResolvedValue(failed);
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
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ queueJobId: queued.queueJobId }));
    expect(mocks.add.mock.calls[0][1].taskId).toBe(failed.id);
  });

  it("keeps the initial task ID when no retry job ID is supplied", async () => {
    await enqueueMediaJob({ taskId: "new-task", userId: "user-1", kind: "image" });
    expect(mocks.add).toHaveBeenCalledWith("image", expect.anything(), expect.objectContaining({ jobId: "new-task" }));
  });
});
