import type { ChannelProtocol } from "@/lib/agent/provider-types";
import type { MediaAsset } from "@/lib/media/task-contract";
import type { OpenAiCompatibleMediaTemplate } from "@/lib/providers/openai-compatible-media-template";

export type MediaReferenceImage = {
  url: string;
  mimeType?: string;
  role?: "reference_image" | "first_frame" | "last_frame";
};

export type MediaReferenceAudio = {
  url: string;
  mimeType?: string;
};

export type MediaProviderRequest = {
  prompt?: string;
  ratio?: string;
  resolution?: string;
  format?: string;
  style?: string;
  count?: number;
  n?: number;
  quality?: string;
  duration?: string;
  fps?: number;
  width?: number;
  height?: number;
  aspectRatio?: string;
  imageDurationSeconds?: number;
  videoMode?: string;
  referenceImages?: MediaReferenceImage[];
  referenceAudios?: MediaReferenceAudio[];
  voice?: string;
  input?: string;
  responseFormat?: string;
  emotionPrompt?: string;
  emotionStrength?: number;
  operation?: string;
  audioAssetId?: string;
  audioMode?: "ambient_only" | "none";
  panelId?: string;
};

export type GenerateProviderMediaInput = {
  protocol: ChannelProtocol;
  providerKey: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  kind: "image" | "video" | "audio";
  request: MediaProviderRequest;
  mediaTemplate?: OpenAiCompatibleMediaTemplate;
};

export type GenerateProviderLipSyncInput = {
  protocol: ChannelProtocol;
  providerKey: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  videoUrl?: string;
  imageUrl?: string;
  audioUrl: string;
  durationSeconds?: number;
};

export type MediaProviderAdapter = {
  generate(input: GenerateProviderMediaInput): Promise<MediaAsset[]>;
  lipSync?(input: GenerateProviderLipSyncInput): Promise<MediaAsset[]>;
};
