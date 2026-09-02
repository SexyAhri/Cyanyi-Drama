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

  it("builds scene storyboard cards in one local step", () => {
    const template = getWorkflowTemplate("script-to-storyboard");

    expect(template?.steps.map((step) => step.key)).toEqual([
      "build_scene_storyboard",
    ]);
    expect(template?.steps[0]).toMatchObject({
      type: "build_scene_storyboard",
      artifactTypes: ["storyboard.scenes"],
      retryable: false,
      maxAttempts: 1,
    });
  });
});
