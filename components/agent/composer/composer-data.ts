import {
  BadgeCheck,
  Clock3,
  FileImage,
  FileVideoCamera,
  ImagePlus,
  LayoutTemplate,
  Layers3,
  MessageSquare,
  Palette,
  Scan,
  Sparkles,
  Video,
} from "lucide-react";

import {
  DEFAULT_RUNTIME_SETTINGS,
  type RuntimeSettings,
} from "@/lib/settings/runtime-contract";

import type {
  AgentComposerMode,
  AgentComposerOption,
  AgentComposerReferenceImage,
  AgentComposerSettings,
  AgentComposerTemplate,
} from "./types";
import {
  inferModelCapabilities,
  type ModelCapabilities,
} from "@/lib/agent/provider-types";

type RuntimeModelOption = {
  id: string;
  name: string;
  modelId?: string;
  type?: string;
  capabilities?: ModelCapabilities;
};

export type ComposerModelOptions = {
  imageModelOptions: AgentComposerOption[];
  videoModelOptions: AgentComposerOption[];
};

const IMAGE_MODEL_KEYWORDS = [
  "gpt-image",
  "img",
  "nano-banana",
  "grok-image",
  "seedream",
  "flux",
  "midjourney",
  "stable-diffusion",
  "sdxl",
  "dall-e",
  "doubao-image",
  "recraft",
  "ideogram",
];

const VIDEO_MODEL_KEYWORDS = [
  "video",
  "seedance",
  "veo",
  "kling",
  "runway",
  "luma",
  "hailuo",
  "pixverse",
  "doubao-video",
  "wan",
  "sora",
];

export const composerModes: AgentComposerOption[] = [
  {
    id: "chat",
    label: "聊天",
    icon: MessageSquare,
  },
  {
    id: "image",
    label: "图片生成",
    icon: ImagePlus,
  },
  {
    id: "video",
    label: "视频生成",
    icon: Video,
  },
];

export const defaultImageModelOptions: AgentComposerOption[] = [];

export const defaultVideoModelOptions: AgentComposerOption[] = [];

export const ratioOptions: AgentComposerOption[] = [
  { id: "1:1", label: "1:1" },
  { id: "3:2", label: "3:2" },
  { id: "2:3", label: "2:3" },
  { id: "16:9", label: "16:9" },
  { id: "9:16", label: "9:16" },
  { id: "4:3", label: "4:3" },
  { id: "3:4", label: "3:4" },
  { id: "21:9", label: "21:9" },
];

export const imageFormatOptions: AgentComposerOption[] = [
  {
    id: "png",
    label: "PNG",
    icon: FileImage,
  },
];

export const videoFormatOptions: AgentComposerOption[] = [
  {
    id: "mp4",
    label: "MP4",
    icon: FileVideoCamera,
  },
  {
    id: "webm",
    label: "WebM",
    icon: FileVideoCamera,
  },
  {
    id: "mov",
    label: "MOV",
    icon: FileVideoCamera,
  },
];

export const imageResolutionOptions: AgentComposerOption[] = [
  {
    id: "1k",
    label: "1K",
    icon: Scan,
  },
  {
    id: "2k",
    label: "2K",
    icon: Scan,
  },
  {
    id: "4k",
    label: "4K",
    icon: Scan,
  },
];

export const videoResolutionOptions: AgentComposerOption[] = [
  {
    id: "720p",
    label: "720p",
    icon: Scan,
  },
  {
    id: "1080p",
    label: "1080p",
    icon: Scan,
  },
  {
    id: "2k",
    label: "2K",
    icon: Scan,
  },
  {
    id: "4k",
    label: "4K",
    icon: Scan,
  },
];

export const imageCountOptions: AgentComposerOption[] = [1, 2, 3, 4].map(
  (count) => ({
    id: String(count),
    label: `${count} 张`,
    icon: Layers3,
  }),
);

export const imageQualityOptions: AgentComposerOption[] = [
  { id: "auto", label: "自动质量", icon: BadgeCheck },
  { id: "high", label: "高清", icon: BadgeCheck },
];

export const styleOptions: AgentComposerOption[] = [
  {
    id: "auto",
    label: "自动",
    icon: Palette,
  },
  {
    id: "photo",
    label: "写实",
    icon: Palette,
  },
  {
    id: "illustration",
    label: "插画",
    icon: Palette,
  },
  {
    id: "product",
    label: "产品图",
    icon: Palette,
  },
];

