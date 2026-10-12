import { syncAdoptedPackageProduction } from "@/lib/production/story-package-production";
import { resolveEpisodeTextProvider } from "@/lib/episodes/provider";
import { startManuscriptAnalysis } from "@/lib/episodes/manuscript-analysis";
import { createAssetVisualDesignWorkflow } from "@/lib/assets/visual-design-workflow";
import { prisma } from "@/lib/server/prisma";
import { createOrReuseWorkflowRun } from "@/lib/workflow/store";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { inspectStructuredScreenplay } from "@/lib/novel/screenplay-state";
import { resolveStorySetup, resolveAdaptationOptions, type StudioProductionOptions } from "./production-input";
import {
  generateAndSaveStoryPackage,
  type StoryPackageGenerationProgress,
} from "@/lib/production/story-package-generation";

export const STUDIO_PRODUCTION_OPERATIONS = [
  "start_script_organization",
  "start_storyboard_generation",
  "start_voice_analysis",
  "start_voice_design",
  "start_episode_adaptation",
  "start_asset_visual_design",
  "start_story_package_generation",
  "start_episode_preproduction",
  "start_manuscript_analysis",
  "start_original_episode_generation",
] as const;
export type StudioProductionOperation =
  (typeof STUDIO_PRODUCTION_OPERATIONS)[number];
export function isProductionOperation(
  value: string,
): value is StudioProductionOperation {
  return (STUDIO_PRODUCTION_OPERATIONS as readonly string[]).includes(value);
}

export const episodeFlows = {
  start_original_episode_generation: { type: "original-episode-generation", step: "generate_original_episode",
    artifacts: ["original.episode", "original.visual_profiles", "original.completed", "prompt.trace"] },
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
  request?: string;
  onProgress?: (progress: StoryPackageGenerationProgress) => void;
  assetKind?: "character" | "location" | "prop";
  options?: StudioProductionOptions;
}) {
  if (input.operation === "start_manuscript_analysis") return startManuscriptAnalysis({
    ...input, manuscriptId: input.targetId,
  });
  if (input.operation === "start_story_package_generation") {
    if (input.targetId !== input.projectId)
      throw new Error("项目目标不匹配，请重新选择项目");
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        id: true,
        name: true,
        description: true,
        config: { select: { artStyle: true } },
      },
    });
    if (!project) throw new Error("项目不存在");
    const result = await generateAndSaveStoryPackage({
      userId: input.userId,
      projectId: project.id,
      channelId: input.channelId,
      model: input.model,
      locale: input.locale,
      onProgress: input.onProgress,
      setup: resolveStorySetup({ options: input.options, request: input.request,
        artStyle: project.config?.artStyle, description: project.description, projectName: project.name }),
    });
    return {
      deliverable: result.deliverable,
      episodeCount: result.storyPackage.format.episodeCount,
      firstEpisodeSceneCount: result.storyPackage.firstEpisode.scenes.length,
    };
  }
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
  return startEpisodeProductionWorkflow({ ...input, operation: input.operation });
}

export type EpisodeProductionOperation = keyof typeof episodeFlows | "start_episode_preproduction";

