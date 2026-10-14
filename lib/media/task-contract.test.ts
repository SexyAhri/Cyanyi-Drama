import { describe, expect, it } from "vitest";

import {
  createMediaTask,
  requestMediaTaskCancel,
  transitionMediaTask,
  transitionMediaTaskExecutionPhase,
  updateMediaTaskProgress,
} from "./task-contract";

describe("media task contract", () => {
  it("enforces the queued -> running -> succeeded lifecycle", () => {
    const task = createMediaTask({
      id: "task-1",
      kind: "video",
      provider: "ark",
      protocol: "volcengine-ark",
      model: "doubao-seedance-2-0-260128",
      request: { prompt: "test" },
      now: "2026-01-01T00:00:00.000Z",
    });

    const running = transitionMediaTask(task, {
      type: "start",
      at: "2026-01-01T00:00:01.000Z",
    });
    const succeeded = transitionMediaTask(running, {
      type: "succeed",
      output: [{ id: "asset-1", kind: "video", url: "https://example.com/a.mp4" }],
      at: "2026-01-01T00:00:02.000Z",
    });

    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.output?.[0]?.id).toBe("asset-1");
    expect(() => transitionMediaTask(succeeded, { type: "start" })).toThrow(
      "MEDIA_TASK_INVALID_TRANSITION:succeeded->start",
    );
  });

  it("uses one automatic attempt and allows unlimited explicit retries", () => {
    const task = createMediaTask({
      id: "task-2",
      kind: "image",
      provider: "ark",
      protocol: "volcengine-ark",
      model: "doubao-seedream-4-0-250828",
      request: {},
      maxRetries: 1,
    });
    const failed = transitionMediaTask(
      transitionMediaTask(task, { type: "start" }),
      {
        type: "fail",
        error: { code: "TIMEOUT", message: "provider timeout", retryable: true },
      },
    );
    const retrying = transitionMediaTask(failed, { type: "retry" });

    expect(task.maxRetries).toBe(1);
    expect(retrying.status).toBe("queued");
    expect(retrying.retryCount).toBe(1);
    const failedAgain = transitionMediaTask(
      transitionMediaTask(retrying, { type: "start" }),
      {
        type: "fail",
        error: { message: "again", retryable: true },
      },
    );
    expect(transitionMediaTask(failedAgain, { type: "retry" })).toMatchObject({
      retryCount: 2,
      status: "queued",
    });
  });

  it("defaults new media tasks to no automatic retries", () => {
    const task = createMediaTask({
      id: "task-no-auto-retry",
      kind: "image",
      provider: "ark",
      protocol: "volcengine-ark",
      model: "image-model",
      request: {},
    });

    expect(task.maxRetries).toBe(0);
  });

  it("records provider execution phases without changing coarse task status", () => {
    let task = createMediaTask({
      id: "task-phases",
      kind: "video",
      provider: "ark",
      protocol: "volcengine-ark",
      model: "video-model",
      request: { prompt: "frozen input" },
    });
    task = transitionMediaTask(task, { type: "start" });
    task = transitionMediaTaskExecutionPhase(task, "request_sent");
    task = transitionMediaTaskExecutionPhase(task, "submitted", undefined, "provider-task-1");
    task = transitionMediaTaskExecutionPhase(task, "generating");
    task = transitionMediaTaskExecutionPhase(task, "downloading");
    task = transitionMediaTaskExecutionPhase(task, "saving");
    task = transitionMediaTaskExecutionPhase(task, "succeeded");

    expect(task).toMatchObject({
      status: "running",
      executionPhase: "succeeded",
      providerTaskId: "provider-task-1",
      request: { prompt: "frozen input" },
    });
    expect(() => transitionMediaTaskExecutionPhase(task, "generating")).toThrow(
      "MEDIA_TASK_INVALID_PHASE_TRANSITION:succeeded->generating",
    );
  });

  it("records quota waits while resuming an existing provider task", () => {
    let task = createMediaTask({
      id: "task-quota-resume",
      kind: "image",
      provider: "ark",
      protocol: "volcengine-ark",
      model: "image-model",
      request: {},
    });
    task = transitionMediaTask(task, { type: "start" });
    task = transitionMediaTaskExecutionPhase(task, "request_sent");
    task = transitionMediaTaskExecutionPhase(task, "submitted", undefined, "provider-task-3");
    task = transitionMediaTaskExecutionPhase(task, "generating");
    task = transitionMediaTaskExecutionPhase(task, "waiting_quota");
    task = transitionMediaTaskExecutionPhase(task, "generating");

    expect(task).toMatchObject({ status: "running", executionPhase: "generating", providerTaskId: "provider-task-3" });
  });

  it("rejects skipping execution phases while allowing persisted async recovery", () => {
    const queued = createMediaTask({
      id: "task-invalid-phase",
      kind: "video",
      provider: "ark",
      protocol: "volcengine-ark",
      model: "video-model",
      request: {},
    });
    expect(() => transitionMediaTaskExecutionPhase(queued, "saving")).toThrow(
      "MEDIA_TASK_INVALID_PHASE_TRANSITION:queued->saving",
    );
    const recovering = {
      ...transitionMediaTaskExecutionPhase(
        transitionMediaTaskExecutionPhase(
          transitionMediaTask(queued, { type: "start" }),
          "request_sent",
        ),
        "submitted",
        "2026-10-14T00:00:00.000Z",
        "provider-task-2",
      ),
      status: "queued" as const,
    };
    expect(transitionMediaTaskExecutionPhase(recovering, "generating")).toMatchObject({
      status: "queued",
      executionPhase: "generating",
      providerTaskId: "provider-task-2",
    });
  });

  it("tracks progress and requests cancellation without changing a running task", () => {
    const task = transitionMediaTask(
      createMediaTask({
        id: "task-progress",
        kind: "video",
        provider: "ark",
        protocol: "volcengine-ark",
        model: "video-model",
        request: {},
      }),
      { type: "start", at: "2026-01-01T00:00:01.000Z" },
    );
    const progress = updateMediaTaskProgress(task, 42, "Rendering", "2026-01-01T00:00:02.000Z");
    const cancel = requestMediaTaskCancel(progress, "2026-01-01T00:00:03.000Z");
    expect(progress.progress).toBe(42);
    expect(progress.progressMessage).toBe("Rendering");
    expect(cancel.status).toBe("running");
    expect(cancel.cancelRequestedAt).toBe("2026-01-01T00:00:03.000Z");
  });
});
