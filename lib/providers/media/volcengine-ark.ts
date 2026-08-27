import type { MediaAsset } from "@/lib/media/task-contract";
import { fetchWithProviderRetry } from "@/lib/providers/http";

import {
  providerErrorMessage,
  readProviderJson,
  referencesAsDataUrls,
  resolveImageSize,
  waitForProviderPoll,
} from "./shared";
import type {
  GenerateProviderLipSyncInput,
  GenerateProviderMediaInput,
  MediaProviderAdapter,
} from "./types";

export const volcengineArkMediaProvider: MediaProviderAdapter = {
  async generate(input) {
    if (input.kind === "image") return generateImage(input);
    if (input.kind === "video") return generateVideo(input);
    return generateAudio(input);
  },
  lipSync: generateLipSync,
};

async function generateImage(input: GenerateProviderMediaInput) {
  const references = await referencesAsDataUrls(
    input.request.referenceImages ?? [],
  );
  const response = await fetchWithProviderRetry(
    joinUrl(input.baseUrl, "images/generations"),
    {
      method: "POST",
      headers: arkJsonHeaders(input.apiKey),
      body: JSON.stringify({
        model: input.model,
        prompt: input.request.prompt ?? "",
        size: resolveImageSize(input.request.ratio, input.request.resolution),
        aspect_ratio: input.request.ratio,
        watermark: false,
        sequential_image_generation: "disabled",
        ...(references.length ? { image: references } : {}),
        response_format: "url",
      }),
    },
  );
  const payload = await readProviderJson(response);
  if (!response.ok)
    throw new Error(providerErrorMessage(payload, response.status));
  const urls = imageUrls(payload);
  if (!urls.length) throw new Error("IMAGE_RESULT_MISSING:volcengine-ark");
  return urls.map((url, index) => ({
    id: `${input.model}-${Date.now()}-${index}`,
    kind: "image" as const,
    url,
    metadata: { model: input.model, protocol: "volcengine-ark" },
  }));
}

async function generateVideo(input: GenerateProviderMediaInput) {
  const references = input.request.referenceImages ?? [];
  const dataUrls = await referencesAsDataUrls(references);
  const content = [
    { type: "text", text: input.request.prompt ?? "" },
    ...references.map((reference, index) => ({
      type: "image_url",
      image_url: { url: dataUrls[index] },
      role: reference.role ?? "reference_image",
    })),
  ];
  const response = await fetchWithProviderRetry(
    joinUrl(input.baseUrl, "contents/generations/tasks"),
    {
      method: "POST",
      headers: arkJsonHeaders(input.apiKey),
      body: JSON.stringify({
        model: input.model,
        content,
        ratio: input.request.ratio?.trim() || "16:9",
        resolution: arkResolution(input.request.resolution),
        duration: durationSeconds(input.request.duration),
        generate_audio: true,
        watermark: false,
      }),
    },
  );
  const payload = await readProviderJson(response);
  if (!response.ok)
    throw new Error(providerErrorMessage(payload, response.status));
  return pollArkVideo(input, payload);
}

async function generateAudio(input: GenerateProviderMediaInput) {
  const response = await fetchWithProviderRetry(
    joinUrl(input.baseUrl, "audio/speech"),
    {
      method: "POST",
      headers: arkJsonHeaders(input.apiKey),
      body: JSON.stringify({
        model: input.model,
        input: input.request.input ?? input.request.prompt ?? "",
        voice: input.request.voice ?? "alloy",
        response_format: input.request.responseFormat ?? "mp3",
      }),
    },
  );
  const contentType = response.headers.get("content-type") ?? "audio/mpeg";
  if (!response.ok) {
    const payload = await readProviderJson(response);
    throw new Error(providerErrorMessage(payload, response.status));
  }
  if (contentType.includes("json")) {
    const payload = record(await readProviderJson(response));
    const url = stringValue(payload.url) || stringValue(payload.audio_url);
    if (!url) throw new Error("AUDIO_RESULT_MISSING");
    return [audioAsset(input, url, "audio/mpeg")];
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return [
    audioAsset(
      input,
      `data:${contentType};base64,${bytes.toString("base64")}`,
      contentType,
    ),
  ];
}

async function generateLipSync(input: GenerateProviderLipSyncInput) {
  if (!input.videoUrl) throw new Error("LIP_SYNC_VIDEO_MISSING");
  const response = await fetchWithProviderRetry(
    joinUrl(input.baseUrl, "contents/generations/tasks"),
    {
      method: "POST",
      headers: arkJsonHeaders(input.apiKey),
      body: JSON.stringify({
        model: input.model,
        input: { video_url: input.videoUrl, audio_url: input.audioUrl },
        parameters: { action: "lip-sync" },
      }),
    },
  );
  const payload = await readProviderJson(response);
  if (!response.ok)
    throw new Error(providerErrorMessage(payload, response.status));
  return pollArkLipSync(input, payload);
}

async function pollArkVideo(
  input: GenerateProviderMediaInput,
  initialPayload: unknown,
) {
  const initial = videoState(initialPayload);
  if (initial.url) return [videoAsset(input, initial.url)];
  if (!initial.taskId) throw new Error("VIDEO_TASK_ID_MISSING");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await waitForProviderPoll();
    const response = await fetchWithProviderRetry(
      joinUrl(
        input.baseUrl,
        `contents/generations/tasks/${encodeURIComponent(initial.taskId)}`,
      ),
      { headers: { Authorization: `Bearer ${input.apiKey}` } },
    );
    const payload = await readProviderJson(response);
    if (!response.ok)
      throw new Error(providerErrorMessage(payload, response.status));
    const state = videoState(payload);
    if (state.url) return [videoAsset(input, state.url, initial.taskId)];
    if (/failed|error|canceled/i.test(state.status ?? ""))
      throw new Error(`VIDEO_PROVIDER_FAILED:${state.status}`);
  }
  throw new Error("VIDEO_POLL_TIMEOUT");
}

