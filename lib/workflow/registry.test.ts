import { describe, expect, it } from "vitest";

import { getWorkflowTemplate } from "./registry";

describe("workflow registry", () => {
  it("defines the recoverable Story-to-Script dependency chain", () => {
    const template = getWorkflowTemplate("story-to-script");

    expect(template?.steps.map((step) => step.key)).toEqual([
      "parse",
      "split",
      "screenplay_beats",
      "screenplay_dialogue",
      "screenplay_narration",
      "screenplay_effects",
      "assemble_screenplay",
    ]);
    expect(template?.steps[1]).toMatchObject({
      dependsOn: ["parse"],
      artifactTypes: ["clips.split", "prompt.trace"],
      retryable: true,
      maxAttempts: 3,
    });
    expect(template?.steps[2]).toMatchObject({
      dependsOn: ["split"],
      artifactTypes: [
        "screenplay.beats",
        "screenplay.beats.raw",
        "prompt.trace",
      ],
      retryable: true,
      maxAttempts: 3,
    });
    expect(template?.steps[6]).toMatchObject({
      dependsOn: ["screenplay_effects"],
      artifactTypes: [
        "screenplay.scene",
        "screenplay.clip",
      ],
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
