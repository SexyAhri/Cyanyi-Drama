import type { MediaAsset } from "@/lib/media/task-contract";
import { fetchWithProviderRetry } from "@/lib/providers/http";

import {
  AUTODL_COMFYUI_BASE_URL,
  getAutoDlWorkflow,
  type AutoDlWorkflowDefinition,
} from "./autodl-comfyui-workflows";
import {
  localReferencesAsDataUrls,
  providerErrorMessage,
  readProviderJson,
} from "./shared";
import type {
  GenerateProviderMediaInput,
  MediaProviderAdapter,
  MediaProviderRequest,
} from "./types";

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 20 * 60_000;

export const autoDlComfyUiMediaProvider: MediaProviderAdapter = {
  async generate(input) {
    const workflow = requireWorkflow(input.model);
    if (input.kind === "video" && workflow.type === "video")
      return executeWorkflow(
        input,
        workflow,
        await buildVideoBody(workflow, input.request),
      );
    if (input.kind === "audio" && workflow.kind === "tts")
      return executeWorkflow(input, workflow, await buildTtsBody(input.request));
    throw new Error(
      `AUTODL_WORKFLOW_KIND_MISMATCH:${input.model}:${input.kind}`,
    );
  },
  async lipSync(input) {
    const workflow = requireWorkflow(input.model);
    if (workflow.kind !== "image-audio-video")
      throw new Error(`AUTODL_LIPSYNC_MODEL_REQUIRED:${input.model}`);
    if (!input.imageUrl) throw new Error("AUTODL_LIPSYNC_IMAGE_REQUIRED");
    const [imageUrl, audioUrl] = await localReferencesAsDataUrls([
      { url: input.imageUrl },
      { url: input.audioUrl },
    ]);
    return executeWorkflow(
      {
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: input.model,
        kind: "video",
      },
      workflow,
      {
        resolution: autoDlResolution(workflow, "9:16", "768p"),
        ref_audio_0: audioUrl,
        ref_image_0: imageUrl,
        audio_duration: clampDuration(
          input.durationSeconds,
          workflow.maxDurationSeconds,
        ),
      },
      "lip_sync",
    );
  },
};

