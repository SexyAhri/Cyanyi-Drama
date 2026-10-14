import { describe, expect, it } from "vitest";

import { canResumeMediaProviderTask, mediaFailureStage, mediaTaskRecoveryMode, restoreCheckpointedMediaOutput } from "./media-task-recovery";

describe("media provider recovery", () => {
  it.each(["submitted", "generating", "downloading", "saving"])(
    "resumes %s from a persisted async provider task id",
    executionPhase => {
      expect(canResumeMediaProviderTask({
        providerTaskId: "provider-task-1",
        executionPhase,
        protocol: "volcengine-ark",
      })).toBe(true);
    },
  );

  it("does not resubmit work when the provider task id or a resume adapter is missing", () => {
    expect(canResumeMediaProviderTask({ executionPhase: "generating", protocol: "volcengine-ark" })).toBe(false);
    expect(canResumeMediaProviderTask({ providerTaskId: "task-1", executionPhase: "generating", protocol: "bailian-dashscope" })).toBe(false);
    expect(canResumeMediaProviderTask({ providerTaskId: "task-1", executionPhase: "failed", protocol: "volcengine-ark" })).toBe(false);
  });

  it("restores a complete provider output checkpoint without requiring a provider task id", () => {
    expect(restoreCheckpointedMediaOutput([
      { id: "asset-1", kind: "video", url: "https://cdn.test/result.mp4" },
    ], "video")).toEqual([
      { id: "asset-1", kind: "video", url: "https://cdn.test/result.mp4" },
    ]);
    expect(restoreCheckpointedMediaOutput([
      { id: "asset-1", kind: "image", url: "https://cdn.test/result.png" },
    ], "video")).toBeNull();
  });

  it("prefers saving a complete provider output over polling or resubmitting", () => {
    expect(mediaTaskRecoveryMode({
      hasProviderOutput: true,
      providerTaskId: "provider-task-1",
      executionPhase: "saving",
      protocol: "volcengine-ark",
    })).toBe("save_output");
    expect(mediaTaskRecoveryMode({
      hasProviderOutput: false,
      providerTaskId: "provider-task-1",
      executionPhase: "generating",
      protocol: "volcengine-ark",
    })).toBe("resume_provider");
  });

  it("distinguishes generation failures from result delivery failures", () => {
    expect(mediaFailureStage({ executionPhase: "generating", hasProviderOutput: false })).toBe("generation");
    expect(mediaFailureStage({ executionPhase: "saving", hasProviderOutput: true })).toBe("result_storage");
  });
});
