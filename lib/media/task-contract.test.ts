import { describe, expect, it } from "vitest";

import {
  createMediaTask,
  requestMediaTaskCancel,
  transitionMediaTask,
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

  it("limits retries and preserves a retryable provider error", () => {
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

    expect(retrying.status).toBe("queued");
    expect(retrying.retryCount).toBe(1);
    expect(() =>
      transitionMediaTask(
        transitionMediaTask(retrying, { type: "start" }),
        {
          type: "fail",
          error: { message: "again", retryable: true },
        },
      ),
    ).not.toThrow();
    expect(() => transitionMediaTask(failed, { type: "retry" })).not.toThrow();
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
