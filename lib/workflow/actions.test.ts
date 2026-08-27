import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueWorkflowJob: vi.fn(),
  getWorkflowRun: vi.fn(),
  removeTerminalWorkflowRun: vi.fn(),
  requestWorkflowCancel: vi.fn(),
  retryWorkflowRun: vi.fn(),
  updateWorkflowRunStatus: vi.fn(),
}));

vi.mock("@/lib/queue/workflow-queue", () => ({
  enqueueWorkflowJob: mocks.enqueueWorkflowJob,
}));
vi.mock("./store", () => ({
  getWorkflowRun: mocks.getWorkflowRun,
  removeTerminalWorkflowRun: mocks.removeTerminalWorkflowRun,
  requestWorkflowCancel: mocks.requestWorkflowCancel,
  retryWorkflowRun: mocks.retryWorkflowRun,
  updateWorkflowRunStatus: mocks.updateWorkflowRunStatus,
}));

import { controlWorkflowRun, deleteWorkflowRun } from "./actions";

describe("workflow actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a run outside the expected project before changing state", async () => {
    mocks.getWorkflowRun.mockResolvedValue(run({ projectId: "project-b" }));

    const result = controlWorkflowRun({
      action: "pause",
      projectId: "project-a",
      runId: "run-1",
      userId: "user-1",
    });

    await expect(result).rejects.toMatchObject({
      status: 404,
    });
    expect(mocks.updateWorkflowRunStatus).not.toHaveBeenCalled();
    expect(mocks.enqueueWorkflowJob).not.toHaveBeenCalled();
  });

  it("pauses a running workflow through the shared state transition", async () => {
    const current = run();
    const paused = run({ status: "paused" });
    mocks.getWorkflowRun.mockResolvedValue(current);
    mocks.updateWorkflowRunStatus.mockResolvedValue(paused);

    await expect(
      controlWorkflowRun({
        action: "pause",
        projectId: "project-a",
        runId: current.id,
        userId: "user-1",
      }),
    ).resolves.toBe(paused);
    expect(mocks.updateWorkflowRunStatus).toHaveBeenCalledWith(
      "user-1",
      current.id,
      "paused",
      "pause_requested",
    );
    expect(mocks.enqueueWorkflowJob).not.toHaveBeenCalled();
  });

  it("retries and enqueues a failed workflow for the same project", async () => {
    const current = run({ status: "failed" });
    const queued = run({ status: "queued" });
    mocks.getWorkflowRun.mockResolvedValue(current);
    mocks.retryWorkflowRun.mockResolvedValue(queued);
    mocks.enqueueWorkflowJob.mockResolvedValue({ id: "job-1" });

    await expect(
      controlWorkflowRun({
        action: "retry",
        projectId: "project-a",
        runId: current.id,
        userId: "user-1",
      }),
    ).resolves.toBe(queued);
    expect(mocks.retryWorkflowRun).toHaveBeenCalledWith("user-1", current.id);
    expect(mocks.enqueueWorkflowJob).toHaveBeenCalledWith({
      maxAttempts: 1,
      projectId: "project-a",
      runId: current.id,
      userId: "user-1",
    });
  });

  it("deletes a terminal workflow owned by the user", async () => {
    const failed = run({ status: "failed" });
    mocks.getWorkflowRun.mockResolvedValue(failed);
    mocks.removeTerminalWorkflowRun.mockResolvedValue(true);

    await expect(
      deleteWorkflowRun({
        projectId: "project-a",
        runId: failed.id,
        userId: "user-1",
      }),
    ).resolves.toBeUndefined();
    expect(mocks.removeTerminalWorkflowRun).toHaveBeenCalledWith(
      "user-1",
      failed.id,
    );
  });

  it("refuses to delete an active workflow", async () => {
    mocks.getWorkflowRun.mockResolvedValue(run({ status: "running" }));

    await expect(
      deleteWorkflowRun({ runId: "run-1", userId: "user-1" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.removeTerminalWorkflowRun).not.toHaveBeenCalled();
  });
});

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    projectId: "project-a",
    status: "running",
    traceId: "trace-1",
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}
