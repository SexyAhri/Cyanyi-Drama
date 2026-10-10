import { resolveEpisodeTextProvider } from "@/lib/episodes/provider";
import { createAssetVisualDesignWorkflow } from "@/lib/assets/visual-design-workflow";
import { prisma } from "@/lib/server/prisma";
import { createOrReuseWorkflowRun } from "@/lib/workflow/store";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";

export const STUDIO_PRODUCTION_OPERATIONS = [
  "start_script_organization",
  "start_storyboard_generation",
  "start_voice_analysis",
  "start_voice_design",
  "start_episode_adaptation",
  "start_asset_visual_design",
] as const;
export type StudioProductionOperation =
  (typeof STUDIO_PRODUCTION_OPERATIONS)[number];
export function isProductionOperation(
  value: string,
): value is StudioProductionOperation {
  return (STUDIO_PRODUCTION_OPERATIONS as readonly string[]).includes(value);
}

const episodeFlows = {
  start_script_organization: {
    type: "story-to-script",
    step: "organize_production_script",
    artifacts: [
      "production-script.organization",
      "production-script.organization.raw",
      "production-script.catalog",
      "production-script.scenes",
      "clips.split",
      "screenplay.clip",
      "prompt.trace",
    ],
  },
  start_storyboard_generation: {
    type: "script-to-storyboard",
    step: "build_scene_storyboard",
    artifacts: [
      "storyboard.scenes",
      "storyboard.director.scene",
      "prompt.trace",
    ],
  },
  start_voice_analysis: {
    type: "voice-analysis",
    step: "analyze_episode_voice",
    artifacts: ["voice.analysis", "prompt.trace"],
  },
  start_voice_design: {
    type: "voice-performance-design",
    step: "design_voice_performance",
    artifacts: [
      "voice.performance-design",
      "voice.performance-design.raw",
      "prompt.trace",
    ],
  },
  start_episode_adaptation: {
    type: "episode-adaptation",
    step: "adapt_episode",
    artifacts: ["adaptation.source", "prompt.trace"],
  },
} as const;

export async function startStudioProductionAction(input: {
  operation: StudioProductionOperation;
  userId: string;
  projectId: string;
  targetId: string;
  channelId: string;
  model: string;
  locale: "en" | "zh";
  assetKind?: "character" | "location" | "prop";
}) {
  await resolveEpisodeTextProvider(input);
  if (input.operation === "start_asset_visual_design") {
    if (!input.assetKind) throw new Error("资产类型缺失，请重新选择目标");
    const where = {
      id: input.targetId,
      projectId: input.projectId,
      project: { userId: input.userId },
    };
    const owned =
      input.assetKind === "character"
        ? await prisma.novelCharacter.count({ where })
        : input.assetKind === "location"
          ? await prisma.novelLocation.count({ where })
          : await prisma.novelProp.count({ where });
    if (!owned) throw new Error("所选资产不属于当前项目");
    const result = await createAssetVisualDesignWorkflow({
      ...input,
      targetType: input.assetKind,
    });
    if (!result) throw new Error("项目不存在");
    return {
      submitted: true,
      workflowId: result.workflow.id,
      status: result.workflow.status,
      reused: result.reused,
    };
  }
  const episode = await prisma.episode.findFirst({
    where: {
      id: input.targetId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
    select: {
      novelText: true,
      clips: { select: { screenplay: true } },
      voiceLines: { select: { id: true } },
    },
  });
  if (!episode) throw new Error("目标剧集不属于当前项目");
  if (!episode.novelText?.trim())
    throw new Error("本集没有生产稿，请先保存剧本");
  if (
    input.operation === "start_storyboard_generation" &&
    (!episode.clips.length || episode.clips.some((clip) => !clip.screenplay))
  )
    throw new Error("请先完成本集的 AI 场次与资产整理");
  if (input.operation === "start_voice_design" && !episode.voiceLines.length)
    throw new Error("请先完成台词分析，再设计配音");
  const settings = await loadUserRuntimeSettings(input.userId);
  const flow = episodeFlows[input.operation];
  const workflowInput = {
    channelId: input.channelId,
    model: input.model,
    locale: input.locale,
    ...(input.operation === "start_episode_adaptation"
      ? { mode: "faithful" }
      : {}),
  };
  const attempts =
    input.operation === "start_storyboard_generation"
      ? 3
      : settings.workflowStepMaxAttempts;
  const result = await createOrReuseWorkflowRun({
    id: `workflow_${crypto.randomUUID()}`,
    userId: input.userId,
    projectId: input.projectId,
    episodeId: input.targetId,
    workflowType: flow.type,
    targetType:
      input.operation === "start_voice_design"
        ? "episode_voice_performance"
        : "episode",
    targetId: input.targetId,
    input: workflowInput,
    steps: [
      {
        key: flow.step,
        type: flow.step,
        input: workflowInput,
        artifactTypes: [...flow.artifacts],
        retryable: true,
        maxAttempts: attempts,
      },
    ],
    maxAttempts: attempts,
  });
  if (!result) throw new Error("项目或剧集不存在");
  if (!result.reused)
    await enqueueWorkflowJob({
      runId: result.workflow.id,
      userId: input.userId,
      projectId: input.projectId,
      maxAttempts: 1,
    });
  return {
    submitted: true,
    workflowId: result.workflow.id,
    status: result.workflow.status,
    reused: result.reused,
  };
}
