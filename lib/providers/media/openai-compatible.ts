import type { MediaAsset } from "@/lib/media/task-contract";
import { getOpenAICompatibleImageSizeCandidates } from "@/lib/agent/media-size";
import { normalizeOpenAICompatibleVideoSeconds } from "@/lib/agent/media-video";
import { fetchWithProviderRetry } from "@/lib/providers/http";
import { executeOpenAiCompatibleMediaTemplate } from "@/lib/providers/openai-compatible-media-template";
import {
  createProviderInputUrl,
  createProviderTaskInputUrl,
} from "@/lib/media/provider-input-url";

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
  MediaProviderRequest,
} from "./types";

export const openAiCompatibleMediaProvider: MediaProviderAdapter = {
  async generate(input) {
    // Agnes has its own video contract; a generic channel template can add
    // fields such as `resolution` that the Agnes API rejects.
    if (input.kind === "video" && isAgnesVideoModel(input.model))
      return generateVideo(input);
    if (
      input.mediaTemplate &&
      (input.kind === "image" || input.kind === "video")
    )
      return executeOpenAiCompatibleMediaTemplate({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: input.model,
        kind: input.kind,
        request: input.request as Record<string, unknown>,
        template: input.mediaTemplate,
      });
    if (input.kind === "image") return generateImage(input);
    if (input.kind === "video") return generateVideo(input);
    return generateAudio(input);
  },
  lipSync: generateLipSync,
};

async function generateImage(
  input: GenerateProviderMediaInput,
): Promise<MediaAsset[]> {
  const references = await referencesAsDataUrls(
    input.request.referenceImages ?? [],
  );
  if (isAgnesImageModel(input.model))
    return generateAgnesImage(input, references);
  const endpoint = references.length
    ? process.env.OPENAI_COMPATIBLE_IMAGE_EDIT_PATH || "images/edits"
    : process.env.OPENAI_COMPATIBLE_IMAGE_GENERATION_PATH ||
      "images/generations";
  const size = /^gpt-image-2(?:$|[-.])/i.test(input.model)
    ? getOpenAICompatibleImageSizeCandidates(
        input.request.resolution ?? "1k",
        input.request.ratio ?? "1:1",
      )[0]?.size
    : resolveImageSize(input.request.ratio, input.request.resolution);
  const response = await requestImage(input, endpoint, references, size);
  const payload = await readProviderJson(response);
  if (!response.ok)
    throw new Error(providerErrorMessage(payload, response.status));
  const urls = extractImageUrls(payload);
  if (!urls.length) throw new Error("IMAGE_RESULT_MISSING:openai-compatible");
  return urls.map((url, index) => ({
    id: `${input.model}-${Date.now()}-${index}`,
    kind: "image",
    url,
    metadata: { model: input.model },
  }));
}

async function generateAgnesImage(
  input: GenerateProviderMediaInput,
  references: string[],
): Promise<MediaAsset[]> {
  const response = await fetchWithProviderRetry(
    joinUrl(input.baseUrl, "images/generations"),
    {
      method: "POST",
      headers: bearerJsonHeaders(input.apiKey),
      body: JSON.stringify({
        model: input.model,
        prompt: input.request.prompt ?? "",
        size: normalizeAgnesImageSize(input.request.resolution),
        ratio: normalizeAgnesAspectRatio(input.request.ratio),
        n: normalizeImageCount(input.request.count ?? input.request.n),
        ...(references.length
          ? { extra_body: { image: references } }
          : {}),
      }),
      cache: "no-store",
    },
    { maxAttempts: 3 },
  );
  const payload = await readProviderJson(response);
  if (!response.ok)
    throw new Error(providerErrorMessage(payload, response.status));
  const urls = extractImageUrls(payload);
  if (!urls.length) throw new Error("IMAGE_RESULT_MISSING:agnes-ai");
  return urls.map((url, index) => ({
    id: `${input.model}-${Date.now()}-${index}`,
    kind: "image",
    url,
    metadata: { model: input.model, provider: "agnes-ai" },
  }));
}

