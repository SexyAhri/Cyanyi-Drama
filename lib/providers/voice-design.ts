import { fetchWithProviderRetry } from "./http";

export type VoiceDesignInput = {
  voicePrompt: string;
  previewText: string;
  preferredName: string;
  language: "zh" | "en";
};

export type VoiceDesignResult = {
  voiceId: string;
  targetModel?: string;
  audioBase64?: string;
  sampleRate?: number;
  responseFormat?: string;
  usageCount?: number;
  requestId?: string;
};

export async function createBailianVoiceDesign(
  input: VoiceDesignInput,
  apiKey: string,
  baseUrl = "https://dashscope.aliyuncs.com",
): Promise<VoiceDesignResult> {
  validateVoiceDesignInput(input);
  if (!apiKey.trim()) throw new Error("VOICE_DESIGN_API_KEY_REQUIRED");
  const apiBase = baseUrl.replace(/\/+$/, "").endsWith("/api/v1")
    ? baseUrl.replace(/\/+$/, "")
    : `${baseUrl.replace(/\/+$/, "")}/api/v1`;
  const response = await fetchWithProviderRetry(
    `${apiBase}/services/audio/tts/customization`,
    {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen-voice-design",
      input: {
        action: "create",
        target_model: "qwen3-tts-vd-2026-01-26",
        voice_prompt: input.voicePrompt,
        preview_text: input.previewText,
        preferred_name: input.preferredName,
        language: input.language,
      },
      parameters: { sample_rate: 24000, response_format: "wav" },
    }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    output?: {
      voice?: string;
      target_model?: string;
      preview_audio?: {
        data?: string;
        sample_rate?: number;
        response_format?: string;
      };
    };
    usage?: { count?: number };
    request_id?: string;
    code?: string;
    message?: string;
  };
  if (!response.ok || !payload.output?.voice)
    throw new Error(
      `VOICE_DESIGN_PROVIDER_FAILED:${payload.code || response.status}:${payload.message || "unknown"}`,
    );
  return {
    voiceId: payload.output.voice,
    targetModel: payload.output.target_model,
    audioBase64: payload.output.preview_audio?.data,
    sampleRate: payload.output.preview_audio?.sample_rate,
    responseFormat: payload.output.preview_audio?.response_format,
    usageCount: payload.usage?.count,
    requestId: payload.request_id,
  };
}

export function validateVoiceDesignInput(input: VoiceDesignInput) {
  const prompt = input.voicePrompt.trim();
  const preview = input.previewText.trim();
  if (!prompt || prompt.length > 500)
    throw new Error("VOICE_DESIGN_PROMPT_INVALID");
  if (preview.length < 5 || preview.length > 200)
    throw new Error("VOICE_DESIGN_PREVIEW_INVALID");
  if (!input.preferredName.trim())
    throw new Error("VOICE_DESIGN_NAME_REQUIRED");
}
