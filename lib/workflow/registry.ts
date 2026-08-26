import type { WorkflowStepInput } from "./contract";

export type WorkflowTemplate = {
  type: string;
  version: number;
  steps: WorkflowStepInput[];
};

const templates = new Map<string, WorkflowTemplate>([
  [
    "novel_production",
    {
      type: "novel_production",
      version: 1,
      steps: [
        {
          key: "parse",
          type: "parse_novel",
          artifactTypes: [
            "novel.analysis",
            "storyboard.draft",
            "prompt.trace",
          ],
        },
        {
          key: "split",
          type: "split_clips",
          dependsOn: ["parse"],
          artifactTypes: ["clips"],
        },
        {
          key: "screenplay",
          type: "convert_screenplay",
          dependsOn: ["split"],
          artifactTypes: ["screenplay"],
        },
        {
          key: "storyboard",
          type: "build_storyboard",
          dependsOn: ["screenplay"],
          artifactTypes: ["storyboard.ready"],
        },
        {
          key: "voice",
          type: "voice_analyze",
          dependsOn: ["storyboard"],
          artifactTypes: ["voice.lines", "prompt.trace"],
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