async function executeWorkflow(
  input: Pick<
    GenerateProviderMediaInput,
    "baseUrl" | "apiKey" | "model" | "kind"
  >,
  workflow: AutoDlWorkflowDefinition,
  body: Record<string, unknown>,
  operation?: string,
): Promise<MediaAsset[]> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const response = await fetchWithProviderRetry(
    `${baseUrl}/comfyui/comfyui_workflow/${encodeURIComponent(workflow.id)}`,
    {
      method: "POST",
      headers: autoDlHeaders(input.apiKey),
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );
  const payload = await readProviderJson(response);
  assertAutoDlResponse(response, payload, "SUBMIT");
  const taskId = stringAt(dataOf(payload), "task_id");
  if (!taskId) throw new Error("AUTODL_TASK_ID_MISSING");

  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await wait(POLL_INTERVAL_MS);
    const resultResponse = await fetchWithProviderRetry(
      `${baseUrl}/comfyui/comfyui_workflow/result/${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        headers: { Authorization: input.apiKey.trim() },
        cache: "no-store",
      },
    );
    const resultPayload = await readProviderJson(resultResponse);
    assertAutoDlResponse(resultResponse, resultPayload, "QUERY");
    const data = dataOf(resultPayload);
    const status = stringAt(data, "status").toUpperCase();
    if (["FAILED", "ERROR", "CANCELED", "CANCELLED"].includes(status))
      throw new Error(
        `AUTODL_WORKFLOW_FAILED:${workflow.id}:${autoDlErrorMessage(resultPayload, resultResponse.status)}`,
      );
    const results = resultUrls(data, input.kind);
    if (["SUCCESS", "SUCCEEDED", "COMPLETED"].includes(status)) {
      if (!results.length) throw new Error("AUTODL_RESULT_URL_MISSING");
      return results.map((result, index) => ({
        id: `${workflow.id}-${Date.now()}-${index}`,
        kind: input.kind,
        url: result.url,
        mimeType: result.mimeType,
        metadata: {
          model: workflow.id,
          protocol: "autodl-comfyui",
          providerTaskId: taskId,
          ...(operation ? { operation } : {}),
        },
      }));
    }
  }
  throw new Error(`AUTODL_POLL_TIMEOUT:${workflow.id}`);
}

async function buildVideoBody(
  workflow: AutoDlWorkflowDefinition,
  request: MediaProviderRequest,
) {
  const duration = clampDuration(
    durationSeconds(request.duration),
    workflow.maxDurationSeconds,
  );
  const base = {
    prompt: request.prompt?.trim() ?? "",
    duration,
    resolution: autoDlResolution(workflow, request.ratio, request.resolution),
  };
  if (!base.prompt) throw new Error("AUTODL_VIDEO_PROMPT_REQUIRED");
  if (
    request.referenceAudios?.length &&
    !workflow.maxReferenceAudios
  )
    throw new Error(`AUTODL_AUDIO_REFERENCE_UNSUPPORTED:${workflow.id}`);
  if (workflow.kind === "text-video") return base;

  const references = request.referenceImages ?? [];
  const referenceUrls = await localReferencesAsDataUrls(references);
  if (workflow.kind === "first-last-video") {
    const firstFrameIndex = references.findIndex(
      (reference) => reference.role === "first_frame",
    );
    const lastFrameIndex = references.findIndex(
      (reference) => reference.role === "last_frame",
    );
    const firstFrame = referenceUrls[firstFrameIndex];
    const lastFrame = referenceUrls[lastFrameIndex];
    if (!firstFrame || !lastFrame)
      throw new Error("AUTODL_FIRST_LAST_FRAMES_REQUIRED");
    return { ...base, first_frame: firstFrame, last_frame: lastFrame };
  }

  const body: Record<string, unknown> = { ...base };
  references
    .slice(0, workflow.maxReferenceImages ?? 0)
    .forEach((_reference, index) => {
      body[`ref_image_${index}`] = referenceUrls[index];
    });
  if (workflow.kind === "reference-video" && !body.ref_image_0)
    throw new Error("AUTODL_REFERENCE_IMAGE_REQUIRED");
  if (workflow.kind === "audio-reference-video")
    (await localReferencesAsDataUrls(request.referenceAudios ?? []))
      .slice(0, workflow.maxReferenceAudios ?? 0)
      .forEach((url, index) => {
        body[`ref_audio_${index}`] = url;
      });
  return body;
}

async function buildTtsBody(request: MediaProviderRequest) {
  const text = request.input?.trim() || request.prompt?.trim();
  if (!text) throw new Error("AUTODL_TTS_TEXT_REQUIRED");
  const referenceAudioSource =
    request.referenceAudios?.[0] ||
    (isHttpUrl(request.voice) ? request.voice : undefined);
  if (!referenceAudioSource)
    throw new Error("AUTODL_TTS_REFERENCE_AUDIO_REQUIRED");
  const referenceAudio = (
    await localReferencesAsDataUrls([
      typeof referenceAudioSource === "string"
        ? { url: referenceAudioSource }
        : referenceAudioSource,
    ])
  )[0];
  const emotions = emotionWeights(
    request.emotionPrompt,
    request.emotionStrength,
  );
  return {
    prompt_text: text,
    prompt_simple: referenceAudio,
    emo_ref_audio: referenceAudio,
    emo_control_method: "与音色参考音频相同",
    emo_random: false,
    ...emotions,
  };
}

function autoDlResolution(
  workflow: AutoDlWorkflowDefinition,
  ratio?: string,
  requested?: string,
) {
  const supported = workflow.resolutions ?? ["768p"];
  const normalized = String(requested ?? "").toLowerCase();
  const requestedResolution = (["1080p", "768p", "480p"] as const).find(
    (resolution) => normalized.includes(resolution.replace("p", "")),
  );
  const resolution =
    (requestedResolution && supported.includes(requestedResolution)
      ? requestedResolution
      : supported.includes("768p")
        ? "768p"
        : supported[0]) ?? "768p";
  const orientation = ratioOrientation(ratio);
  if (orientation === "square" && workflow.square) return `${resolution}(1:1)`;
  return `${resolution}${orientation === "landscape" ? "横" : "竖"}`;
}

function ratioOrientation(value?: string) {
  const normalized = value?.trim() || "9:16";
  const size = normalized.match(/^(\d+)\s*[xX]\s*(\d+)$/);
  const ratio = normalized.match(/^(\d+(?:\.\d+)?)\s*[:：]\s*(\d+(?:\.\d+)?)$/);
  const width = Number(size?.[1] ?? ratio?.[1] ?? 9);
  const height = Number(size?.[2] ?? ratio?.[2] ?? 16);
  if (width === height) return "square" as const;
  return width > height ? ("landscape" as const) : ("portrait" as const);
}

function emotionWeights(prompt?: string, strength?: number) {
  const value = prompt?.toLowerCase() ?? "";
  const amount = Math.min(1, Math.max(0, strength ?? 0.5));
  const numericWeights = {
    emo_sad: 0,
    emo_calm: 0.3,
    emo_angry: 0,
    emo_happy: 0,
    emo_afraid: 0,
    emo_disgusted: 0,
    emo_melancholic: 0,
  };
  const match = [
    [/悲|伤|sad/, "emo_sad"],
    [/怒|愤|angry/, "emo_angry"],
    [/喜|开心|happy|joy/, "emo_happy"],
    [/怕|恐|afraid|fear/, "emo_afraid"],
    [/厌|恶|disgust/, "emo_disgusted"],
    [/惊|surpris/, "emo_surprised"],
    [/忧郁|低落|melanchol/, "emo_melancholic"],
    [/平静|克制|calm/, "emo_calm"],
  ].find(([pattern]) => (pattern as RegExp).test(value));
  if (match) {
    numericWeights.emo_calm = 0;
    if (match[1] === "emo_surprised") numericWeights.emo_afraid = amount;
    else
      numericWeights[match[1] as keyof typeof numericWeights] = amount;
  }
  return { ...numericWeights, emo_surprised: "0" };
}

function resultUrls(
  data: Record<string, unknown>,
  kind: "image" | "video" | "audio",
) {
  if (!Array.isArray(data.results)) return [];
  return data.results.flatMap((item) => {
    const result = record(item);
    const url = stringAt(result, "url");
    if (!url) return [];
    const fileType = stringAt(result, "file_type").toLowerCase();
    const resultType = stringAt(result, "type").toLowerCase();
    if (resultType && resultType !== kind) return [];
    return [
      {
        url,
        mimeType:
          kind === "video"
            ? "video/mp4"
            : kind === "audio"
              ? fileType === "wav"
                ? "audio/wav"
                : "audio/mpeg"
              : fileType === "webp"
                ? "image/webp"
                : fileType === "jpg" || fileType === "jpeg"
                  ? "image/jpeg"
                  : "image/png",
      },
    ];
  });
}

function assertAutoDlResponse(
  response: Response,
  payload: unknown,
  phase: "SUBMIT" | "QUERY",
) {
  const code = stringAt(record(payload), "code");
  if (!response.ok || (code && code.toLowerCase() !== "success"))
    throw new Error(
      `AUTODL_${phase}_FAILED:${response.status}:${autoDlErrorMessage(payload, response.status)}`,
    );
}

function autoDlErrorMessage(payload: unknown, status: number) {
  const root = record(payload);
  const data = record(root.data);
  for (const source of [data, root]) {
    for (const key of ["message", "msg", "error", "reason", "error_detail"]) {
      const value = stringAt(source, key);
      if (value) return value;
    }
  }
  return providerErrorMessage(payload, status);
}

function requireWorkflow(model: string) {
  const workflow = getAutoDlWorkflow(model);
  if (!workflow) throw new Error(`AUTODL_WORKFLOW_UNSUPPORTED:${model}`);
  return workflow;
}

function normalizeBaseUrl(value: string) {
  const trimmed = (value.trim() || AUTODL_COMFYUI_BASE_URL).replace(/\/+$/, "");
  if (/\/api\/v1$/i.test(trimmed)) return trimmed;
  const url = new URL(trimmed);
  if (url.pathname === "/" || !url.pathname) return `${trimmed}/api/v1`;
  return trimmed;
}

function autoDlHeaders(apiKey: string) {
  return {
    Authorization: apiKey.trim(),
    "Content-Type": "application/json",
  };
}

function durationSeconds(value?: string) {
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 5;
}

function clampDuration(value?: number, maximum = 15) {
  return Math.max(1, Math.min(maximum, Math.floor(value || 5)));
}

function dataOf(payload: unknown) {
  return record(record(payload).data);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringAt(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? value[key].trim() : "";
}

function isHttpUrl(value?: string) {
  return /^https?:\/\//i.test(value?.trim() ?? "");
}

function wait(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