function requestImage(
  input: GenerateProviderMediaInput,
  endpoint: string,
  references: string[],
  size?: string,
) {
  const count = normalizeImageCount(input.request.count ?? input.request.n);
  if (references.length) {
    const form = new FormData();
    form.append("model", input.model);
    form.append("prompt", input.request.prompt ?? "");
    form.append("n", String(count));
    if (input.request.quality) form.append("quality", input.request.quality);
    if (size) form.append("size", size);
    const fileField =
      process.env.OPENAI_COMPATIBLE_IMAGE_EDIT_FILE_FIELD || "image[]";
    references.forEach((reference, index) => {
      const { blob, extension } = imageDataUrlBlob(reference);
      form.append(fileField, blob, `reference-${index + 1}.${extension}`);
    });
    return fetchWithProviderRetry(joinUrl(input.baseUrl, endpoint), {
      method: "POST",
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
      cache: "no-store",
    }, { maxAttempts: 3 });
  }
  return fetchWithProviderRetry(joinUrl(input.baseUrl, endpoint), {
    method: "POST",
    headers: bearerJsonHeaders(input.apiKey),
    body: JSON.stringify({
      model: input.model,
      prompt: input.request.prompt ?? "",
      ...(size ? { size } : {}),
      n: count,
      ...(input.request.quality ? { quality: input.request.quality } : {}),
    }),
    cache: "no-store",
  }, { maxAttempts: 3 });
}

function normalizeImageCount(value?: number) {
  return Number.isInteger(value) ? Math.min(4, Math.max(1, value!)) : 1;
}

async function generateVideo(
  input: GenerateProviderMediaInput,
): Promise<MediaAsset[]> {
  const agnesVideo = isAgnesVideoModel(input.model);
  const createPath = agnesVideo
    ? "videos"
    : trimPath(process.env.OPENAI_COMPATIBLE_VIDEO_CREATE_PATH || "videos");
  const statusPath = trimPath(
    process.env.OPENAI_COMPATIBLE_VIDEO_STATUS_PATH || "videos/{id}",
  );
  const response = await fetchWithProviderRetry(
    joinUrl(input.baseUrl, createPath),
    {
      method: "POST",
      headers: bearerJsonHeaders(input.apiKey),
      body: JSON.stringify(
        agnesVideo
          ? buildAgnesVideoBody(
              input.model,
              await withAgnesVideoReferenceUrls(
                input.request,
                input.mediaTaskId,
              ),
            )
          : buildVideoBody(input.model, input.request),
      ),
    },
  );
  const payload = await readProviderJson(response);
  if (!response.ok)
    throw new Error(providerErrorMessage(payload, response.status));
  return pollVideoResult({
    input,
    initialPayload: payload,
    agnesVideo,
    statusPath: (taskId) =>
      statusPath.replace("{id}", encodeURIComponent(taskId)),
  });
}

async function withAgnesVideoReferenceUrls(
  request: MediaProviderRequest,
  mediaTaskId?: string,
) {
  const referenceImages = await Promise.all(
    (request.referenceImages ?? []).map(async (reference, index) => {
      if (reference.assetId)
        return { ...reference, url: createProviderInputUrl(reference.assetId) };
      if (
        mediaTaskId &&
        /^data:image\/[a-z0-9.+-]+;base64,/i.test(reference.url)
      )
        return {
          ...reference,
          url: createProviderTaskInputUrl(mediaTaskId, index),
        };
      return reference;
    }),
  );
  return { ...request, referenceImages };
}

function buildVideoBody(model: string, request: MediaProviderRequest) {
  const references = request.referenceImages ?? [];
  const referenceImages = references
    .filter(
      (reference) =>
        (reference.role ?? "reference_image") === "reference_image" ||
        (request.videoMode !== "first-last" &&
          reference.role === "first_frame"),
    )
    .map((reference) => reference.url);
  const firstFrame = references.find(
    (reference) => reference.role === "first_frame",
  )?.url;
  const lastFrame = references.find(
    (reference) => reference.role === "last_frame",
  )?.url;
  return {
    model,
    prompt: request.prompt ?? "",
    seconds: normalizeOpenAICompatibleVideoSeconds(request.duration, model),
    size: resolveVideoSize(request.ratio),
    resolution: request.resolution,
    ...(request.videoMode === "first-last"
      ? { first_frame: firstFrame, last_frame: lastFrame }
      : {}),
    ...(referenceImages.length ? { image: referenceImages } : {}),
  };
}