export const fallbackComposerTemplates: AgentComposerTemplate[] = [
  {
    id: "summer-poster",
    title: "夏日绘本",
    description: "清爽插画海报",
    imageUrl:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=720&q=80",
    ratio: "4:3",
    style: "illustration",
  },
  {
    id: "cat-painting",
    title: "油画猫咪",
    description: "厚涂动物头像",
    imageUrl:
      "https://images.unsplash.com/photo-1518791841217-8f162f1e1131?auto=format&fit=crop&w=720&q=80",
    ratio: "1:1",
    style: "illustration",
  },
  {
    id: "soft-flower",
    title: "柔焦花束",
    description: "温柔虚化背景",
    imageUrl:
      "https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=720&q=80",
    ratio: "3:4",
    style: "photo",
  },
  {
    id: "quote-card",
    title: "文字卡片",
    description: "社媒封面排版",
    imageUrl:
      "https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=720&q=80",
    ratio: "3:4",
    style: "product",
  },
  {
    id: "brand-grid",
    title: "品牌九宫格",
    description: "图标与色卡组合",
    imageUrl:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=720&q=80",
    ratio: "1:1",
    style: "product",
  },
  {
    id: "orange-cat",
    title: "阳光猫咪",
    description: "明亮窗边插画",
    imageUrl:
      "https://images.unsplash.com/photo-1573865526739-10659fec78a5?auto=format&fit=crop&w=720&q=80",
    ratio: "4:3",
    style: "illustration",
  },
  {
    id: "study-poster",
    title: "学习海报",
    description: "醒目中文排版",
    imageUrl:
      "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=720&q=80",
    ratio: "1:1",
    style: "product",
  },
  {
    id: "floral-card",
    title: "复古花草",
    description: "装饰卡片风格",
    imageUrl:
      "https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=720&q=80",
    ratio: "3:4",
    style: "illustration",
  },
];

export const durationOptions: AgentComposerOption[] = [
  {
    id: "5s",
    label: "5s",
    icon: Clock3,
  },
  {
    id: "10s",
    label: "10s",
    icon: Clock3,
  },
];

export const templateOptions: AgentComposerOption[] = [
  {
    id: "none",
    label: "模板",
    icon: LayoutTemplate,
  },
];

export function resolveComposerModelOptions(
  models: RuntimeModelOption[] = [],
): ComposerModelOptions {
  const imageModelOptions = getComposerModelOptionsByKeywords(
    models,
    IMAGE_MODEL_KEYWORDS,
  );
  const videoModelOptions = getComposerModelOptionsByKeywords(
    models,
    VIDEO_MODEL_KEYWORDS,
  );

  // A missing media capability should result in an empty selector. The
  // conversation model must never be silently reused for media generation.
  return {
    imageModelOptions,
    videoModelOptions,
  };
}

export function normalizeComposerSettings(
  settings: AgentComposerSettings,
  modelOptions: Partial<ComposerModelOptions> = {},
): AgentComposerSettings {
  const imageModelOptions = modelOptions.imageModelOptions ?? [];
  const videoModelOptions = modelOptions.videoModelOptions ?? [];

  const imageRatio = settings.imageRatio || "1:1";
  const imageResolution = settings.imageResolution || "1k";
  const videoRatio = settings.videoRatio || "16:9";
  const videoResolution = settings.videoResolution || "1080p";
  const videoDuration = settings.videoDuration || settings.duration || "10s";

  return setComposerMode({
    ...settings,
    referenceImages: normalizeReferenceImages(
      settings.referenceImages,
      settings.referenceImage,
    ),
    imageModel: resolveSelectedModelId(settings.imageModel, imageModelOptions),
    imageRatio,
    imageResolution,
    imageCount: normalizeImageCount(settings.imageCount),
    imageQuality: imageQualityOptions.some(
      (option) => option.id === settings.imageQuality,
    )
      ? settings.imageQuality
      : "high",
    imageFormat: imageFormatOptions[0].id,
    videoModel: resolveSelectedModelId(settings.videoModel, videoModelOptions),
    videoRatio,
    videoResolution,
    videoDuration,
  }, settings.mode);
}

export function createDefaultComposerSettings(
  modelOptions: Partial<ComposerModelOptions> = {},
  runtimeSettings: RuntimeSettings = DEFAULT_RUNTIME_SETTINGS,
): AgentComposerSettings {
  return normalizeComposerSettings(
    {
      mode: "chat",
      imageModel: "",
      videoModel: "",
      ratio: runtimeSettings.imageGenerationRatio,
      resolution: runtimeSettings.imageGenerationResolution,
      imageRatio: runtimeSettings.imageGenerationRatio,
      imageResolution: runtimeSettings.imageGenerationResolution,
      imageCount: runtimeSettings.imageGenerationCount,
      imageQuality: runtimeSettings.imageGenerationQuality,
      videoRatio: runtimeSettings.videoGenerationRatio,
      videoResolution: runtimeSettings.videoGenerationResolution,
      videoDuration: runtimeSettings.videoGenerationDuration,
      imageFormat: imageFormatOptions[0].id,
      videoFormat: videoFormatOptions[0].id,
      style: "auto",
      duration: runtimeSettings.videoGenerationDuration,
      template: "none",
      templatePrompt: undefined,
      referenceImages: [],
      referenceImage: undefined,
    },
    modelOptions,
  );
}

