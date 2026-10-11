import type { MediaTaskKind } from "@/lib/media/task-contract";

import type {
  StudioLocale,
  StudioMediaTask,
  WorkflowStepSummary,
} from "./types";

const labels = {
  "zh-CN": {
    workflows: {
      "asset-visual-design": "AI 视觉设计",
      "character-reference-extraction": "AI 角色参考识别",
      "episode-adaptation": "AI 整集改编设计",
      "episode-preproduction": "本集前期制作",
      "episode-split-planning": "AI 分集规划",
      "manuscript-analysis": "原著改编资料",
      "original-episode-generation": "原创后续集续写",
      "storyboard-prompt-design": "AI 分镜提示设计",
      "voice-performance-design": "AI 配音设计",
      "voice-analysis": "台词分析",
      "visual-asset-extraction": "AI 视觉资产识别",
      "story-to-script": "场次与资产归位",
      "script-to-storyboard": "分镜生成",
    },
    steps: {
      adapt_episode: "创作完整制作剧本",
      design_asset_visual: "生成资产视觉设定",
      extract_character_reference: "提取角色外观描述",
      plan_episode_split: "规划剧集边界",
      analyze_manuscript: "分段提取并汇总原著资料",
      generate_original_episode: "沿用全剧规划续写本集",
      design_storyboard_media_prompt: "设计镜头提示词",
      design_voice_performance: "设计角色声线与表演",
      analyze_episode_voice: "提取台词与说话人",
      extract_visual_assets: "识别角色、场景与道具",
      analyze_novel: "角色、场景与道具识别",
      organize_production_script: "归位场次与本集资产",
      build_scene_storyboard: "镜头规划与制作",
      screenplay_beats: "场次与动作归位",
      generate_screenplay_beats: "场次与动作归位",
      screenplay_dialogue: "对白归位",
      generate_screenplay_dialogue: "对白归位",
      screenplay_narration: "旁白归位",
      generate_screenplay_narration: "旁白归位",
      screenplay_effects: "动作与特效归位",
      generate_screenplay_effects: "动作与特效归位",
      assemble_screenplay: "结构化剧本合成",
      parse: "角色、场景与道具识别",
      parse_novel: "角色、场景与道具识别",
      screenplay: "剧本转换",
      split: "按场次拆分",
      split_clips: "按场次拆分",
      storyboard: "镜头规划",
      voice: "分析台词",
    },
    tasks: {
      episode_audio: "整集音轨",
      global_voice_design: "音色设计",
      lip_sync: "口型同步",
      project_asset: "项目素材",
      storyboard_panel: "分镜素材",
      voice_line: "台词语音",
    },
    kinds: {
      audio: "音频",
      image: "图片",
      lipsync: "口型视频",
      video: "视频",
      voicedesign: "音色",
    },
    generationTask: "生成任务",
  },
  en: {
    workflows: {
      "asset-visual-design": "AI visual design",
      "character-reference-extraction": "AI character reference extraction",
      "episode-adaptation": "AI episode production design",
      "episode-preproduction": "Episode preproduction",
      "episode-split-planning": "AI episode planning",
      "manuscript-analysis": "Source adaptation dossier",
      "original-episode-generation": "Original episode continuation",
      "storyboard-prompt-design": "AI storyboard prompt design",
      "voice-performance-design": "AI voice design",
      "voice-analysis": "Dialogue analysis",
      "visual-asset-extraction": "AI visual asset extraction",
      "story-to-script": "Scene and asset placement",
      "script-to-storyboard": "Storyboard generation",
    },
    steps: {
      adapt_episode: "Write full production script",
      design_asset_visual: "Design asset visual",
      extract_character_reference: "Extract character appearance",
      plan_episode_split: "Plan episode boundaries",
      analyze_manuscript: "Extract and merge source notes",
      generate_original_episode: "Write episode from the adopted series plan",
      design_storyboard_media_prompt: "Design shot prompt",
      design_voice_performance: "Design voices and delivery",
      analyze_episode_voice: "Extract dialogue and speakers",
      extract_visual_assets: "Identify characters, locations, and props",
      analyze_novel: "Identify characters, locations, and props",
      organize_production_script: "Place scenes and episode assets",
      build_scene_storyboard: "Shot planning and production",
      screenplay_beats: "Place scenes and action",
      generate_screenplay_beats: "Place scenes and action",
      screenplay_dialogue: "Place dialogue",
      generate_screenplay_dialogue: "Place dialogue",
      screenplay_narration: "Place narration",
      generate_screenplay_narration: "Place narration",
      screenplay_effects: "Place action and effects",
      generate_screenplay_effects: "Place action and effects",
      assemble_screenplay: "Assemble structured screenplay",
      parse: "Identify characters, locations, and props",
      parse_novel: "Identify characters, locations, and props",
      screenplay: "Convert screenplay",
      split: "Split approved scenes",
      split_clips: "Split approved scenes",
      storyboard: "Build storyboard",
      voice: "Analyze dialogue",
    },
    tasks: {
      episode_audio: "Episode mix",
      global_voice_design: "Voice design",
      lip_sync: "Lip sync",
      project_asset: "Project media",
      storyboard_panel: "Shot media",
      voice_line: "Dialogue audio",
    },
    kinds: {
      audio: "Audio",
      image: "Image",
      lipsync: "Lip sync",
      video: "Video",
      voicedesign: "Voice",
    },
    generationTask: "Generation task",
  },
} as const;

