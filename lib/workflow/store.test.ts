import { describe, expect, it } from "vitest";

import {
  buildActiveWorkflowDedupeKey,
  isWorkflowStepManuallyRetryable,
  shouldPreserveRetryArtifacts,
} from "./store";

describe("workflow active dedupe key", () => {
  const input = {
    userId: "user-1",
    projectId: "project-1",
    workflowType: "novel-production",
    targetType: "episode",
    targetId: "episode-1",
  };

  it("is stable for equivalent target identities", () => {
    expect(buildActiveWorkflowDedupeKey(input)).toBe(
      buildActiveWorkflowDedupeKey({
        ...input,
        workflowType: " NOVEL-PRODUCTION ",
      }),
    );
  });

  it("changes when the workflow target changes", () => {
    expect(buildActiveWorkflowDedupeKey(input)).not.toBe(
      buildActiveWorkflowDedupeKey({ ...input, targetId: "episode-2" }),
    );
  });
});

describe("workflow step artifact preservation", () => {
  it("keeps partial artifacts when enqueue failure leaves the step pending", () => {
    expect(shouldPreserveRetryArtifacts("pending")).toBe(true);
    expect(shouldPreserveRetryArtifacts("failed")).toBe(true);
    expect(shouldPreserveRetryArtifacts("blocked")).toBe(true);
  });

  it("invalidates artifacts when explicitly rerunning a completed step", () => {
    expect(shouldPreserveRetryArtifacts("succeeded")).toBe(false);
  });
});

describe("manual workflow retry", () => {
  it("allows failed steps beyond the automatic attempt limit", () => {
    expect(
      isWorkflowStepManuallyRetryable({
        status: "failed",
        attempt: 8,
        maxAttempts: 1,
        retryable: false,
      }),
    ).toBe(true);
  });

  it("keeps the configured limit for non-failed explicit reruns", () => {
    expect(
      isWorkflowStepManuallyRetryable({
        status: "succeeded",
        attempt: 1,
        maxAttempts: 1,
        retryable: true,
      }),
    ).toBe(false);
  });
});
