import { describe, expect, it } from "vitest";

import { buildActiveWorkflowDedupeKey } from "./store";

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