export function workflowLabel(locale: StudioLocale, value: string) {
  return (
    lookup(labels[locale].workflows, value) ?? labels[locale].generationTask
  );
}

export function workflowStepLabel(locale: StudioLocale, value: string) {
  return lookup(labels[locale].steps, value) ?? labels[locale].generationTask;
}

export function mediaTaskLabel(
  locale: StudioLocale,
  targetType: string | undefined,
  kind: MediaTaskKind,
) {
  const target = targetType
    ? lookup(labels[locale].tasks, targetType)
    : undefined;
  const kindLabel = lookup(labels[locale].kinds, kind);
  if (targetType === "storyboard_panel" && kindLabel)
    return locale === "en"
      ? `${kindLabel} · ${target}`
      : `${target}${kindLabel}`;
  return target ?? kindLabel ?? labels[locale].generationTask;
}

export function workflowStepOperationLabel(
  locale: StudioLocale,
  workflowType: string,
  step: Pick<WorkflowStepSummary, "key" | "type">,
  targetName?: string,
) {
  if (workflowType === "asset-visual-design" && targetName)
    return `${workflowLabel(locale, workflowType)}-${targetName}`;
  const stepLabel = workflowStepLabel(locale, step.type || step.key);
  const department =
    workflowType === "story-to-script"
      ? step.type === "parse_novel" || step.key === "analyze_novel"
        ? "AI"
        : locale === "zh-CN"
          ? "本地"
          : "Local"
      : workflowType === "script-to-storyboard"
        ? locale === "zh-CN"
          ? "分镜"
          : "Storyboard"
        : workflowLabel(locale, workflowType);
  return `${department}-${stepLabel}`;
}

export function mediaTaskOperationLabel(
  locale: StudioLocale,
  task: StudioMediaTask,
) {
  const isZh = locale === "zh-CN";
  const action =
    task.kind === "image"
      ? isZh
        ? "图片生成"
        : "Image generation"
      : task.kind === "video"
        ? isZh
          ? "视频生成"
          : "Video generation"
        : task.kind === "audio"
          ? isZh
            ? "音频生成"
            : "Audio generation"
          : isZh
            ? "口型生成"
            : "Lip sync";
  const index = task.displayIndex
    ? String(task.displayIndex).padStart(2, "0")
    : "";
  if (task.targetType === "character_appearance" && task.displayName)
    return isZh
      ? `角色-${task.displayName}-素材生成`
      : `Character-${task.displayName}-Asset generation`;
  if (task.targetType === "location_image" && task.displayName)
    return isZh
      ? `场景-${task.displayName}-素材生成`
      : `Location-${task.displayName}-Asset generation`;
  if (task.targetType === "prop" && task.displayName)
    return isZh
      ? `道具-${task.displayName}-素材生成`
      : `Prop-${task.displayName}-Asset generation`;
  if (task.targetType === "storyboard_panel" && index)
    return isZh
      ? `分镜-镜头 ${index}-${action}`
      : `Storyboard-Shot ${index}-${action}`;
  if (task.targetType === "voice_line")
    return isZh
      ? `声音-${task.displayName || "台词"}${index ? ` ${index}` : ""}-${action}`
      : `Audio-${task.displayName || "Line"}${index ? ` ${index}` : ""}-${action}`;
  return mediaTaskLabel(locale, task.targetType, task.kind);
}

function lookup<T extends Record<string, string>>(values: T, key: string) {
  return values[key as keyof T];
}
