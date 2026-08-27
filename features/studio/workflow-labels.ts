import type { MediaTaskKind } from "@/lib/media/task-contract";

import type { StudioLocale } from "./types";

const labels = {
  "zh-CN": {
    workflows: {
      "story-to-script": "剧本解析",
      "script-to-storyboard": "分镜生成",
    },
    steps: {
      analyze_novel: "小说解析",
      build_storyboard: "生成分镜",
      convert_screenplay: "转换剧本",
      parse: "小说解析",
      parse_novel: "小说解析",
      screenplay: "转换剧本",
      split: "拆分剧情",
      split_clips: "拆分剧情",
      storyboard: "生成分镜",
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

function lookup<T extends Record<string, string>>(values: T, key: string) {
  return values[key as keyof T];
}
