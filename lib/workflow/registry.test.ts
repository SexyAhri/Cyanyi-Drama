import { describe, expect, it } from "vitest";

import { getWorkflowTemplate } from "./registry";

describe("workflow registry", () => {
  it("keeps the shipped graph and independent template copies", () => {
    const template = getWorkflowTemplate("episode-preproduction")!;
    expect(template.steps[1].dependsOn).toEqual(["organize_production_script"]);
    expect(template.steps[1].requiredArtifactTypes).toEqual(["production-script.scenes"]);
    template.steps[1].dependsOn?.push("changed");
    expect(getWorkflowTemplate("episode-preproduction")!.steps[1].dependsOn).toEqual(["organize_production_script"]);
  });
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
        "production-script.organization",
        "production-script.organization.raw",
        "prompt.trace",
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
      artifactTypes: ["storyboard.scenes", "storyboard.director.scene"],
      retryable: true,
      maxAttempts: 3,
    });
  });
});
