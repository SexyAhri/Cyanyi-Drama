import type { MediaTaskKind } from "@/lib/media/task-contract";

import type {
  StudioLocale,
  StudioMediaTask,
  WorkflowStepSummary,
} from "./types";

const labels = {
  "zh-CN": {
    workflows: {
      "story-to-script": "剧本解析",
      "script-to-storyboard": "分镜生成",
    },
    steps: {
      analyze_novel: "小说解析",
      build_storyboard: "镜头规划",
      convert_screenplay: "剧本转换",
      parse: "小说解析",
      parse_novel: "小说解析",
      screenplay: "剧本转换",
      split: "剧情分片",
      split_clips: "剧情分片",
      storyboard: "镜头规划",
      voice: "分析台词",
      voice_analyze: "分析台词",
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
      "story-to-script": "Script analysis",
      "script-to-storyboard": "Storyboard generation",
    },
    steps: {
      analyze_novel: "Analyze source",
      build_storyboard: "Build storyboard",
      convert_screenplay: "Convert screenplay",
      parse: "Analyze source",
      parse_novel: "Analyze source",
      screenplay: "Convert screenplay",
      split: "Split story",
      split_clips: "Split story",
      storyboard: "Build storyboard",
      voice: "Analyze dialogue",
      voice_analyze: "Analyze dialogue",
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
  return lookup(labels[locale].workflows, value) ?? labels[locale].generationTask;
}

export function workflowStepLabel(locale: StudioLocale, value: string) {
  return lookup(labels[locale].steps, value) ?? labels[locale].generationTask;
}

export function mediaTaskLabel(
  locale: StudioLocale,
  targetType: string | undefined,
  kind: MediaTaskKind,
) {
  const target = targetType ? lookup(labels[locale].tasks, targetType) : undefined;
  const kindLabel = lookup(labels[locale].kinds, kind);
  if (targetType === "storyboard_panel" && kindLabel)
    return locale === "en" ? `${kindLabel} · ${target}` : `${target}${kindLabel}`;
  return target ?? kindLabel ?? labels[locale].generationTask;
}

export function workflowStepOperationLabel(
  locale: StudioLocale,
  workflowType: string,
  step: Pick<WorkflowStepSummary, "key" | "type">,
) {
  const stepLabel = workflowStepLabel(locale, step.type || step.key);
  const department =
    step.type === "voice_analyze" || step.key === "voice"
      ? locale === "zh-CN"
        ? "声音"
        : "Audio"
      : workflowType === "story-to-script"
        ? locale === "zh-CN"
          ? "编剧"
          : "Writing"
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
