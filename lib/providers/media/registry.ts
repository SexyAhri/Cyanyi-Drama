import type { ChannelProtocol } from "@/lib/agent/provider-types";
import type { MediaAsset } from "@/lib/media/task-contract";
import {
  generateSpecializedLipSync,
  supportsSpecializedLipSync,
} from "@/lib/providers/lipsync";

import { autoDlComfyUiMediaProvider } from "./autodl-comfyui";
import { bailianDashScopeMediaProvider } from "./bailian-dashscope";
import { openAiCompatibleMediaProvider } from "./openai-compatible";
import type {
  GenerateProviderLipSyncInput,
  GenerateProviderMediaInput,
  MediaProviderAdapter,
} from "./types";
import { volcengineArkMediaProvider } from "./volcengine-ark";

const providers: Partial<Record<ChannelProtocol, MediaProviderAdapter>> = {
  "openai-compatible": openAiCompatibleMediaProvider,
  "volcengine-ark": volcengineArkMediaProvider,
  "autodl-comfyui": autoDlComfyUiMediaProvider,
  "bailian-dashscope": bailianDashScopeMediaProvider,
};

export const MEDIA_CHANNEL_PROTOCOLS: ChannelProtocol[] = [
  "openai-compatible",
  "volcengine-ark",
  "autodl-comfyui",
  "bailian-dashscope",
];

export function isMediaChannelProtocol(
  value: string,
): value is ChannelProtocol {
  return MEDIA_CHANNEL_PROTOCOLS.includes(value as ChannelProtocol);
}

export async function generateProviderMedia(
  input: GenerateProviderMediaInput,
) {
  const provider = providers[input.protocol];
  if (!provider)
    throw new Error(`MEDIA_PROTOCOL_NOT_SUPPORTED:${input.protocol}`);
  return provider.generate(input);
}

export async function generateProviderLipSync(
  input: GenerateProviderLipSyncInput,
): Promise<MediaAsset[]> {
  if (supportsSpecializedLipSync(input.providerKey)) {
    if (!input.videoUrl) throw new Error("LIP_SYNC_VIDEO_MISSING");
    const result = await generateSpecializedLipSync({
      providerKey: input.providerKey,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      model: input.model,
      videoUrl: input.videoUrl,
      audioUrl: input.audioUrl,
    });
    return [
      {
        id: `lipsync-${input.model}-${Date.now()}`,
        kind: "video",
        url: result.url,
        metadata: {
          model: input.model,
          provider: input.providerKey,
          operation: "lip_sync",
          providerTaskId: result.providerTaskId,
        },
      },
    ];
  }
  const provider = providers[input.protocol];
  if (!provider?.lipSync)
    throw new Error(`LIP_SYNC_PROTOCOL_NOT_SUPPORTED:${input.protocol}`);
  return provider.lipSync(input);
}
