import { describe, expect, it } from "vitest";

import { getWorkflowTemplate } from "./registry";

describe("workflow registry", () => {
  it("defines the recoverable Story-to-Script dependency chain", () => {
    const template = getWorkflowTemplate("story-to-script");

    expect(template?.steps.map((step) => step.key)).toEqual([
      "parse",
      "split",
      "screenplay",
    ]);
    expect(template?.steps[1]).toMatchObject({
      dependsOn: ["parse"],
      artifactTypes: ["clips.split", "prompt.trace"],
      retryable: true,
      maxAttempts: 3,
    });
    expect(template?.steps[2]).toMatchObject({
      dependsOn: ["split"],
      artifactTypes: ["screenplay.clip", "prompt.trace"],
      retryable: true,
      maxAttempts: 3,
    });
  });
});
