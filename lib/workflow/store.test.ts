import { describe, expect, it } from "vitest";

import {
  buildActiveWorkflowDedupeKey,
  getStoryboardPhaseInvalidation,
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

describe("storyboard phase invalidation", () => {
  it("invalidates only the selected branch and its downstream phases", () => {
    expect(getStoryboardPhaseInvalidation("phase2.cine")).toEqual({
      artifactTypes: [
        "storyboard.clip.phase2.cine",
        "storyboard.clip.phase3",
        "storyboard.clip.continuity",
      ],
      tracePhases: ["phase2.cine", "phase3", "continuity"],
    });
    expect(getStoryboardPhaseInvalidation("phase2.acting")).toEqual({
      artifactTypes: [
        "storyboard.clip.phase2.acting",
        "storyboard.clip.phase3",
        "storyboard.clip.continuity",
      ],
      tracePhases: ["phase2.acting", "phase3", "continuity"],
    });
  });

  it("keeps continuity retries isolated", () => {
    expect(getStoryboardPhaseInvalidation("continuity")).toEqual({
      artifactTypes: ["storyboard.clip.continuity"],
      tracePhases: ["continuity"],
    });
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
