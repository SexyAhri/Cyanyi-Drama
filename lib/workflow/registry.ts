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
      input: step.input ? { ...step.input } : undefined,
    })),
  };
}
