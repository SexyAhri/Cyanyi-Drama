import type { ModelCapabilities } from "@/lib/agent/provider-types";

export const AGNES_AI_BASE_URL = "https://api.agnes-ai.cn/v1";

export const AGNES_AI_MODELS = [
  {
    id: "agnes-3.0-flash",
    modelId: "agnes-3.0-flash",
    name: "Agnes 3.0 Flash",
    type: "llm",
    protocol: "openai-compatible",
    capabilities: {
      modalities: ["text"],
      supportsToolCalling: true,
      supportsStructuredOutputs: false,
      supportsReasoning: false,
      supportsAsync: false,
      supportsReferenceImages: true,
      supportsReferenceVideo: false,
      supportsReferenceAudio: false,
    },
  },
  {
    id: "agnes-image-2.5-flash",
    modelId: "agnes-image-2.5-flash",
    name: "Agnes Image 2.5 Flash",
    type: "image",
    protocol: "openai-compatible",
    capabilities: {
      modalities: ["image"],
      supportsToolCalling: false,
      supportsStructuredOutputs: false,
      supportsReasoning: false,
      supportsAsync: false,
      supportsReferenceImages: true,
      supportsReferenceVideo: false,
      supportsReferenceAudio: false,
    },
  },
  {
    id: "agnes-video-2.5-flash",
    modelId: "agnes-video-2.5-flash",
    name: "Agnes Video 2.5 Flash",
    type: "video",
    protocol: "openai-compatible",
    capabilities: {
      modalities: ["video"],
      supportsToolCalling: false,
      supportsStructuredOutputs: false,
      supportsReasoning: false,
      supportsAsync: true,
      supportsReferenceImages: true,
      supportsReferenceVideo: false,
      supportsReferenceAudio: true,
      maxDurationSeconds: 12,
      maxReferenceImages: 5,
    },
  },
] satisfies Array<{
  id: string;
  modelId: string;
  name: string;
  type: "llm" | "image" | "video";
  protocol: "openai-compatible";
  capabilities: ModelCapabilities;
}>;

