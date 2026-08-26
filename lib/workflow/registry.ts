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
      version: 1,
      steps: [
        {
          key: "parse",
          type: "parse_novel",
          artifactTypes: [
            "analysis.characters",
            "analysis.locations",
            "analysis.props",
            "prompt.trace",
          ],
          retryable: true,
          maxAttempts: 3,
        },
        {
          key: "split",
          type: "split_clips",
          dependsOn: ["parse"],
          artifactTypes: ["clips.split", "prompt.trace"],
          retryable: true,
          maxAttempts: 3,
        },
        {
          key: "screenplay",
          type: "convert_screenplay",
          dependsOn: ["split"],
          artifactTypes: ["screenplay.clip", "prompt.trace"],
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
