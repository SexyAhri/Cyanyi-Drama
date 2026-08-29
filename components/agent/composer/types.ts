import type { LucideIcon } from "lucide-react";

export type AgentComposerMode = "chat" | "image" | "video";

export type AgentComposerOption = {
  description?: string;
  id: string;
  label: string;
  icon?: LucideIcon;
};

export type AgentComposerTemplate = {
  category?: string;
  id: string;
  description: string;
  imageUrl: string;
  originalImageUrl?: string;
  prompt?: string;
  promptPreview?: string;
  ratio: string;
  sourceUrl?: string;
  style?: string;
  tags?: string[];
  title: string;
};

export type AgentComposerReferenceImage = {
  url: string;
  format?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  model?: string;
  prompt?: string;
  sourceToolCallId?: string;
};

export type AgentComposerSettings = {
  mode: AgentComposerMode;
  imageModel: string;
  videoModel: string;
  ratio: string;
  resolution: string;
  imageRatio: string;
  imageResolution: string;
  imageCount: number;
  imageQuality: string;
  videoRatio: string;
  videoResolution: string;
  videoDuration: string;
  imageFormat: string;
  videoFormat: string;
  style: string;
  duration: string;
  template: string;
  templatePrompt?: string;
  referenceImages: AgentComposerReferenceImage[];
  referenceImage?: AgentComposerReferenceImage;
};

export type AgentComposerMetadata = AgentComposerSettings;
