import type { MediaAsset } from "@/lib/media/task-contract";
import { fetchWithProviderRetry } from "@/lib/providers/http";

import { isQwenAudioTtsPlus } from "./bailian-dashscope-models";
import {
  providerErrorMessage,
  readProviderJson,
} from "./shared";
import type {
  GenerateProviderMediaInput,
  MediaProviderAdapter,
  MediaProviderRequest,
} from "./types";

const GENERATION_PATH = "services/audio/tts/SpeechSynthesizer";
const DEFAULT_VOICE = "longanlingxin";
const DEFAULT_FORMAT = "mp3";
const DEFAULT_SAMPLE_RATE = 24_000;

export const bailianDashScopeMediaProvider: MediaProviderAdapter = {
  async generate(input) {
    if (input.kind !== "audio")
      throw new Error(`BAILIAN_MEDIA_KIND_UNSUPPORTED:${input.kind}`);
    if (!isQwenAudioTtsPlus(input.model))
      throw new Error(`BAILIAN_TTS_MODEL_UNSUPPORTED:${input.model}`);
    return generateQwenAudioTts(input);
  },
};

async function generateQwenAudioTts(
  input: GenerateProviderMediaInput,
): Promise<MediaAsset[]> {
  const text = stringValue(input.request.input ?? input.request.prompt);
  if (!text) throw new Error("BAILIAN_TTS_TEXT_REQUIRED");

  const instruction = stringValue(
    input.request.instructions ?? input.request.emotionPrompt,
  );

  const response = await fetchWithProviderRetry(
    generationEndpoint(input.baseUrl),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildQwenAudioTtsRequest(
          input.model,
          input.request,
          text,
          instruction,
        ),
      ),
      cache: "no-store",
    },
  );
  const payload = await readProviderJson(response);
  if (!response.ok)
    throw new Error(providerErrorMessage(payload, response.status));
  const audio = extractQwenAudioResult(payload);
  const url = stringValue(audio.url);
  if (!url) throw new Error("BAILIAN_TTS_AUDIO_RESULT_MISSING");

  return [
    {
      id: `${input.model}-${Date.now()}`,
      kind: "audio",
      url,
      mimeType: audioMimeType(url),
      metadata: {
        model: input.model,
        protocol: "bailian-dashscope",
        requestId: stringValue(record(payload).request_id),
        audioId: stringValue(audio.id),
        expiresAt: numberValue(audio.expires_at),
        usage: record(payload).usage,
      },
    },
  ];
}

export function buildQwenAudioTtsRequest(
  model: string,
  request: MediaProviderRequest,
  text = stringValue(request.input ?? request.prompt),
  instruction = stringValue(request.instructions ?? request.emotionPrompt),
) {
  if (!text) throw new Error("BAILIAN_TTS_TEXT_REQUIRED");
  return {
    model,
    input: {
      text,
      voice: stringValue(request.voice) ?? DEFAULT_VOICE,
      format: normalizeAudioFormat(request.responseFormat ?? request.format),
      sample_rate: DEFAULT_SAMPLE_RATE,
      ...(instruction ? { instruction } : {}),
      ...(request.optimizeInstructions !== undefined
        ? { optimize_instructions: request.optimizeInstructions }
        : {}),
    },
  };
}

function normalizeAudioFormat(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "wav" ||
    normalized === "pcm" ||
    normalized === "opus" ||
    normalized === "mp3"
    ? normalized
    : DEFAULT_FORMAT;
}

function generationEndpoint(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("BAILIAN_TTS_BASE_URL_REQUIRED");
  if (/[<>{}]/.test(normalized))
    throw new Error("BAILIAN_TTS_WORKSPACE_ID_REQUIRED");
  return normalized.toLowerCase().endsWith(GENERATION_PATH.toLowerCase())
    ? normalized
    : normalized.toLowerCase().endsWith("/api/v1")
      ? `${normalized}/${GENERATION_PATH}`
      : `${normalized}/api/v1/${GENERATION_PATH}`;
}

function extractQwenAudioResult(payload: unknown) {
  const value = record(payload);
  const output = record(value.output);
  return record(output.audio);
}

function audioMimeType(url: string) {
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (pathname.endsWith(".mp3")) return "audio/mpeg";
  if (pathname.endsWith(".flac")) return "audio/flac";
  if (pathname.endsWith(".ogg")) return "audio/ogg";
  return "audio/wav";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