async function pollArkLipSync(
  input: GenerateProviderLipSyncInput,
  initialPayload: unknown,
) {
  const initial = videoState(initialPayload);
  if (initial.url) return [lipSyncAsset(input, initial.url)];
  if (!initial.taskId) throw new Error("LIP_SYNC_TASK_ID_MISSING");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await waitForProviderPoll();
    const response = await fetchWithProviderRetry(
      joinUrl(
        input.baseUrl,
        `contents/generations/tasks/${encodeURIComponent(initial.taskId)}`,
      ),
      { headers: { Authorization: `Bearer ${input.apiKey}` } },
    );
    const payload = await readProviderJson(response);
    if (!response.ok)
      throw new Error(providerErrorMessage(payload, response.status));
    const state = videoState(payload);
    if (state.url) return [lipSyncAsset(input, state.url, initial.taskId)];
    if (/failed|error|canceled/i.test(state.status ?? ""))
      throw new Error(`LIP_SYNC_PROVIDER_FAILED:${state.status}`);
  }
  throw new Error("LIP_SYNC_POLL_TIMEOUT");
}

function imageUrls(payload: unknown) {
  const data = record(payload).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const url = stringValue(record(item).url);
    return url ? [url] : [];
  });
}

function videoState(payload: unknown) {
  const value = record(payload);
  const data = Object.keys(record(value.data)).length
    ? record(value.data)
    : value;
  const content = record(data.content);
  return {
    taskId: stringValue(data.id) || stringValue(data.task_id),
    status: stringValue(data.status),
    url:
      stringValue(data.url) ||
      stringValue(data.video_url) ||
      stringValue(content.video_url) ||
      stringValue(content.url),
  };
}

function videoAsset(
  input: GenerateProviderMediaInput,
  url: string,
  providerTaskId?: string,
): MediaAsset {
  return {
    id: `${input.model}-${Date.now()}`,
    kind: "video",
    url,
    metadata: {
      model: input.model,
      protocol: "volcengine-ark",
      ...(providerTaskId ? { providerTaskId } : {}),
    },
  };
}

function lipSyncAsset(
  input: GenerateProviderLipSyncInput,
  url: string,
  providerTaskId?: string,
): MediaAsset {
  return {
    id: `lipsync-${input.model}-${Date.now()}`,
    kind: "video",
    url,
    metadata: {
      model: input.model,
      protocol: "volcengine-ark",
      operation: "lip_sync",
      ...(providerTaskId ? { providerTaskId } : {}),
    },
  };
}

function audioAsset(
  input: GenerateProviderMediaInput,
  url: string,
  mimeType: string,
): MediaAsset {
  return {
    id: `${input.model}-${Date.now()}`,
    kind: "audio",
    url,
    mimeType,
    metadata: { model: input.model, protocol: "volcengine-ark" },
  };
}

function arkJsonHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function arkResolution(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "720p" || normalized === "1080p" ? normalized : "1080p";
}

function durationSeconds(value?: string) {
  const parsed = Number.parseInt(value?.replace(/s$/i, "") || "5", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