async function generateAudio(
  input: GenerateProviderMediaInput,
): Promise<MediaAsset[]> {
  const response = await fetchWithProviderRetry(
    joinUrl(input.baseUrl, "audio/speech"),
    {
      method: "POST",
      headers: bearerJsonHeaders(input.apiKey),
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
    const payload = await readProviderJson(response);
    const url = extractAudioUrl(payload);
    if (!url) throw new Error("AUDIO_RESULT_MISSING");
    return [audioAsset(input.model, url, "audio/mpeg")];
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return [
    audioAsset(
      input.model,
      `data:${contentType};base64,${bytes.toString("base64")}`,
      contentType,
    ),
  ];
}

async function generateLipSync(
  input: GenerateProviderLipSyncInput,
): Promise<MediaAsset[]> {
  if (!input.videoUrl) throw new Error("LIP_SYNC_VIDEO_MISSING");
  const response = await fetchWithProviderRetry(
    joinUrl(input.baseUrl, "videos/lip-sync"),
    {
      method: "POST",
      headers: bearerJsonHeaders(input.apiKey),
      body: JSON.stringify({
        model: input.model,
        video_url: input.videoUrl,
        audio_url: input.audioUrl,
      }),
    },
  );
  const payload = await readProviderJson(response);
  if (!response.ok)
    throw new Error(providerErrorMessage(payload, response.status));
  return pollLipSyncResult(input, payload);
}

async function pollVideoResult(input: {
  input: GenerateProviderMediaInput;
  initialPayload: unknown;
  agnesVideo: boolean;
  statusPath: (taskId: string) => string;
}) {
  const initial = extractVideoState(input.initialPayload);
  if (initial.error || /failed|error|cancelled|canceled|rejected|blocked/i.test(initial.status ?? ""))
    throw new Error(initial.error || providerErrorMessage(
      input.initialPayload,
      200,
      `VIDEO_PROVIDER_FAILED:${initial.status}`,
    ));
  if (initial.url) return [videoAsset(input.input, initial.url)];
  if (!initial.taskId) throw new Error("VIDEO_TASK_ID_MISSING");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await waitForProviderPoll();
    const response = await fetchWithProviderRetry(
      input.agnesVideo
        ? agnesVideoStatusUrl(
            input.input.baseUrl,
            initial.taskId,
            input.input.model,
          )
        : joinUrl(input.input.baseUrl, input.statusPath(initial.taskId)),
      {
        method: input.agnesVideo
          ? "GET"
          : process.env.OPENAI_COMPATIBLE_VIDEO_STATUS_METHOD || "GET",
        headers: { Authorization: `Bearer ${input.input.apiKey}` },
      },
    );
    const payload = await readProviderJson(response);
    if (!response.ok)
      throw new Error(providerErrorMessage(payload, response.status));
    const state = extractVideoState(payload);
    if (state.error || /failed|error|cancelled|canceled|rejected|blocked/i.test(state.status ?? ""))
      throw new Error(state.error || providerErrorMessage(
        payload,
        response.status,
        `VIDEO_PROVIDER_FAILED:${state.status}`,
      ));
    if (state.url) return [videoAsset(input.input, state.url, initial.taskId)];
  }
  throw new Error("VIDEO_POLL_TIMEOUT");
}

async function pollLipSyncResult(
  input: GenerateProviderLipSyncInput,
  initialPayload: unknown,
) {
  const initial = extractVideoState(initialPayload);
  if (initial.url) return [lipSyncAsset(input, initial.url)];
  if (!initial.taskId) throw new Error("LIP_SYNC_TASK_ID_MISSING");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await waitForProviderPoll();
    const response = await fetchWithProviderRetry(
      joinUrl(input.baseUrl, `videos/${encodeURIComponent(initial.taskId)}`),
      { headers: { Authorization: `Bearer ${input.apiKey}` } },
    );
    const payload = await readProviderJson(response);
    if (!response.ok)
      throw new Error(providerErrorMessage(payload, response.status));
    const state = extractVideoState(payload);
    if (state.url) return [lipSyncAsset(input, state.url, initial.taskId)];
    if (/failed|error|canceled/i.test(state.status ?? ""))
      throw new Error(`LIP_SYNC_PROVIDER_FAILED:${state.status}`);
  }
  throw new Error("LIP_SYNC_POLL_TIMEOUT");
}

function extractImageUrls(payload: unknown) {
  const data = record(payload).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const value = record(item);
    const url = value.url;
    if (typeof url === "string") return [url];
    const base64 = value.b64_json;
    return typeof base64 === "string"
      ? [`data:image/png;base64,${base64}`]
      : [];
  });
}

function imageDataUrlBlob(value: string) {
  const match = value.match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) throw new Error("REFERENCE_IMAGE_DATA_URL_INVALID");
  const mimeType = match[1];
  const extension =
    mimeType === "image/jpeg"
      ? "jpg"
      : mimeType === "image/webp"
        ? "webp"
        : "png";
  return {
    blob: new Blob([Buffer.from(match[2], "base64")], { type: mimeType }),
    extension,
  };
}

function extractAudioUrl(payload: unknown) {
  const value = record(payload);
  for (const key of ["url", "audio_url", "audioUrl"])
    if (typeof value[key] === "string") return value[key] as string;
  return undefined;
}