export async function startEpisodeProductionWorkflow(input: {
  operation: EpisodeProductionOperation;
  userId: string;
  projectId: string;
  targetId: string;
  channelId: string;
  model: string;
  locale: "en" | "zh";
  request?: string;
  options?: StudioProductionOptions;
}) {
  if (input.operation === "start_episode_preproduction") await syncAdoptedPackageProduction({
    userId: input.userId, projectId: input.projectId, episodeId: input.targetId,
  });
  await resolveEpisodeTextProvider(input);
  const episode = await prisma.episode.findFirst({
    where: {
      id: input.targetId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
    select: {
      novelText: true,
      clips: { select: { screenplay: true } },
      voiceLines: { select: { id: true, voiceProfilePrompt: true, emotionPrompt: true } },
      storyboard: { select: { id: true, status: true, panels: { select: { id: true } } } },
    },
  });
  if (!episode) throw new Error("目标剧集不属于当前项目");
  const scriptStates = episode.clips.map(clip => inspectStructuredScreenplay(clip.screenplay));
  if (input.operation !== "start_original_episode_generation" && !episode.novelText?.trim())
    throw new Error("本集没有生产稿，请先保存剧本");
  if (
    input.operation === "start_storyboard_generation" &&
    (!scriptStates.length || scriptStates.some(script => !script.structured))
  )
    throw new Error("请先完成本集的 AI 场次与资产整理");
  if (input.operation === "start_voice_design" && !episode.voiceLines.length)
    throw new Error("请先完成台词分析，再设计配音");
  if (input.operation === "start_voice_analysis" && !episode.storyboard)
    throw new Error("请先生成分镜，再分析台词");
  const active = await prisma.workflowRun.findFirst({
    where: { userId: input.userId, projectId: input.projectId, episodeId: input.targetId,
      status: { in: ["queued", "running", "canceling", "paused"] },
      workflowType: { in: ["story-to-script", "script-to-storyboard", "voice-analysis", "voice-performance-design", "episode-preproduction", "episode-adaptation", "original-episode-generation"] },
    }, select: { workflowType: true },
  });
  const requestedType = input.operation === "start_episode_preproduction" ? "episode-preproduction" : episodeFlows[input.operation].type;
  if (active && active.workflowType !== requestedType)
    throw new Error("本集已有制作任务进行中，请在任务栏完成、恢复或取消后再启动下一步");
  const settings = await loadUserRuntimeSettings(input.userId);
  const combined = input.operation === "start_episode_preproduction";
  const flow = input.operation === "start_episode_preproduction" ? episodeFlows.start_script_organization : episodeFlows[input.operation];
  const structured = scriptStates.length > 0 && scriptStates.every(script => script.structured);
  const storyboardReady = Boolean(episode.storyboard?.panels.length);
  if (combined && storyboardReady && episode.storyboard?.status === "director_review_required")
    throw new Error("已有分镜草案与提示词，请先在分镜工作台检查并确认，无需再次生成");
  const mayHaveSpeech = !structured || scriptStates.some(script => script.speechExpected);
  const sequence = combined ? [
    ...(!structured ? [episodeFlows.start_script_organization] : []),
    ...(!storyboardReady ? [episodeFlows.start_storyboard_generation] : []),
    ...(!episode.voiceLines.length && storyboardReady && mayHaveSpeech ? [episodeFlows.start_voice_analysis] : []),
    ...((mayHaveSpeech && !episode.voiceLines.length) || episode.voiceLines.some(line => !line.voiceProfilePrompt || !line.emotionPrompt) ? [episodeFlows.start_voice_design] : []),
  ] : [flow];
  if (!sequence.length) throw new Error("本集前期制作已完成，可进入镜头与配音制作");
  if (input.operation === "start_voice_design" && episode.storyboard?.status === "director_review_required")
    throw new Error("请先在分镜工作台确认导演审核，再设计配音");
  const workflowInput = {
    channelId: input.channelId,
    model: input.model,
    locale: input.locale,
    ...(input.operation === "start_original_episode_generation" ? { instructions: input.request?.slice(0, 8000) ?? "" } : {}),
    fillMissingVoiceDesign: combined || input.options?.fillMissingVoiceDesign === true,
    ...(input.operation === "start_episode_adaptation"
      ? resolveAdaptationOptions(input.options, input.request)
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
    workflowType: combined ? "episode-preproduction" : flow.type,
    targetType:
      input.operation === "start_voice_design"
        ? "episode_voice_performance"
        : "episode",
    targetId: input.targetId,
    input: workflowInput,
    steps: sequence.map((item, index, sequence) => ({
        key: item.step,
        type: item.step,
        ...(index ? { dependsOn: [sequence[index - 1].step] } : {}),
        input: workflowInput,
        artifactTypes: [...item.artifacts],
        retryable: true,
        maxAttempts: attempts,
      })),
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
    workflow: result.workflow,
    submitted: true,
    workflowId: result.workflow.id,
    status: result.workflow.status,
    reused: result.reused,
  };
}
