import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaTask } from "./task-contract";

const mocks = vi.hoisted(() => ({
  appendEvent: vi.fn(),
  cancelMediaJob: vi.fn(),
  enqueueMediaJob: vi.fn(),
  get: vi.fn(),
  requestCancel: vi.fn(),
  settleMediaTaskCharge: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/billing/service", () => ({
  settleMediaTaskCharge: mocks.settleMediaTaskCharge,
}));
vi.mock("@/lib/queue/media-queue", () => ({
  cancelMediaJob: mocks.cancelMediaJob,
  enqueueMediaJob: mocks.enqueueMediaJob,
}));
vi.mock("./task-store", () => ({
  createDatabaseMediaTaskStore: () => ({
    appendEvent: mocks.appendEvent,
    get: mocks.get,
    requestCancel: mocks.requestCancel,
    update: mocks.update,
  }),
}));

import { controlMediaTask } from "./task-actions";

describe("media task actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a task outside the expected project before changing state", async () => {
    mocks.get.mockResolvedValue(task({ projectId: "project-b" }));

    const result = controlMediaTask({
      action: "cancel",
      projectId: "project-a",
      taskId: "task-1",
      userId: "user-1",
    });

    await expect(result).rejects.toMatchObject({
      status: 404,
    });
    expect(mocks.requestCancel).not.toHaveBeenCalled();
    expect(mocks.cancelMediaJob).not.toHaveBeenCalled();
  });

  it("keeps queued-task cancellation and billing settlement semantics", async () => {
    const current = task();
    const canceled = task({ status: "canceled" });
    mocks.get.mockResolvedValue(current);
    mocks.requestCancel.mockResolvedValue(canceled);
    mocks.cancelMediaJob.mockResolvedValue(undefined);
    mocks.settleMediaTaskCharge.mockResolvedValue(undefined);

    await expect(
      controlMediaTask({
        action: "cancel",
        projectId: "project-a",
        taskId: current.id,
        userId: "user-1",
      }),
    ).resolves.toBe(canceled);
    expect(mocks.requestCancel).toHaveBeenCalledWith(current.id);
    expect(mocks.cancelMediaJob).toHaveBeenCalledWith(current.id);
    expect(mocks.settleMediaTaskCharge).toHaveBeenCalledWith(
      "user-1",
      current.id,
      false,
    );
  });

  it("requeues a failed task without changing its identity", async () => {
    const failed = task({
      error: { message: "failed", retryable: true },
      status: "failed",
    });
    mocks.get.mockResolvedValue(failed);
    mocks.update.mockImplementation(async (value) => value);
    mocks.enqueueMediaJob.mockResolvedValue({ id: "job-2" });

    const retried = await controlMediaTask({
      action: "retry",
      projectId: "project-a",
      taskId: failed.id,
      userId: "user-1",
    });

    expect(retried).toMatchObject({
      id: failed.id,
      queueJobId: "job-2",
      retryCount: 1,
      status: "queued",
    });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueMediaJob).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-a", taskId: failed.id }),
    );
  });
});

function task(overrides: Partial<MediaTask> = {}): MediaTask {
  return {
    createdAt: "2026-08-27T00:00:00.000Z",
    id: "task-1",
    kind: "image",
    maxRetries: 2,
    model: "test-model",
    progress: 0,
    projectId: "project-a",
    protocol: "openai-compatible",
    provider: "test-provider",
    request: {},
    retryCount: 0,
    spanId: "span-1",
    status: "queued",
    traceId: "trace-1",
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}
