import {
  Clock3,
  FileImage,
  FileVideoCamera,
  ImagePlus,
  LayoutTemplate,
  MessageSquare,
  Palette,
  Scan,
  Sparkles,
  Video,
} from "lucide-react";

import type {
  AgentComposerMode,
  AgentComposerOption,
  AgentComposerReferenceImage,
  AgentComposerSettings,
  AgentComposerTemplate,
} from "./types";

type RuntimeModelOption = {
  id: string;
  name: string;
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

export const resolutionOptions: AgentComposerOption[] = [
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

  // Some OpenAI-compatible providers expose video-capable models with
  // provider-specific IDs that do not contain a recognizable video keyword.
  // Keep the selector available using the models actually returned by the API.
  const resolvedVideoModelOptions =
    videoModelOptions.length > 0
      ? videoModelOptions
      : getComposerModelOptions(models);

  return {
    imageModelOptions,
    videoModelOptions: resolvedVideoModelOptions,
  };
}

function getComposerModelOptions(models: RuntimeModelOption[]) {
  return dedupeComposerOptions(
    models.map((model) => ({
      id: model.id,
      label: model.name,
      icon: Sparkles,
    })),
  );
}

export function normalizeComposerSettings(
  settings: AgentComposerSettings,
  modelOptions: Partial<ComposerModelOptions> = {},
): AgentComposerSettings {
  const imageModelOptions = modelOptions.imageModelOptions ?? [];
  const videoModelOptions = modelOptions.videoModelOptions ?? [];

  return {
    ...settings,
    referenceImages: normalizeReferenceImages(
      settings.referenceImages,
      settings.referenceImage,
    ),
    imageModel: resolveSelectedModelId(settings.imageModel, imageModelOptions),
    imageFormat: imageFormatOptions[0].id,
    videoModel: resolveSelectedModelId(settings.videoModel, videoModelOptions),
  };
}

export function createDefaultComposerSettings(
  modelOptions: Partial<ComposerModelOptions> = {},
): AgentComposerSettings {
  return normalizeComposerSettings(
    {
      mode: "chat",
      imageModel: "",
      videoModel: "",
      ratio: "1:1",
      resolution: "1080p",
      imageFormat: imageFormatOptions[0].id,
      videoFormat: videoFormatOptions[0].id,
      style: "auto",
      duration: "10s",
      template: "none",
      templatePrompt: undefined,
      referenceImages: [],
      referenceImage: undefined,
    },
    modelOptions,
  );
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
  const searchableText = `${model.id} ${model.name}`.trim().toLowerCase();

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
