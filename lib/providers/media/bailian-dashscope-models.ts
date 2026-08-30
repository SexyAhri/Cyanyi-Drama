export const BAILIAN_DASHSCOPE_BASE_URL_PLACEHOLDER =
  "https://<WorkspaceId>.cn-beijing.maas.aliyuncs.com/api/v1";

export const BAILIAN_DASHSCOPE_MODELS = [
  {
    id: "qwen-audio-3.0-tts-plus",
    name: "Qwen-Audio 3.0 TTS Plus",
    type: "audio" as const,
  },
] as const;

export function bailianDashScopeModelCapabilities(model: string) {
  if (!isQwenAudioTtsPlus(model)) return undefined;
  const modalities: Array<"audio"> = ["audio"];
  return {
    modalities,
    supportsToolCalling: false,
    supportsStructuredOutputs: false,
    supportsReasoning: false,
    supportsAsync: false,
    supportsReferenceImages: false,
    supportsReferenceVideo: false,
    supportsReferenceAudio: false,
  };
}

export function isQwenAudioTtsPlus(model: string) {
  return model.trim().toLowerCase() === "qwen-audio-3.0-tts-plus";
}
