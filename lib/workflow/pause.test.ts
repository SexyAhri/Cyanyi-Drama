import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  workflowRun: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  workflowStep: { updateMany: vi.fn() },
  workflowStepAttempt: { updateMany: vi.fn() },
  workflowEvent: { create: vi.fn() },
  workflowArtifact: { deleteMany: vi.fn() },
  workflowCheckpoint: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/server/prisma", () => ({ prisma: db }));

import { updateWorkflowRunStatus } from "./store";

describe("workflow pause persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.workflowRun.findFirst.mockResolvedValue({ status: "running" });
    db.workflowRun.findUnique.mockResolvedValue({
      id: "run-1",
      userId: "user-1",
      traceId: "trace-1",
      spanId: "span-1",
      projectId: "project-1",
      episodeId: null,
      workflowType: "test",
      targetType: "episode",
      targetId: "episode-1",
      status: "paused",
      input: { productionConfiguration: { version: 4 } },
      workflowVersion: 1,
      queuedAt: new Date("2026-10-14T00:00:00.000Z"),
      createdAt: new Date("2026-10-14T00:00:00.000Z"),
      updatedAt: new Date("2026-10-14T00:00:00.000Z"),
      error: null,
      output: null,
      steps: [
        { id: "step-1", traceId: "trace-step", spanId: "span-step", parentSpanId: "span-1", stepKey: "done", stepType: "test", stepIndex: 0, status: "succeeded", attempt: 1, maxAttempts: 1, dependsOn: [], artifactTypes: [], retryable: true, failureMode: "fail_run", output: { result: "kept" }, input: null, error: null, startedAt: null, completedAt: new Date("2026-10-14T00:00:00.000Z") },
        { id: "step-2", traceId: "trace-step-2", spanId: "span-step-2", parentSpanId: "span-1", stepKey: "active", stepType: "test", stepIndex: 1, status: "pending", attempt: 0, maxAttempts: 1, dependsOn: [], artifactTypes: [], retryable: true, failureMode: "fail_run", output: null, input: null, error: null, startedAt: null, completedAt: null },
      ],
      checkpoints: [{ id: "checkpoint-1", stepKey: "done", version: 1, stateJson: { result: "kept" }, stateBytes: 16, createdAt: new Date("2026-10-14T00:00:00.000Z") }],
      artifacts: [{ artifactType: "episode.script" }],
      events: [],
      stepAttempts: [],
    });
    db.workflowRun.update.mockResolvedValue(undefined);
    db.workflowStep.updateMany.mockResolvedValue({ count: 1 });
    db.workflowStepAttempt.updateMany.mockResolvedValue({ count: 1 });
    db.workflowEvent.create.mockResolvedValue(undefined);
    db.$transaction.mockImplementation(async (callback) => callback(db));
  });

  it("pauses the active attempt without clearing completed steps, artifacts, checkpoints, or input", async () => {
    await updateWorkflowRunStatus("user-1", "run-1", "paused", "pause_requested");

    expect(db.workflowRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "paused",
        activeDedupeKey: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      }),
    });
    const runWrite = db.workflowRun.update.mock.calls[0][0];
    expect(runWrite.data).not.toHaveProperty("input");
    expect(db.workflowStep.updateMany).toHaveBeenCalledWith({
      where: { runId: "run-1", status: "running" },
      data: expect.objectContaining({ status: "pending", completedAt: null }),
    });
    expect(db.workflowStepAttempt.updateMany).toHaveBeenCalledWith({
      where: { runId: "run-1", status: "running" },
      data: expect.objectContaining({ status: "paused", errorCode: "WORKFLOW_PAUSED" }),
    });
    expect(db.workflowEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "paused", status: "paused", message: "pause_requested" }),
    });
    expect(db.workflowArtifact.deleteMany).not.toHaveBeenCalled();
    expect(db.workflowCheckpoint.deleteMany).not.toHaveBeenCalled();
  });
});
