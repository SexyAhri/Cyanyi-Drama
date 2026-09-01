import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { createOrReuseWorkflowRun } from "@/lib/workflow/store";

import type { VisualDesignTargetType } from "./visual-design";

export async function createAssetVisualDesignWorkflow(input: {
  userId: string;
  projectId: string;
  targetType: VisualDesignTargetType;
  targetId: string;
  channelId: string;
  model: string;
  locale: "en" | "zh";
}) {
  const workflowInput = {
    channelId: input.channelId,
    model: input.model,
    targetType: input.targetType,
    targetId: input.targetId,
    locale: input.locale,
  };
  const runtimeSettings = await loadUserRuntimeSettings(input.userId);
  const result = await createOrReuseWorkflowRun({
    id: `workflow_${crypto.randomUUID()}`,
    userId: input.userId,
    projectId: input.projectId,
    workflowType: "asset-visual-design",
    targetType: input.targetType,
    targetId: input.targetId,
    input: workflowInput,
    steps: [
      {
        key: "design_asset_visual",
        type: "design_asset_visual",
        artifactTypes: ["asset.visual-profile", "prompt.trace"],
        input: workflowInput,
        retryable: true,
        maxAttempts: runtimeSettings.workflowStepMaxAttempts,
      },
    ],
    maxAttempts: runtimeSettings.workflowStepMaxAttempts,
  });
  if (result && !result.reused)
    await enqueueWorkflowJob({
      runId: result.workflow.id,
      userId: input.userId,
      projectId: input.projectId,
      maxAttempts: 1,
    });
  return result;
}
