import { describe, expect, it } from "vitest";

import { getWorkflowTemplate } from "./registry";

describe("workflow registry", () => {
  it("organizes an approved production script in one local step", () => {
    const template = getWorkflowTemplate("story-to-script");

    expect(template?.steps.map((step) => step.key)).toEqual([
      "organize_production_script",
    ]);
    expect(template?.steps[0]).toMatchObject({
      artifactTypes: [
        "production-script.catalog",
        "production-script.scenes",
        "clips.split",
        "screenplay.clip",
      ],
      retryable: true,
      maxAttempts: 3,
    });
  });

  it("defines the phased Script-to-Storyboard dependency chain", () => {
    const template = getWorkflowTemplate("script-to-storyboard");

    expect(template?.steps.map((step) => step.key)).toEqual([
      "storyboard",
      "voice",
    ]);
    expect(template?.steps[0]).toMatchObject({
      artifactTypes: [
        "storyboard.clip.phase1",
        "storyboard.clip.phase2.cine",
        "storyboard.clip.phase2.acting",
        "storyboard.clip.phase3",
        "storyboard.clip.continuity",
        "prompt.trace",
      ],
      retryable: true,
      maxAttempts: 3,
    });
    expect(template?.steps[1]).toMatchObject({
      dependsOn: ["storyboard"],
      artifactTypes: ["voice.lines", "prompt.trace"],
    });
  });
});
