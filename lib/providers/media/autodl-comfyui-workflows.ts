export type AutoDlWorkflowKind =
  | "text-video"
  | "reference-video"
  | "first-last-video"
  | "audio-reference-video"
  | "image-audio-video"
  | "tts";

export type AutoDlWorkflowDefinition = {
  id: string;
  name: string;
  type: "video" | "audio" | "lipsync";
  modalities: Array<"video" | "audio" | "lipsync">;
  kind: AutoDlWorkflowKind;
  maxDurationSeconds?: number;
  maxReferenceImages?: number;
  maxReferenceAudios?: number;
  resolutions?: Array<"480p" | "768p" | "1080p">;
  square?: boolean;
  /** The workflow emits an audio track as part of the generated MP4. */
  generatesNativeAudio?: boolean;
};

export const AUTODL_COMFYUI_BASE_URL = "https://autodl.art/api/v1";

export const AUTODL_COMFYUI_WORKFLOWS: AutoDlWorkflowDefinition[] = [
  {
    id: "minimax_h3_lightx2v_no_pic",
    name: "MiniMax H3 文生视频",
    type: "video",
    modalities: ["video"],
    kind: "text-video",
    maxDurationSeconds: 15,
    resolutions: ["480p", "768p"],
    square: true,
    generatesNativeAudio: true,
  },
  {
    id: "minimax_h3_lightx2v",
    name: "MiniMax H3 首尾帧视频",
    type: "video",
    modalities: ["video"],
    kind: "first-last-video",
    maxDurationSeconds: 15,
    maxReferenceImages: 2,
    resolutions: ["480p", "768p"],
    generatesNativeAudio: true,
  },
  {
    id: "minimax_h3_lightx2v_v5",
    name: "MiniMax H3 多图参考视频",
    type: "video",
    modalities: ["video"],
    kind: "reference-video",
    maxDurationSeconds: 10,
    maxReferenceImages: 9,
    resolutions: ["480p", "768p", "1080p"],
    square: true,
    generatesNativeAudio: true,
  },
  {
    id: "minimax_h3_lightx2v_v5_15s",
    name: "MiniMax H3 多图参考视频 15 秒",
    type: "video",
    modalities: ["video"],
    kind: "reference-video",
    maxDurationSeconds: 15,
    maxReferenceImages: 9,
    resolutions: ["480p", "768p"],
    square: true,
    generatesNativeAudio: true,
  },
  {
    id: "minimax_h3_image_audio_to_video_v2",
    name: "MiniMax H3 多图多音频视频",
    type: "video",
    modalities: ["video"],
    kind: "audio-reference-video",
    maxDurationSeconds: 10,
    maxReferenceImages: 9,
    maxReferenceAudios: 3,
    resolutions: ["480p", "768p", "1080p"],
    generatesNativeAudio: true,
  },
  {
    id: "minimax_h3_image_audio_to_video_v2_15s",
    name: "MiniMax H3 多图多音频视频 15 秒",
    type: "video",
    modalities: ["video"],
    kind: "audio-reference-video",
    maxDurationSeconds: 15,
    maxReferenceImages: 9,
    maxReferenceAudios: 3,
    resolutions: ["480p", "768p"],
    generatesNativeAudio: true,
  },
  {
    id: "minimax_h3_image_audio_to_video",
    name: "MiniMax H3 图片音频口型同步",
    type: "lipsync",
    modalities: ["lipsync", "video"],
    kind: "image-audio-video",
    maxDurationSeconds: 15,
    maxReferenceImages: 1,
    maxReferenceAudios: 1,
    resolutions: ["480p", "768p", "1080p"],
    generatesNativeAudio: true,
  },
  {
    id: "indextts2-v1",
    name: "IndexTTS2 参考音色语音",
    type: "audio",
    modalities: ["audio"],
    kind: "tts",
    maxReferenceAudios: 1,
  },
];

export function getAutoDlWorkflow(model: string) {
  return AUTODL_COMFYUI_WORKFLOWS.find((workflow) => workflow.id === model);
}

export function autoDlModelCapabilities(model: string) {
  const workflow = getAutoDlWorkflow(model);
  if (!workflow) return undefined;
  return {
    modalities: workflow.modalities,
    supportsToolCalling: false,
    supportsStructuredOutputs: false,
    supportsReasoning: false,
    supportsAsync: true,
    supportsReferenceImages: Boolean(workflow.maxReferenceImages),
    supportsReferenceVideo: false,
    supportsReferenceAudio: Boolean(workflow.maxReferenceAudios),
  };
}