function extractVideoState(payload: unknown) {
  const value = record(payload);
  const data = Object.keys(record(value.data)).length
    ? record(value.data)
    : value;
  const content = record(data.content);
  return {
    taskId:
      stringValue(data.video_id) ||
      stringValue(data.id) ||
      stringValue(data.task_id),
    status: stringValue(data.status),
    error: providerErrorMessage({ error: data.error ?? value.error }, 200, "") || undefined,
    url:
      stringValue(data.url) ||
      stringValue(data.video_url) ||
      stringValue(content.video_url) ||
      stringValue(content.url),
  };
}

export function buildAgnesVideoBody(
  model: string,
  request: MediaProviderRequest,
) {
  const references = request.referenceImages ?? [];
  const firstFrame = references.find(
    (reference) => reference.role === "first_frame",
  )?.url;
  const lastFrame = references.find(
    (reference) => reference.role === "last_frame",
  )?.url;
  const keyframeMode = request.videoMode === "first-last";
  const images = keyframeMode
    ? []
    : references.slice(0, 5).map((reference) => reference.url);
  const audios = (request.referenceAudios ?? [])
    .slice(0, 3)
    .map((reference) => reference.url);
  const mode = keyframeMode
    ? "keyframe"
    : images.length || audios.length
      ? "reference"
      : "text";

  return {
    model,
    prompt: request.prompt ?? "",
    mode,
    seconds: normalizeAgnesVideoSeconds(request.duration),
    size: "720P",
    aspect_ratio: normalizeAgnesAspectRatio(request.ratio, "video"),
    n: 1,
    ...(mode === "keyframe"
      ? {
          ...(firstFrame ? { first_frame: firstFrame } : {}),
          ...(lastFrame ? { last_frame: lastFrame } : {}),
        }
      : {}),
    ...(mode === "reference" && images.length ? { images } : {}),
    ...(mode === "reference" && audios.length ? { audios } : {}),
  };
}

function normalizeAgnesVideoSeconds(value?: string) {
  const seconds = Number.parseInt(value?.match(/\d+/)?.[0] ?? "5", 10);
  return String(
    Math.max(4, Math.min(12, Number.isFinite(seconds) ? seconds : 5)),
  );
}

export function agnesVideoStatusUrl(
  baseUrl: string,
  videoId: string,
  model: string,
) {
  const origin = baseUrl.replace(/\/v1\/?$/i, "").replace(/\/+$/, "");
  const query = new URLSearchParams({ video_id: videoId, model_name: model });
  return `${origin}/agnesapi?${query.toString()}`;
}

function normalizeAgnesImageSize(value?: string) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "4k") return "4K";
  if (normalized === "3k") return "3K";
  if (normalized === "2k" || normalized === "1080p") return "2K";
  return "1K";
}

function normalizeAgnesAspectRatio(
  value?: string,
  kind: "image" | "video" = "image",
) {
  const normalized =
    value?.trim().replace(/\s+/g, "").replace(/x/gi, ":") ?? "";
  const imageRatios = new Set([
    "1:1",
    "3:4",
    "4:3",
    "16:9",
    "9:16",
    "2:3",
    "3:2",
    "21:9",
  ]);
  const videoRatios = new Set([
    "21:9",
    "16:9",
    "4:3",
    "1:1",
    "3:4",
    "9:16",
  ]);
  const supported = kind === "video" ? videoRatios : imageRatios;
  if (supported.has(normalized)) return normalized;

  if (kind === "video") {
    const nearestSupported: Record<string, string> = {
      "2:3": "3:4",
      "3:2": "4:3",
      "9:21": "9:16",
    };
    return nearestSupported[normalized] ?? "1:1";
  }

  return "1:1";
}

function isAgnesImageModel(model: string) {
  return /^agnes-image-2\.5-flash$/i.test(model.trim());
}

export function isAgnesVideoModel(model: string) {
  return /^agnes-video-2\.5-flash$/i.test(model.trim());
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
      protocol: "openai-compatible",
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
      protocol: "openai-compatible",
      operation: "lip_sync",
      ...(providerTaskId ? { providerTaskId } : {}),
    },
  };
}

function audioAsset(model: string, url: string, mimeType: string): MediaAsset {
  return {
    id: `${model}-${Date.now()}`,
    kind: "audio",
    url,
    mimeType,
    metadata: { model, protocol: "openai-compatible" },
  };
}

function resolveVideoSize(ratio?: string) {
  if (!ratio) return undefined;
  const normalized = ratio.trim();
  if (/^\d+x\d+$/i.test(normalized)) return normalized;
  return {
    "1:1": "1024x1024",
    "16:9": "1792x1024",
    "9:16": "1024x1792",
    "4:3": "1365x1024",
    "3:4": "1024x1365",
  }[normalized];
}

function bearerJsonHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${trimPath(path)}`;
}

function trimPath(value: string) {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
