import type { WorkflowStepInput } from "./contract";

export type WorkflowTemplate = {
  type: string;
  version: number;
  steps: WorkflowStepInput[];
};

const templates = new Map<string, WorkflowTemplate>([
  [
    "story-to-script",
    {
      type: "story-to-script",
      version: 3,
      steps: [
        {
          key: "organize_production_script",
          type: "organize_production_script",
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
        },
      ],
    },
  ],
  [
    "script-to-storyboard",
    {
      type: "script-to-storyboard",
      version: 3,
      steps: [
        {
          key: "build_scene_storyboard",
          type: "build_scene_storyboard",
          artifactTypes: ["storyboard.scenes", "storyboard.director.scene"],
          retryable: true,
          maxAttempts: 3,
        },
      ],
    },
  ],
  [
    "episode-preproduction",
    {
      type: "episode-preproduction",
      version: 1,
      steps: [
        {
          key: "organize_production_script",
          type: "organize_production_script",
          artifactTypes: [
            "production-script.organization",
            "production-script.organization.raw",
            "production-script.catalog",
            "production-script.scenes",
            "clips.split",
            "screenplay.clip",
            "prompt.trace",
          ],
          retryable: true,
          maxAttempts: 3,
        },
        {
          key: "build_scene_storyboard",
          type: "build_scene_storyboard",
          dependsOn: ["organize_production_script"],
          requiredArtifactTypes: ["production-script.scenes"],
          artifactTypes: [
            "storyboard.scenes",
            "storyboard.director.scene",
            "prompt.trace",
          ],
          retryable: true,
          maxAttempts: 3,
        },
        {
          key: "analyze_episode_voice",
          type: "analyze_episode_voice",
          dependsOn: ["build_scene_storyboard"],
          requiredArtifactTypes: ["storyboard.scenes"],
          artifactTypes: ["voice.analysis", "prompt.trace"],
          retryable: true,
          maxAttempts: 3,
        },
        {
          key: "design_voice_performance",
          type: "design_voice_performance",
          dependsOn: ["analyze_episode_voice"],
          requiredArtifactTypes: ["voice.analysis"],
          artifactTypes: [
            "voice.performance-design",
            "voice.performance-design.raw",
            "prompt.trace",
          ],
          retryable: true,
          maxAttempts: 3,
        },
      ],
    },
  ],
]);

export function getWorkflowTemplate(workflowType: string) {
  const template = templates.get(workflowType.trim());
  return template ? cloneTemplate(template) : null;
}

export function listWorkflowTemplates() {
  return Array.from(templates.values(), cloneTemplate);
}

function cloneTemplate(template: WorkflowTemplate): WorkflowTemplate {
  return {
    ...template,
    steps: template.steps.map((step) => ({
      ...step,
      dependsOn: step.dependsOn ? [...step.dependsOn] : undefined,
      artifactTypes: step.artifactTypes ? [...step.artifactTypes] : undefined,
      requiredArtifactTypes: step.requiredArtifactTypes
        ? [...step.requiredArtifactTypes]
        : undefined,
      input: step.input ? { ...step.input } : undefined,
    })),
  };
}