export function applyRuntimeSettingsToComposer(
  settings: AgentComposerSettings,
  runtimeSettings: RuntimeSettings,
  modelOptions: Partial<ComposerModelOptions> = {},
) {
  return normalizeComposerSettings(
    {
      ...settings,
      imageRatio: runtimeSettings.imageGenerationRatio,
      imageResolution: runtimeSettings.imageGenerationResolution,
      imageCount: runtimeSettings.imageGenerationCount,
      imageQuality: runtimeSettings.imageGenerationQuality,
      videoRatio: runtimeSettings.videoGenerationRatio,
      videoResolution: runtimeSettings.videoGenerationResolution,
      videoDuration: runtimeSettings.videoGenerationDuration,
    },
    modelOptions,
  );
}

export function setComposerMode(
  settings: AgentComposerSettings,
  mode: AgentComposerMode,
): AgentComposerSettings {
  if (mode === "image") {
    return {
      ...settings,
      mode,
      ratio: settings.imageRatio,
      resolution: settings.imageResolution,
    };
  }

  if (mode === "video") {
    return {
      ...settings,
      mode,
      ratio: settings.videoRatio,
      resolution: settings.videoResolution,
      duration: settings.videoDuration,
    };
  }

  return { ...settings, mode };
}

function normalizeImageCount(value: number) {
  return Number.isInteger(value) ? Math.min(4, Math.max(1, value)) : 1;
}

function normalizeReferenceImages(
  referenceImages?: AgentComposerReferenceImage[],
  legacyReferenceImage?: AgentComposerReferenceImage,
) {
  const candidates = [
    ...(referenceImages ?? []),
    ...(legacyReferenceImage ? [legacyReferenceImage] : []),
  ];
  const seen = new Set<string>();

  return candidates.filter((referenceImage) => {
    const url = referenceImage?.url?.trim();

    if (!url || seen.has(url)) {
      return false;
    }

    seen.add(url);
    return true;
  });
}

export function isAgentComposerMode(value: string): value is AgentComposerMode {
  return composerModes.some((mode) => mode.id === value);
}

function getComposerModelOptionsByKeywords(
  models: RuntimeModelOption[],
  keywords: string[],
) {
  return dedupeComposerOptions(
    models
      .filter((model) => matchesModelKeywords(model, keywords))
      .map((model) => ({
        id: model.id,
        label: model.name,
        icon: Sparkles,
      })),
  );
}

function matchesModelKeywords(model: RuntimeModelOption, keywords: string[]) {
  const searchableText = `${model.id} ${model.modelId ?? ""} ${model.name}`
    .trim()
    .toLowerCase();
  const inferredCapabilities = inferModelCapabilities(
    model.modelId || model.id,
  ).modalities;
  const declaredCapabilities = model.capabilities?.modalities ?? [];
  const capabilities = new Set([
    ...inferredCapabilities,
    ...declaredCapabilities,
  ]);
  if (model.type === "image" || model.type === "video") {
    capabilities.add(model.type);
  }

  const targetCapability =
    keywords === IMAGE_MODEL_KEYWORDS ? "image" : "video";
  if (declaredCapabilities.length > 0) {
    return capabilities.has(targetCapability);
  }
  if (keywords === IMAGE_MODEL_KEYWORDS && capabilities.has("image")) {
    return true;
  }
  if (keywords === VIDEO_MODEL_KEYWORDS && capabilities.has("video")) {
    return true;
  }

  return keywords.some((keyword) => searchableText.includes(keyword));
}

function dedupeComposerOptions(options: AgentComposerOption[]) {
  const seen = new Set<string>();

  return options.filter((option) => {
    if (seen.has(option.id)) {
      return false;
    }

    seen.add(option.id);
    return true;
  });
}

function resolveSelectedModelId(
  currentModelId: string,
  options: AgentComposerOption[],
) {
  if (options.some((option) => option.id === currentModelId)) {
    return currentModelId;
  }

  return options[0]?.id ?? currentModelId;
}
