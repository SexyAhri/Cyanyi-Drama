import { Buffer } from "node:buffer";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  createOpenAICompatible,
  type OpenAICompatibleProvider,
} from "@ai-sdk/openai-compatible";
import {
  gateway,
  isStepCount,
  jsonSchema,
  streamText,
  tool,
  type TextStreamPart,
  type ToolSet,
  type LanguageModel,
} from "ai";

import {
  getComposerReferenceImages,
  normalizeMessages,
  type AgentComposerMetadata,
} from "@/lib/agent/model-messages";
import {
  getOpenAICompatibleImageSizeCandidates,
} from "@/lib/agent/media-size";
import {
  isSeedanceVideoModel,
  normalizeOpenAICompatibleVideoResolution,
  normalizeOpenAICompatibleVideoSeconds,
  normalizeOpenAICompatibleVideoSize,
  normalizeSeedanceDuration,
  normalizeSeedanceRatio,
  normalizeSeedanceResolution,
} from "@/lib/agent/media-video";
import { createAgentEventStreamResponse } from "@/lib/agent/stream";
import type { AgentEvent, AgentMessage, AgentToolCall } from "@/lib/agent/types";
import {
  createMediaTask,
  transitionMediaTask,
  type MediaAsset,
  type MediaTask,
} from "@/lib/media/task-contract";
import {
  createDatabaseMediaTaskStore,
  mediaTaskStore,
  type MediaTaskStore,
} from "@/lib/media/task-store";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

type ChatRequestBody = {
  messages?: AgentMessage[];
  content?: string;
  model?: string;
  metadata?: {
    apiKey?: string;
    baseUrl?: string;
    protocol?: ChannelProtocol;
    composer?: AgentComposerMetadata;
    model?: string;
    modelKey?: string;
    modelRoutes?: Record<string, ModelRoute>;
  };
};

type ProviderRuntime = {
  apiKey?: string;
  baseUrl?: string;
  protocol?: ChannelProtocol;
  userId?: string;
};

type ChannelProtocol =
  | "openai-compatible"
  | "anthropic"
  | "google-gemini"
  | "volcengine-ark";

type ModelRoute = ProviderRuntime & {
  model: string;
};

type OpenAICompatibleImageResponse = {
  data?: Array<{
    b64_json?: string;
    revised_prompt?: string;
    url?: string;
  }>;
};

type MediaImageResult = {
  format?: string;
  height?: number;
  url: string;
  width?: number;
};

type MediaRequestParams = Record<string, boolean | number | string | undefined>;

type ImageGenerationResult = {
  images: MediaImageResult[];
  note?: string;
  requestParams?: MediaRequestParams;
  status: "success";
  mediaTaskId?: string;
};

type VideoGenerationResult = {
  format?: string;
  note?: string;
  providerStatus?: string;
  requestParams?: MediaRequestParams;
  status: "success";
  taskId?: string;
  thumbnailUrl?: string;
  url: string;
  mediaTaskId?: string;
};


type VideoGenerationState = {
  format?: string;
  providerStatus?: string;
  requestParams?: MediaRequestParams;
  taskId?: string;
  thumbnailUrl?: string;
  url?: string;
};

type ImageGenerationToolInput = {
  format?: string;
  prompt: string;
  ratio?: string;
  resolution?: string;
  style?: string;
};

type ResolvedImageGenerationToolInput = ImageGenerationToolInput & {
  model?: string;
  providerHint: "openai-compatible-image";
  referenceImage?: AgentComposerMetadata["referenceImage"];
  referenceImages: NonNullable<AgentComposerMetadata["referenceImages"]>;
  requestParams?: MediaRequestParams;
};

type VideoGenerationToolInput = {
  duration?: string;
  format?: string;
  prompt: string;
  ratio?: string;
  resolution?: string;
};

type ResolvedVideoGenerationToolInput = VideoGenerationToolInput & {
  model?: string;
  providerHint: "openai-compatible-video";
  requestParams?: MediaRequestParams;
};

type ChatMediaToolIntent = {
  enableImage: boolean;
  enableVideo: boolean;
};

type OpenAICompatibleVideoBody = {
  model: string;
  preset?: string;
  prompt: string;
  resolution?: string;
  resolution_name?: string;
  seconds?: string;
  size?: string;
  stream?: boolean | string;
};

const DEFAULT_MODEL = "openai/gpt-5-mini";
const IMAGE_GENERATION_PATH =
  process.env.OPENAI_COMPATIBLE_IMAGE_GENERATION_PATH?.trim() ||
  "images/generations";
const IMAGE_EDIT_PATH =
  process.env.OPENAI_COMPATIBLE_IMAGE_EDIT_PATH?.trim() || "images/edits";
const IMAGE_EDIT_FILE_FIELD =
  process.env.OPENAI_COMPATIBLE_IMAGE_EDIT_FILE_FIELD?.trim() || "image[]";
const IMAGE_CHAT_COMPLETIONS_PATH =
  process.env.OPENAI_COMPATIBLE_IMAGE_CHAT_COMPLETIONS_PATH?.trim() ||
  "chat/completions";
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const VIDEO_CREATE_PATH =
  process.env.OPENAI_COMPATIBLE_VIDEO_CREATE_PATH?.trim() ||
  "videos";
const VIDEO_STATUS_PATH =
  process.env.OPENAI_COMPATIBLE_VIDEO_STATUS_PATH?.trim() ||
  "videos/{id}";
const VIDEO_CONTENT_PATH =
  process.env.OPENAI_COMPATIBLE_VIDEO_CONTENT_PATH?.trim() ||
  "videos/{id}/content";
const SEEDANCE_VIDEO_CREATE_PATH =
  process.env.OPENAI_COMPATIBLE_SEEDANCE_VIDEO_CREATE_PATH?.trim() ||
  "contents/generations/tasks";
const SEEDANCE_VIDEO_STATUS_PATH =
  process.env.OPENAI_COMPATIBLE_SEEDANCE_VIDEO_STATUS_PATH?.trim() ||
  "contents/generations/tasks/{id}";
const VIDEO_STATUS_METHOD =
  process.env.OPENAI_COMPATIBLE_VIDEO_STATUS_METHOD?.trim().toUpperCase() ===
  "POST"
    ? "POST"
    : "GET";
const VIDEO_POLL_INTERVAL_MS = parsePositiveInt(
  process.env.OPENAI_COMPATIBLE_VIDEO_POLL_INTERVAL_MS,
  3000,
);
const VIDEO_POLL_TIMEOUT_MS = parsePositiveInt(
  process.env.OPENAI_COMPATIBLE_VIDEO_POLL_TIMEOUT_MS,
  180000,
);

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown runtime error.";
}

type ProviderErrorContext = "chat-tool" | "media-generation";

function toProviderErrorMessage(
  error: unknown,
  context: ProviderErrorContext = "media-generation",
) {
  if (context === "media-generation") {
    return toErrorMessage(error).trim() || "Generation failed.";
  }

  return sanitizeProviderErrorMessage(toErrorMessage(error), context);
}

function getInputFromPart<T extends ToolSet>(
  part: TextStreamPart<T>,
) {
  if ("input" in part) {
    return part.input;
  }

  if ("toolCall" in part) {
    return part.toolCall.input;
  }

  return {};
}

function getToolCallIdFromPart<T extends ToolSet>(
  part: TextStreamPart<T>,
) {
  if ("toolCallId" in part) {
    return part.toolCallId;
  }

  if ("toolCall" in part) {
    return part.toolCall.toolCallId;
  }

  return undefined;
}

function getToolNameFromPart<T extends ToolSet>(
  part: TextStreamPart<T>,
) {
  if ("toolName" in part) {
    return part.toolName;
  }

  if ("toolCall" in part) {
    return part.toolCall.toolName;
  }

  return "unknown_tool";
}

function hasGatewayCredentials() {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN ||
      process.env.VERCEL ||
      process.env.VERCEL_ENV,
  );
}

function resolveLanguageModel(body: ChatRequestBody) {
  const model = body.model || body.metadata?.model || DEFAULT_MODEL;
  const route =
    (body.metadata?.modelKey
      ? body.metadata?.modelRoutes?.[body.metadata.modelKey]
      : undefined) || body.metadata?.modelRoutes?.[model];
  const protocol = route?.protocol || body.metadata?.protocol || "openai-compatible";
  const baseUrl = (route?.baseUrl || body.metadata?.baseUrl)?.trim();
  const apiKey = (route?.apiKey || body.metadata?.apiKey)?.trim();

  if (baseUrl && apiKey) {
    const languageModel = createLanguageModel(protocol, apiKey, baseUrl, model);

    return {
      languageModel,
      model,
      runtime: protocol,
      providerRuntime: { apiKey, baseUrl, protocol },
      hasCredentials: true,
    };
  }

  return {
    languageModel: gateway(model),
    model,
    runtime: "ai-sdk-gateway",
    providerRuntime: { protocol },
    hasCredentials: hasGatewayCredentials(),
  };
}

function createLanguageModel(
  protocol: ChannelProtocol,
  apiKey: string,
  baseUrl: string,
  model: string,
) {
  if (protocol === "anthropic") {
    return createAnthropic({
      apiKey,
      baseURL: normalizeProviderBaseUrl(baseUrl, "https://api.anthropic.com/v1"),
      name: "agent-ui-anthropic",
    }).messages(model);
  }

  if (protocol === "google-gemini") {
    return createGoogleGenerativeAI({
      apiKey,
      baseURL: normalizeProviderBaseUrl(
        baseUrl,
        "https://generativelanguage.googleapis.com/v1beta",
      ),
      name: "agent-ui-google",
    }).languageModel(model);
  }

  // Ark exposes an OpenAI-compatible chat endpoint for text models. Its
  // native image/video endpoints are dispatched separately below.
  const provider: OpenAICompatibleProvider = createOpenAICompatible({
    apiKey,
    baseURL: baseUrl,
    name: "agent-ui-runtime",
  });
  return provider(model);
}

function normalizeProviderBaseUrl(baseUrl: string, fallback: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (/\/v1(?:beta)?$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized || fallback}/${fallback.endsWith("v1beta") ? "v1beta" : "v1"}`;
}

function resolveModelRoute(
  model: string | undefined,
  routes: Record<string, ModelRoute> | undefined,
  fallback: ProviderRuntime,
) {
  const route = model ? routes?.[model] : undefined;
  return {
    model: route?.model || model || "",
    runtime: {
      apiKey: route?.apiKey || fallback.apiKey,
      baseUrl: route?.baseUrl || fallback.baseUrl,
      protocol: route?.protocol || fallback.protocol || "openai-compatible",
      userId: fallback.userId,
    },
  };
}

function resolveComposerRoutes(
  composer: AgentComposerMetadata | undefined,
  routes: Record<string, ModelRoute> | undefined,
) {
  if (!composer) return composer;

  return {
    ...composer,
    imageModel: resolveModelRoute(composer.imageModel, routes, {}).model || undefined,
    videoModel: resolveModelRoute(composer.videoModel, routes, {}).model || undefined,
  };
}

function hasPattern(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function getLastMediaToolKind(messages: AgentMessage[] = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const toolName = messages[index]?.toolCall?.name;

    if (toolName === "image_generation") {
      return "image" as const;
    }

    if (toolName === "video_generation") {
      return "video" as const;
    }
  }

  return null;
}

export function detectChatMediaToolIntent({
  composer,
  content,
  messages,
}: {
  composer?: AgentComposerMetadata;
  content: string;
  messages?: AgentMessage[];
}): ChatMediaToolIntent {
  const text = content.trim();

  if (!text) {
    return {
      enableImage: false,
      enableVideo: false,
    };
  }

  const imageReferenceCount =
    (composer?.referenceImages?.length ?? 0) + (composer?.referenceImage ? 1 : 0);
  const hasReferenceImages = imageReferenceCount > 0;

  const analysisPatterns = [
    /describe|analy[sz]e|explain|identify|summari[sz]e|extract|ocr|caption|what(?:'s| is) in/i,
    /解释|分析|描述|识别|总结|提取|翻译|读图|看图|是什么|什么意思|检查|查看|有没有|是否|工具|agent|ocr/i,
  ];
  const imageGenerationPatterns = [
    /generate (an? )?(image|picture|photo|poster|cover|illustration)|create (an? )?(image|picture|poster|illustration)|render (an? )?image|edit (this )?image|make (an? )?(image|poster|cover)|image edit/i,
    /生图|生成.*(图片|图像|照片|海报|封面)|画.*图|做.*图|出.*图|图片生成|图像生成|海报|封面|插画|改图|修图|以图生图|参考图|(?:帮我)?(?:画|绘制|制作|创建|生成|做|来|整).{0,12}(?:一张|一幅|张图|图片|图像|照片|海报|封面|插画)|(?:先给我|给我|请给我).{0,4}(?:一张|一幅|张图|图片|图像|照片|海报|封面|插画)/i,
  ];
  const videoGenerationPatterns = [
    /generate (a )?video|create (a )?video|make (a )?video|animate|animation|motion clip|camera move/i,
    /生成.*视频|做.*视频|出.*视频|视频生成|动画|短片|运镜|镜头运动|(?:帮我)?(?:生成|制作|创建|做|来|整).{0,12}(?:一段|一个|个|段)视频|(?:先给我|给我|请给我).{0,4}(?:一段|一个|个|段)视频/i,
  ];
  const retryPatterns = [
    /retry|try again|regenerate|continue generating/i,
    /重试|再试|重新生成|继续生成|再来一次/i,
  ];
  const imageEditPatterns = [
    /keep .* unchanged|replace|swap|change .* to|use .* as reference/i,
    /保持|不变|替换|改成|换成|换掉|套上|参考.*衣服|参考.*款式/i,
  ];

  const wantsImage = hasPattern(text, imageGenerationPatterns);
  const wantsVideo = hasPattern(text, videoGenerationPatterns);
  const wantsAnalysis = hasPattern(text, analysisPatterns);
  const wantsRetry = hasPattern(text, retryPatterns);
  const wantsImageEdit =
    hasReferenceImages && hasPattern(text, imageEditPatterns);
  const asksAboutCapability =
    /(?:有没有|是否|能不能|能否|可以吗|检查|查看).*(?:图片|视频|生成|工具|agent|调用)/i.test(
      text,
    ) || /(?:图片|视频|生成|工具|agent).*(?:吗|么|？|\?)\s*$/i.test(text);

  if (asksAboutCapability && !wantsImageEdit) {
    return {
      enableImage: false,
      enableVideo: false,
    };
  }

  if (wantsAnalysis && !wantsImage && !wantsVideo && !wantsImageEdit) {
    return {
      enableImage: false,
      enableVideo: false,
    };
  }

  if (wantsImageEdit) {
    return {
      enableImage: true,
      enableVideo: false,
    };
  }

  if (wantsImage || wantsVideo) {
    return {
      enableImage: wantsImage,
      enableVideo: wantsVideo,
    };
  }

  if (wantsRetry) {
    const lastMediaToolKind = getLastMediaToolKind(messages);

    return {
      enableImage: lastMediaToolKind === "image",
      enableVideo: lastMediaToolKind === "video",
    };
  }

  if (
    hasReferenceImages &&
    !wantsAnalysis &&
    /prompt|提示词|改一下|优化一下|怎么做|怎么改/i.test(text)
  ) {
    return {
      enableImage: false,
      enableVideo: false,
    };
  }

  return {
    enableImage: false,
    enableVideo: false,
  };
}

function hasMediaGenerationRuntime(runtime: ProviderRuntime) {
  return Boolean(runtime.baseUrl?.trim() && runtime.apiKey?.trim());
}

function resolveMediaToolRoute(
  toolName: "image_generation" | "video_generation",
  composer: AgentComposerMetadata | undefined,
  modelRoutes: Record<string, ModelRoute> | undefined,
  fallback: ProviderRuntime,
) {
  const selectedModel =
    toolName === "video_generation"
      ? composer?.videoModel
      : composer?.imageModel;

  return resolveModelRoute(selectedModel, modelRoutes, fallback);
}

function hasUsableMediaToolRoute(
  toolName: "image_generation" | "video_generation",
  composer: AgentComposerMetadata | undefined,
  modelRoutes: Record<string, ModelRoute> | undefined,
  fallback: ProviderRuntime,
) {
  const route = resolveMediaToolRoute(toolName, composer, modelRoutes, fallback);

  return Boolean(
      route.model.trim() &&
      (route.runtime.protocol === "openai-compatible" ||
        route.runtime.protocol === "volcengine-ark") &&
      hasMediaGenerationRuntime(route.runtime),
  );
}

function resolveAvailableMediaToolIntent({
  composer,
  enabledTools,
  modelRoutes,
  runtime,
}: {
  composer?: AgentComposerMetadata;
  enabledTools: ChatMediaToolIntent;
  modelRoutes?: Record<string, ModelRoute>;
  runtime: ProviderRuntime;
}): ChatMediaToolIntent {
  return {
    enableImage:
      enabledTools.enableImage &&
      hasUsableMediaToolRoute(
        "image_generation",
        composer,
        modelRoutes,
        runtime,
      ),
    enableVideo:
      enabledTools.enableVideo &&
      hasUsableMediaToolRoute(
        "video_generation",
        composer,
        modelRoutes,
        runtime,
      ),
  };
}

function createAiSdkInstructions(
  composer: AgentComposerMetadata | undefined,
  mediaTools: ChatMediaToolIntent,
) {
  const mediaToolsEnabled = mediaTools.enableImage || mediaTools.enableVideo;
  const lines = [
    "You are a concise agent UI assistant.",
    "Reply directly for ordinary chat, analysis, and questions.",
    "Never use a media tool for explanation, analysis, OCR, description, summarization, or image understanding requests.",
    "Only use a media tool when the user is explicitly asking to generate, create, render, edit, animate, retry generation, or produce media.",
    "When the latest user message includes attached images and the request is to explain, analyze, describe, identify, or read the image, answer from the actual visible image content instead of inferring generation intent from earlier conversation context.",
  ];

  if (!mediaToolsEnabled) {
    lines.push(
      "Image and video generation tools are disabled for this request. Answer with text only.",
    );
    return lines.join(" ");
  }

  if (mediaTools.enableImage) {
    lines.push(
      "The `image_generation` tool is enabled for this request. Use it only if the user wants an image, poster, illustration, photo edit, variation, or image-based reference transformation.",
    );
  }

  if (mediaTools.enableVideo) {
    lines.push(
      "The `video_generation` tool is enabled for this request. Use it only if the user wants a video, animation, motion clip, trailer, or moving scene.",
    );
  }

  if (mediaTools.enableImage && mediaTools.enableVideo) {
    lines.push(
      "Do not call both media tools unless the user clearly asks for both outputs.",
    );
  }

  lines.push(
    "The registered image/video tools are the app's real generation path. Do not claim that you cannot access local generators or ask the user to copy a prompt when an explicit generation request can be fulfilled with a tool.",
    "When reference images are attached in the composer, the enabled media tools will automatically receive them. Do not ask the user to re-attach them unless they want to replace them.",
    "When calling media tools, treat the current image/video defaults as authoritative for model, ratio, resolution, format, style, and duration; do not override them unless the app has no configured value.",
  );

  if (composer?.imageModel) {
    lines.push(
      `Current image defaults: model ${composer.imageModel}, ratio ${composer.ratio || "1:1"}, resolution ${composer.resolution || "1080p"}, quality high, format png, style ${composer.style || "auto"}.`,
    );
  }

  if (composer?.videoModel) {
    lines.push(
      `Current video defaults: model ${composer.videoModel}, duration ${composer.duration || "5"}, ratio ${composer.ratio || "16:9"}, resolution ${composer.resolution || "1080p"}, format ${composer.videoFormat || "mp4"}.`,
    );
  }

  if ((composer?.referenceImages?.length ?? 0) > 0 || composer?.referenceImage) {
    lines.push("There are reference images available in the current composer state.");
  }

  return lines.join(" ");
}

function createAiSdkTools({
  composer,
  enabledTools,
  modelRoutes,
  runtime,
}: {
  composer?: AgentComposerMetadata;
  enabledTools: ChatMediaToolIntent;
  modelRoutes?: Record<string, ModelRoute>;
  runtime: ProviderRuntime;
}): ToolSet {
  const availableTools = resolveAvailableMediaToolIntent({
    composer,
    enabledTools,
    modelRoutes,
    runtime,
  });

  if (!availableTools.enableImage && !availableTools.enableVideo) {
    return {};
  }

  const tools: ToolSet = {};

  if (availableTools.enableImage) {
    tools.image_generation = tool({
      description:
        "Generate or edit a single image with the app-configured image provider. Reference images from the current composer are attached automatically.",
      inputSchema: jsonSchema<ImageGenerationToolInput>({
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Complete image prompt with subject, style, composition, and desired output.",
          },
          ratio: {
            type: "string",
            description: "Optional aspect ratio such as 1:1, 3:2, 16:9, or 9:16.",
          },
          resolution: {
            type: "string",
            description: "Optional resolution label such as 720p, 1080p, 2k, or 4k.",
          },
          format: {
            type: "string",
            description: "Optional image format such as png, jpeg, or webp.",
          },
          style: {
            type: "string",
            description: "Optional visual style such as auto, photo, illustration, or product.",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      }),
      execute: async ({ format, prompt, ratio, resolution, style }) => {
        const imageRoute = resolveModelRoute(
          composer?.imageModel,
          modelRoutes,
          runtime,
        );
        const imageComposer = resolveComposerRoutes(composer, modelRoutes);
        const finalArgs = resolveMediaToolArgs(
          "image_generation",
          { format, prompt, ratio, resolution, style },
          imageComposer,
          imageRoute.runtime,
        ) as ResolvedImageGenerationToolInput;

        const resolvedImageComposer = {
          ...imageComposer,
          mode: "image" as const,
          imageFormat: finalArgs.format,
          imageModel: finalArgs.model,
          ratio: finalArgs.ratio,
          resolution: finalArgs.resolution,
          style: finalArgs.style,
          template: "none" as const,
          templatePrompt: undefined,
        };
        return imageRoute.runtime.protocol === "volcengine-ark"
          ? generateImageWithArk({
              apiKey: imageRoute.runtime.apiKey!,
              baseUrl: imageRoute.runtime.baseUrl!,
              composer: resolvedImageComposer,
              prompt: finalArgs.prompt,
            })
          : generateImageWithOpenAICompatible({
              apiKey: imageRoute.runtime.apiKey!,
              baseUrl: imageRoute.runtime.baseUrl!,
              composer: resolvedImageComposer,
              prompt: finalArgs.prompt,
            });
      },
    });
  }

  if (availableTools.enableVideo) {
    tools.video_generation = tool({
      description:
        "Generate a single video with the app-configured video provider.",
      inputSchema: jsonSchema<VideoGenerationToolInput>({
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Complete video prompt with scene, motion, camera, style, and pacing.",
          },
          duration: {
            type: "string",
            description: "Optional duration such as 5, 8, or 10 seconds.",
          },
          ratio: {
            type: "string",
            description: "Optional aspect ratio such as 16:9 or 9:16.",
          },
          resolution: {
            type: "string",
            description: "Optional resolution label such as 720p, 1080p, 2k, or 4k.",
          },
          format: {
            type: "string",
            description: "Optional video format such as mp4, webm, or mov.",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      }),
      execute: async ({ duration, format, prompt, ratio, resolution }) => {
        const videoRoute = resolveModelRoute(
          composer?.videoModel,
          modelRoutes,
          runtime,
        );
        const videoComposer = resolveComposerRoutes(composer, modelRoutes);
        const finalArgs = resolveMediaToolArgs(
          "video_generation",
          { duration, format, prompt, ratio, resolution },
          videoComposer,
          videoRoute.runtime,
        ) as ResolvedVideoGenerationToolInput;

        return generateVideoWithOpenAICompatible({
          apiKey: videoRoute.runtime.apiKey!,
          baseUrl: videoRoute.runtime.baseUrl!,
          protocol: videoRoute.runtime.protocol,
          composer: {
            ...videoComposer,
            mode: "video",
            duration: finalArgs.duration,
            ratio: finalArgs.ratio,
            resolution: finalArgs.resolution,
            videoFormat: finalArgs.format,
            videoModel: finalArgs.model,
          },
          prompt: finalArgs.prompt,
        });
      },
    });
  }

  return tools;
}

function resolveMediaToolArgs(
  toolName: string,
  args: unknown,
  composer?: AgentComposerMetadata,
  runtime?: ProviderRuntime,
): unknown {
  if (toolName === "image_generation") {
    const input = (args ?? {}) as Partial<ImageGenerationToolInput>;
    const referenceImages = composer ? getComposerReferenceImages(composer) : [];

    return {
      ...input,
      format: composer?.imageFormat ?? input.format,
      model: composer?.imageModel,
      prompt: input.prompt ?? "",
      providerHint: "openai-compatible-image" as const,
      ratio: composer?.ratio ?? input.ratio,
      referenceImage: composer?.referenceImage,
      referenceImages,
      requestParams: composer
          ? createImageRequestParamsForComposer(
              composer,
              input.prompt ?? "",
              referenceImages.length,
              runtime?.baseUrl,
            )
          : undefined,
      resolution: composer?.resolution ?? input.resolution,
      style: composer?.style ?? input.style,
    } satisfies ResolvedImageGenerationToolInput;
  }

  if (toolName === "video_generation") {
    const input = (args ?? {}) as Partial<VideoGenerationToolInput>;

    return {
      ...input,
      duration: composer?.duration ?? input.duration,
      format: composer?.videoFormat ?? input.format,
      model: composer?.videoModel,
      prompt: input.prompt ?? "",
      providerHint: "openai-compatible-video" as const,
      requestParams: composer
        ? createVideoRequestParamsForComposer(
            composer,
            input.prompt ?? "",
            runtime?.baseUrl,
          )
        : undefined,
      ratio: composer?.ratio ?? input.ratio,
      resolution: composer?.resolution ?? input.resolution,
    } satisfies ResolvedVideoGenerationToolInput;
  }

  return args;
}

async function* createFallbackEvents(): AsyncIterable<AgentEvent> {
  const assistantMessage: AgentMessage = {
    id: createId("msg"),
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
  };
  const chunks = [
    "No AI Gateway credentials were found, ",
    "so chat fell back to a simple local response. ",
    "Configure an OpenAI-compatible Base URL and API Key to enable the full runtime.",
  ];

  yield {
    type: "message.created",
    message: assistantMessage,
  };

  for (const delta of chunks) {
    yield {
      type: "message.delta",
      messageId: assistantMessage.id,
      delta,
    };
  }

  yield {
    type: "message.done",
    messageId: assistantMessage.id,
  };
}

async function* createMediaGenerationEvents({
  composer,
  prompt,
  runtime,
}: {
  composer: AgentComposerMetadata;
  prompt: string;
  runtime: ProviderRuntime;
}): AsyncIterable<AgentEvent> {
  const isVideo = composer.mode === "video";
  const taskStore = runtime.userId
    ? createDatabaseMediaTaskStore(runtime.userId)
    : mediaTaskStore;
  const mediaTaskId = createId("media_task");
  const mediaTaskKind = isVideo ? "video" : "image";
  let mediaTask = createMediaTask({
    id: mediaTaskId,
    kind: mediaTaskKind,
    provider: runtime.protocol === "volcengine-ark" ? "volcengine-ark" : "openai-compatible",
    protocol: runtime.protocol ?? "openai-compatible",
    model: (isVideo ? composer.videoModel : composer.imageModel) ?? "",
    request: {
      prompt,
      ratio: composer.ratio,
      resolution: composer.resolution,
      referenceCount: getComposerReferenceImages(composer).length,
    },
  });
  await taskStore.create(mediaTask);
  mediaTask = transitionMediaTask(mediaTask, { type: "start" });
  await taskStore.update(mediaTask);
  const imageRequestParams = isVideo
    ? undefined
    : createImageRequestParamsForComposer(
        composer,
        prompt,
        getComposerReferenceImages(composer).length,
        runtime.baseUrl,
      );
  const videoRequestParams = isVideo
    ? createVideoRequestParamsForComposer(composer, prompt, runtime.baseUrl)
    : undefined;
  const toolMessage: AgentMessage = {
    id: createId("msg"),
    role: "tool",
    content: "",
    createdAt: new Date().toISOString(),
  };
  const toolCall: AgentToolCall = {
    id: createId("tool"),
    name: isVideo ? "video_generation" : "image_generation",
    args: {
      prompt,
      model: isVideo ? composer.videoModel : composer.imageModel,
      ratio: composer.ratio,
      resolution: composer.resolution,
      format: isVideo ? composer.videoFormat : composer.imageFormat,
      ...(isVideo
        ? { duration: composer.duration, requestParams: videoRequestParams }
        : {
          referenceImages: getComposerReferenceImages(composer),
          referenceImage: composer.referenceImage,
          requestParams: imageRequestParams,
          style: composer.style,
        }),
      providerHint: isVideo ? "openai-compatible-video" : "openai-compatible-image",
      mediaTaskId,
    },
    status: "pending",
  };

  yield {
    type: "message.created",
    message: toolMessage,
  };
  yield {
    type: "tool.pending",
    messageId: toolMessage.id,
    toolCall,
  };
  yield {
    type: "tool.running",
    messageId: toolMessage.id,
    toolCallId: toolCall.id,
  };

  if (!runtime.baseUrl?.trim() || !runtime.apiKey?.trim()) {
    const mediaLabel = isVideo ? "Video" : "Image";
    const error = `${mediaLabel} generation requires a Base URL and API Key.`;
    await failMediaTask(mediaTask, error, taskStore);

    yield {
      type: "tool.error",
      messageId: toolMessage.id,
      toolCallId: toolCall.id,
      error,
    };
    return;
  }

  if (
    runtime.protocol !== "openai-compatible" &&
    runtime.protocol !== "volcengine-ark"
  ) {
    const protocolLabel =
      runtime.protocol === "anthropic"
        ? "Anthropic 官方协议"
        : "Google Gemini 官方协议";
    const error = `${protocolLabel}目前仅支持对话模型，图片和视频生成请使用 OpenAI 兼容或火山方舟渠道。`;
    await failMediaTask(mediaTask, error, taskStore);
    yield {
      type: "tool.error",
      messageId: toolMessage.id,
      toolCallId: toolCall.id,
      error,
    };
    return;
  }

  try {
    if (isVideo) {
      const result = await generateVideoWithOpenAICompatible({
        apiKey: runtime.apiKey,
        baseUrl: runtime.baseUrl,
        protocol: runtime.protocol,
        composer,
        prompt,
      });
      const resultWithTask = { ...result, mediaTaskId };
      mediaTask = transitionMediaTask(mediaTask, {
        type: "succeed",
        output: mediaResultToAssets(resultWithTask, "video"),
      });
      await taskStore.update(mediaTask);

      yield {
        type: "tool.done",
        messageId: toolMessage.id,
        toolCallId: toolCall.id,
        result: resultWithTask,
      };
      return;
    }

    const result = runtime.protocol === "volcengine-ark"
      ? await generateImageWithArk({
          apiKey: runtime.apiKey,
          baseUrl: runtime.baseUrl,
          composer,
          prompt,
        })
      : await generateImageWithOpenAICompatible({
          apiKey: runtime.apiKey,
          baseUrl: runtime.baseUrl,
          composer,
          prompt,
        });

    const resultWithTask = { ...result, mediaTaskId };
    mediaTask = transitionMediaTask(mediaTask, {
      type: "succeed",
      output: mediaResultToAssets(resultWithTask, "image"),
    });
    await taskStore.update(mediaTask);

    yield {
      type: "tool.done",
      messageId: toolMessage.id,
      toolCallId: toolCall.id,
      result: resultWithTask,
    };
  } catch (error) {
    const errorMessage = toProviderErrorMessage(error);
    await failMediaTask(mediaTask, errorMessage, taskStore);

    yield {
      type: "tool.error",
      messageId: toolMessage.id,
      toolCallId: toolCall.id,
      error: errorMessage,
      result: isVideo
          ? {
            requestParams: videoRequestParams,
            mediaTaskId,
            status: "error",
          }
          : {
            requestParams: imageRequestParams,
            mediaTaskId,
            status: "error",
          },
    };
  }
}

async function* createChatMediaToolEvents({
  composer,
  intent,
  modelRoutes,
  runtime,
  prompt,
}: {
  composer: AgentComposerMetadata;
  intent: ChatMediaToolIntent;
  modelRoutes?: Record<string, ModelRoute>;
  runtime: ProviderRuntime;
  prompt: string;
}): AsyncIterable<AgentEvent> {
  const resolvedComposer = resolveComposerRoutes(composer, modelRoutes)!;

  for (const mode of ["image", "video"] as const) {
    const toolName = `${mode}_generation` as const;

    if (
      !(mode === "image" ? intent.enableImage : intent.enableVideo)
    ) {
      continue;
    }

    const mediaRoute = resolveMediaToolRoute(
      toolName,
      composer,
      modelRoutes,
      runtime,
    );

    yield* createMediaGenerationEvents({
      composer: {
        ...resolvedComposer,
        mode,
      },
      prompt,
      runtime: mediaRoute.runtime,
    });
  }
}

async function failMediaTask(
  task: MediaTask,
  message: string,
  taskStore: MediaTaskStore,
) {
  try {
    await taskStore.update(
      transitionMediaTask(task, {
        type: "fail",
        error: {
          message,
          retryable: isRetryableMediaError(message),
        },
      }),
    );
  } catch {
    // Task bookkeeping must not hide the provider error from the chat stream.
  }
}

function mediaResultToAssets(
  result: ImageGenerationResult | VideoGenerationResult,
  kind: "image" | "video",
): MediaAsset[] {
  if (kind === "video") {
    return [
      {
        id: `${result.mediaTaskId ?? "media"}-asset-1`,
        kind,
        url: (result as VideoGenerationResult).url,
        thumbnailUrl: (result as VideoGenerationResult).thumbnailUrl,
        metadata: {
          providerStatus: (result as VideoGenerationResult).providerStatus,
          providerTaskId: (result as VideoGenerationResult).taskId,
        },
      },
    ];
  }

  return (result as ImageGenerationResult).images.map((image, index) => ({
    id: `${result.mediaTaskId ?? "media"}-asset-${index + 1}`,
    kind,
    url: image.url,
    width: image.width,
    height: image.height,
    metadata: { format: image.format },
  }));
}

function isRetryableMediaError(message: string) {
  return /timeout|timed out|fetch failed|temporar|rate limit|429|5\d\d/i.test(message);
}

async function generateImageWithOpenAICompatible({
  apiKey,
  baseUrl,
  composer,
  prompt,
}: {
  apiKey: string;
  baseUrl: string;
  composer: AgentComposerMetadata;
  prompt: string;
}): Promise<ImageGenerationResult> {
  const imageSizeCandidates = getOpenAICompatibleImageSizeCandidates(
    composer.resolution ?? "1080p",
    composer.ratio ?? "1:1",
  );
  const referenceImages = getComposerReferenceImages(composer);
  const imageSize = imageSizeCandidates[0];
  const usesChatCompletionsImage = isChatCompletionsImageModel(
    composer.imageModel,
  );
  const requestParams = createImageRequestParams({
    baseUrl,
    composer,
    contentType:
      usesChatCompletionsImage || !referenceImages.length
        ? "application/json"
        : "multipart/form-data",
    endpoint: usesChatCompletionsImage
      ? IMAGE_CHAT_COMPLETIONS_PATH
      : referenceImages.length
        ? IMAGE_EDIT_PATH
        : IMAGE_GENERATION_PATH,
    imageSize,
    prompt,
    referenceCount: referenceImages.length,
  });

  if (usesChatCompletionsImage) {
    const chatRequestParams = createChatCompletionsImageRequestParams({
      baseUrl,
      composer,
      prompt,
      referenceImages,
      referenceCount: referenceImages.length,
    });
    const images = await requestChatCompletionsImageResult({
      apiKey,
      baseUrl,
      composer,
      prompt,
      referenceImages,
    });

    return {
      status: "success",
      images,
      requestParams: chatRequestParams,
      note: "Generated through the OpenAI-compatible chat completions image endpoint.",
    };
  }

  const payload = referenceImages.length
    ? await requestOpenAICompatibleImageEditPayload({
        apiKey,
        baseUrl,
        composer,
        imageSize,
        prompt,
        referenceImages,
      })
    : await requestOpenAICompatibleImagePayload({
        apiKey,
        baseUrl,
        body: {
          ...createOpenAICompatibleImageBaseBody({
            composer,
            imageSize,
          }),
          prompt,
        },
      });
  const images = await extractImagesFromPayload(payload, composer);

  return {
    status: "success",
    images,
    requestParams,
    note: referenceImages.length
      ? `Generated through the OpenAI-compatible image edit endpoint with ${referenceImages.length} reference image${referenceImages.length > 1 ? "s" : ""}.`
      : "Generated through the OpenAI-compatible image generation endpoint.",
  };
}

function createChatCompletionsImageRequestParams({
  baseUrl,
  composer,
  prompt,
  referenceImages,
  referenceCount,
}: {
  baseUrl?: string;
  composer: AgentComposerMetadata;
  prompt: string;
  referenceImages?: NonNullable<AgentComposerMetadata["referenceImages"]>;
  referenceCount: number;
}): MediaRequestParams {
  const body = createChatCompletionImageRequestBody({
    composer,
    prompt,
    referenceImages: sanitizeReferenceImagesForRequestPreview(referenceImages),
  });

  return {
    endpoint: IMAGE_CHAT_COMPLETIONS_PATH,
    ...(baseUrl ? { requestUrl: createApiUrl(baseUrl, IMAGE_CHAT_COMPLETIONS_PATH) } : {}),
    method: "POST",
    contentType: "application/json",
    model: composer.imageModel,
    prompt,
    requestBody: stringifyRequestBody(body),
    stream: true,
    temperature: 0.7,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    referenceCount,
  };
}

function createImageRequestParams({
  baseUrl,
  composer,
  contentType,
  endpoint,
  imageSize,
  prompt,
  referenceCount,
}: {
  baseUrl?: string;
  composer: AgentComposerMetadata;
  contentType: string;
  endpoint: string;
  imageSize?: { size: string; width: number; height: number };
  prompt: string;
  referenceCount: number;
}): MediaRequestParams {
  const body = {
    ...createOpenAICompatibleImageBaseBody({
      composer,
      imageSize,
    }),
    prompt,
  };

  return {
    endpoint,
    ...(baseUrl ? { requestUrl: createApiUrl(baseUrl, endpoint) } : {}),
    method: "POST",
    contentType,
    model: composer.imageModel,
    prompt,
    n: 1,
    output_format:
      typeof body.output_format === "string" ? body.output_format : undefined,
    quality: typeof body.quality === "string" ? body.quality : undefined,
    requestBody: contentType === "application/json" ? stringifyRequestBody(body) : undefined,
    response_format:
      typeof body.response_format === "string" ? body.response_format : undefined,
    size: imageSize?.size,
    referenceCount,
  };
}

function createImageRequestParamsForComposer(
  composer: AgentComposerMetadata,
  prompt: string,
  referenceCount: number,
  baseUrl?: string,
) {
  const imageSize = getOpenAICompatibleImageSizeCandidates(
    composer.resolution ?? "1080p",
    composer.ratio ?? "1:1",
  )[0];
  const usesChatCompletionsImage = isChatCompletionsImageModel(
    composer.imageModel,
  );

  if (usesChatCompletionsImage) {
    return createChatCompletionsImageRequestParams({
      baseUrl,
      composer,
      prompt,
      referenceImages: getComposerReferenceImages(composer),
      referenceCount,
    });
  }

  return createImageRequestParams({
    baseUrl,
    composer,
    contentType: referenceCount > 0 ? "multipart/form-data" : "application/json",
    endpoint: referenceCount > 0 ? IMAGE_EDIT_PATH : IMAGE_GENERATION_PATH,
    imageSize,
    prompt,
    referenceCount,
  });
}

function createVideoRequestParamsForComposer(
  composer: AgentComposerMetadata,
  prompt: string,
  baseUrl?: string,
): MediaRequestParams {
  return isSeedanceVideoModel(composer.videoModel)
    ? createSeedanceVideoRequestParams({ baseUrl, composer, prompt })
    : createOpenAICompatibleVideoRequestParams({ baseUrl, composer, prompt });
}

function createOpenAICompatibleVideoRequestParams({
  baseUrl,
  composer,
  prompt,
}: {
  baseUrl?: string;
  composer: AgentComposerMetadata;
  prompt: string;
}): MediaRequestParams {
  const body = createOpenAICompatibleVideoFormBody(composer, prompt);
  const referenceCount = getComposerReferenceImages(composer).length;
  const usesMultipart = referenceCount > 0;
  const requestBody = referenceCount
    ? {
        ...body,
        ...(referenceCount ? { "input_reference[]": `[${referenceCount} image(s)]` } : {}),
      }
    : createOpenAICompatibleVideoJsonBody(body);

  return {
    endpoint: VIDEO_CREATE_PATH,
    ...(baseUrl ? { requestUrl: createApiUrl(baseUrl, VIDEO_CREATE_PATH) } : {}),
    method: "POST",
    contentType: usesMultipart ? "multipart/form-data" : "application/json",
    model: body.model,
    prompt,
    seconds: body.seconds,
    size: body.size,
    ...(usesMultipart
      ? {
          resolution: body.resolution,
          resolution_name: body.resolution_name,
          preset: body.preset,
          stream: body.stream,
        }
      : {
          resolution: body.resolution,
          stream: true,
        }),
    requestBody: stringifyRequestBody(requestBody),
    referenceCount,
  };
}

function createSeedanceVideoRequestParams({
  baseUrl,
  composer,
  prompt,
}: {
  baseUrl?: string;
  composer: AgentComposerMetadata;
  prompt: string;
}): MediaRequestParams {
  const body = createSeedanceVideoRequestBody(composer, prompt);

  return {
    endpoint: SEEDANCE_VIDEO_CREATE_PATH,
    ...(baseUrl
      ? { requestUrl: createApiUrl(baseUrl, SEEDANCE_VIDEO_CREATE_PATH) }
      : {}),
    method: "POST",
    contentType: "application/json",
    model: typeof body.model === "string" ? body.model : undefined,
    prompt,
    ratio: typeof body.ratio === "string" ? body.ratio : undefined,
    resolution: typeof body.resolution === "string" ? body.resolution : undefined,
    duration:
      typeof body.duration === "number" || typeof body.duration === "string"
        ? body.duration
        : undefined,
    generate_audio:
      typeof body.generate_audio === "boolean" ? body.generate_audio : undefined,
    watermark: typeof body.watermark === "boolean" ? body.watermark : undefined,
    requestBody: stringifyRequestBody(body),
  };
}

function createOpenAICompatibleVideoFormBody(
  composer: AgentComposerMetadata,
  prompt: string,
): OpenAICompatibleVideoBody {
  const seconds = normalizeOpenAICompatibleVideoSeconds(
    composer.duration,
    composer.videoModel,
  );

  return {
    model: composer.videoModel ?? "",
    prompt,
    seconds,
    size: normalizeOpenAICompatibleVideoSize(composer.ratio),
    resolution: normalizeOpenAICompatibleVideoResolution(composer.resolution),
    resolution_name: normalizeOpenAICompatibleVideoResolution(composer.resolution),
    preset: "normal",
    stream: "true",
  };
}

function createOpenAICompatibleVideoJsonBody(
  body: OpenAICompatibleVideoBody,
) {
  return {
    model: body.model,
    prompt: body.prompt,
    seconds: body.seconds,
    size: body.size,
    resolution: body.resolution,
    stream: true,
  };
}

function createSeedanceVideoRequestBody(
  composer: AgentComposerMetadata,
  prompt: string,
) {
  return {
    model: composer.videoModel ?? "",
    content: createSeedanceVideoContent(composer, prompt),
    ratio: normalizeSeedanceRatio(composer.ratio),
    resolution: normalizeSeedanceResolution(
      composer.resolution,
      composer.videoModel,
    ),
    duration: normalizeSeedanceDuration(composer.duration),
    generate_audio: true,
    watermark: false,
  };
}

function createSeedanceVideoContent(
  composer: AgentComposerMetadata,
  prompt: string,
) {
  return [
    { type: "text", text: prompt },
    ...getComposerReferenceImages(composer)
      .slice(0, 9)
      .map((referenceImage) => ({
        type: "image_url",
        image_url: { url: referenceImage.url },
        role: "reference_image",
      })),
  ];
}

function isChatCompletionsImageModel(model?: string) {
  const normalized = model?.trim().toLowerCase() ?? "";

  return (
    normalized === "nano-banana" ||
    normalized.startsWith("nano-banana-")
  );
}

function normalizeImageOutputFormat() {
  return "png";
}

function createChatCompletionImageRequestBody({
  composer,
  prompt,
  referenceImages,
}: {
  composer: AgentComposerMetadata;
  prompt: string;
  referenceImages?: NonNullable<AgentComposerMetadata["referenceImages"]>;
}) {
  return {
    model: composer.imageModel,
    messages: [
      {
        role: "user",
        content: createChatCompletionImageContent(prompt, referenceImages ?? []),
      },
    ],
    stream: true,
    temperature: 0.7,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  };
}

function sanitizeReferenceImagesForRequestPreview(
  referenceImages?: NonNullable<AgentComposerMetadata["referenceImages"]>,
) {
  return (referenceImages ?? []).map((referenceImage, index) => ({
    ...referenceImage,
    url: summarizeRequestImageUrl(referenceImage.url, index),
  }));
}

function summarizeRequestImageUrl(url: string | undefined, index: number) {
  if (!url) {
    return `[reference image ${index + 1}]`;
  }

  if (url.startsWith("data:")) {
    return `[reference image ${index + 1}: data URL]`;
  }

  return url;
}

function stringifyRequestBody(body: unknown) {
  return JSON.stringify(body, null, 2);
}

function createOpenAICompatibleImageBaseBody({
  composer,
  imageSize,
}: {
  composer: AgentComposerMetadata;
  imageSize?: { size: string; width: number; height: number };
}) {
  return {
    model: composer.imageModel,
    n: 1,
    ...(imageSize ? { size: imageSize.size } : {}),
    quality: "high",
    response_format: "b64_json",
    output_format: normalizeImageOutputFormat(),
  };
}

async function requestOpenAICompatibleImagePayload({
  apiKey,
  baseUrl,
  body,
}: {
  apiKey: string;
  baseUrl: string;
  body: Record<string, unknown>;
}) {
  const response = await fetch(createApiUrl(baseUrl, IMAGE_GENERATION_PATH), {
    method: "POST",
    headers: {
      Authorization: createBearerAuthHeader(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await getErrorResponseText(response));
  }

  return await parseOpenAICompatibleImageResponse(response);
}

async function requestChatCompletionsImageResult({
  apiKey,
  baseUrl,
  composer,
  prompt,
  referenceImages,
}: {
  apiKey: string;
  baseUrl: string;
  composer: AgentComposerMetadata;
  prompt: string;
  referenceImages: NonNullable<AgentComposerMetadata["referenceImages"]>;
}) {
  const response = await fetch(createApiUrl(baseUrl, IMAGE_CHAT_COMPLETIONS_PATH), {
    method: "POST",
    headers: {
      Authorization: createBearerAuthHeader(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      createChatCompletionImageRequestBody({
        composer,
        prompt,
        referenceImages,
      }),
    ),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await getErrorResponseText(response));
  }

  const { payload, text } = await readChatCompletionImageResponse(response);
  const imageUrls = extractImageUrls(payload, text);

  if (!imageUrls.length) {
    throw new Error(
      "Chat completions image endpoint returned no image URL or base64 payload.",
    );
  }

  return await Promise.all(
    imageUrls.map(async (url) => {
      const dimensions = await readImageDimensionsFromUrl(url);

      return {
        url,
        width: dimensions?.width,
        height: dimensions?.height,
        format: dimensions?.format ?? composer.imageFormat ?? inferMediaFormat(url),
      } satisfies MediaImageResult;
    }),
  );
}

function createChatCompletionImageContent(
  prompt: string,
  referenceImages: NonNullable<AgentComposerMetadata["referenceImages"]>,
) {
  if (!referenceImages.length) {
    return prompt;
  }

  return [
    { type: "text", text: prompt },
    ...referenceImages.map((referenceImage) => ({
      type: "image_url",
      image_url: { url: referenceImage.url },
    })),
  ];
}

async function readChatCompletionImageResponse(response: Response) {
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    const payload = await parseJsonIfPresent(response);

    return {
      payload,
      text: extractChatCompletionText(payload),
    };
  }

  if (!response.body) {
    throw new Error("Chat completions image endpoint returned no readable stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const payloads: unknown[] = [];
  let buffer = "";
  let text = "";

  const processBlock = (block: string) => {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);

    for (const data of dataLines) {
      if (data === "[DONE]") {
        continue;
      }

      const payload = JSON.parse(data) as unknown;
      payloads.push(payload);
      text += extractChatCompletionText(payload);
    }
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.search(/\r?\n\r?\n/);
    while (separatorIndex >= 0) {
      const separator = buffer.match(/\r?\n\r?\n/)?.[0] ?? "\n\n";
      processBlock(buffer.slice(0, separatorIndex));
      buffer = buffer.slice(separatorIndex + separator.length);
      separatorIndex = buffer.search(/\r?\n\r?\n/);
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    processBlock(buffer);
  }

  return { payload: payloads, text };
}

async function requestOpenAICompatibleImageEditPayload({
  apiKey,
  baseUrl,
  composer,
  imageSize,
  prompt,
  referenceImages,
}: {
  apiKey: string;
  baseUrl: string;
  composer: AgentComposerMetadata;
  imageSize?: { size: string; width: number; height: number };
  prompt: string;
  referenceImages: NonNullable<AgentComposerMetadata["referenceImages"]>;
}) {
  const resolvedReferenceImages = await Promise.all(
    referenceImages.map((referenceImage, index) =>
      resolveReferenceImageBlob(referenceImage, index),
    ),
  );
  const formData = new FormData();
  const baseBody = createOpenAICompatibleImageBaseBody({
    composer,
    imageSize,
  });

  formData.append("model", composer.imageModel ?? "");
  formData.append("prompt", prompt);
  formData.append("n", "1");
  appendOptionalFormValue(formData, "quality", baseBody.quality);
  appendOptionalFormValue(formData, "response_format", baseBody.response_format);
  appendOptionalFormValue(formData, "output_format", baseBody.output_format);

  if (imageSize) {
    formData.append("size", imageSize.size);
  }

  for (const referenceImage of resolvedReferenceImages) {
    formData.append(
      IMAGE_EDIT_FILE_FIELD,
      referenceImage.blob,
      referenceImage.filename,
    );
  }

  const response = await fetch(createApiUrl(baseUrl, IMAGE_EDIT_PATH), {
    method: "POST",
    headers: {
      Authorization: createBearerAuthHeader(apiKey),
    },
    body: formData,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await getErrorResponseText(response));
  }

  return await parseOpenAICompatibleImageResponse(response);
}

async function parseOpenAICompatibleImageResponse(response: Response) {
  const payload = await parseJsonIfPresent(response);

  if (!isRecord(payload)) {
    throw new Error("The image provider returned a non-object JSON payload.");
  }

  return payload as OpenAICompatibleImageResponse;
}

async function resolveReferenceImageBlob(
  referenceImage: NonNullable<AgentComposerMetadata["referenceImages"]>[number],
  index = 0,
) {
  const url = referenceImage.url?.trim();

  if (!url) {
    throw new Error("Reference image URL is empty; cannot submit it to the image edit endpoint.");
  }

  const trimmedUrl = url;
  const blob = trimmedUrl.startsWith("data:")
    ? dataUrlToImageBlob(trimmedUrl)
    : await fetchReferenceImageBlob(trimmedUrl);

  if (blob.size <= 0) {
    throw new Error("Reference image content is empty; cannot submit it to the image edit endpoint.");
  }

  if (blob.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(
      `Reference image is too large: ${formatMiB(blob.size)}. Limit: ${formatMiB(
        MAX_REFERENCE_IMAGE_BYTES,
      )}.`,
    );
  }

  const mimeType = normalizeImageMimeType(
    blob.type ||
      referenceImage?.mimeType ||
      getImageMimeType(referenceImage?.format ?? "png"),
  );

  if (!mimeType.startsWith("image/")) {
    throw new Error(`Unsupported reference image format: ${mimeType}`);
  }

  const normalizedBlob =
    blob.type === mimeType
      ? blob
      : new Blob([await blob.arrayBuffer()], { type: mimeType });

  return {
    blob: normalizedBlob,
    filename: createReferenceImageFilename(referenceImage, mimeType, index),
  };
}

function dataUrlToImageBlob(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");

  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new Error("Reference image data URL is invalid.");
  }

  const meta = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);
  const mimeType = normalizeImageMimeType(
    meta.match(/^data:([^;,]+)/i)?.[1] || "image/png",
  );
  const bytes = /;base64/i.test(meta)
    ? Buffer.from(payload.replace(/\s/g, ""), "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");

  return new Blob([bytes], { type: mimeType });
}

async function fetchReferenceImageBlob(url: string) {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(
      "Reference image must be a data URL or an http(s) image URL; browser blob URLs cannot be read by the server.",
    );
  }

  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Reference image download failed: ${await getErrorResponseText(response)}`);
  }

  const contentType = response.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim();
  const blob = await response.blob();
  const mimeType = normalizeImageMimeType(
    blob.type || contentType || "image/png",
  );

  if (!mimeType.startsWith("image/")) {
    throw new Error(`Reference image URL did not return an image: ${mimeType}`);
  }

  return blob.type === mimeType
    ? blob
    : new Blob([await blob.arrayBuffer()], { type: mimeType });
}

function createReferenceImageFilename(
  referenceImage: NonNullable<AgentComposerMetadata["referenceImages"]>[number],
  mimeType: string,
  index = 0,
) {
  const format = normalizeImageFormat(referenceImage?.format ?? "");
  const extension =
    format || mimeTypeToExtension(mimeType) || mimeTypeToExtension("image/png");

  return `reference-${index + 1}.${extension}`;
}

function normalizeImageMimeType(mimeType: string) {
  const normalized = mimeType.trim().toLowerCase();

  if (normalized === "image/jpg") {
    return "image/jpeg";
  }

  return normalized || "image/png";
}

function normalizeImageFormat(format: string) {
  const normalized = format.trim().toLowerCase().replace(/^\./, "");

  return normalized === "jpg" ? "jpeg" : normalized;
}

function mimeTypeToExtension(mimeType: string) {
  const normalized = normalizeImageMimeType(mimeType);

  if (normalized === "image/jpeg") {
    return "jpeg";
  }

  if (normalized === "image/svg+xml") {
    return "svg";
  }

  if (normalized.startsWith("image/") || normalized.startsWith("video/")) {
    return normalized.split("/")[1] ?? "";
  }

  return "";
}

function getVideoMimeType(format: string) {
  const normalized = format.trim().toLowerCase().replace(/^\./, "");

  if (normalized === "webm") {
    return "video/webm";
  }

  if (normalized === "quicktime" || normalized === "mov") {
    return "video/quicktime";
  }

  return "video/mp4";
}

function formatMiB(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function extractImagesFromPayload(
  payload: OpenAICompatibleImageResponse,
  composer: AgentComposerMetadata,
) {
  const images = (
    await Promise.all(
      (payload.data ?? []).map(async (item) => {
        const b64Buffer = item.b64_json
          ? imagePayloadToBuffer(item.b64_json)
          : undefined;
        const url =
          item.url ||
          (item.b64_json
            ? normalizeBase64ImageUrl(
                item.b64_json,
                composer.imageFormat ?? "png",
              )
            : undefined);

        if (!url) {
          return null;
        }

        const dimensions = b64Buffer
          ? readImageDimensions(b64Buffer)
          : await readImageDimensionsFromUrl(url);

        return {
          url,
          width: dimensions?.width,
          height: dimensions?.height,
          format: dimensions?.format ?? composer.imageFormat ?? "png",
        } satisfies MediaImageResult;
      }),
    )
  ).filter((image): image is NonNullable<typeof image> => Boolean(image));

  if (!images.length) {
    throw new Error(
      "The image provider returned no renderable image URLs or base64 payloads.",
    );
  }

  return images;
}

async function readImageDimensionsFromUrl(url: string) {
  try {
    const buffer = url.startsWith("data:")
      ? dataUrlToBuffer(url)
      : await fetchImageBuffer(url);

    return readImageDimensions(buffer);
  } catch {
    return undefined;
  }
}

async function fetchImageBuffer(url: string) {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Only http(s) image URLs can be inspected.");
  }

  const response = await fetch(url, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await getErrorResponseText(response));
  }

  return Buffer.from(await response.arrayBuffer());
}

function dataUrlToBuffer(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");

  if (!dataUrl.startsWith("data:") || commaIndex < 0) {
    throw new Error("Invalid data URL.");
  }

  const meta = dataUrl.slice(0, commaIndex);
  const payload = dataUrl.slice(commaIndex + 1);

  return /;base64/i.test(meta)
    ? Buffer.from(payload.replace(/\s/g, ""), "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
}

function imagePayloadToBuffer(payload: string) {
  return payload.startsWith("data:")
    ? dataUrlToBuffer(payload)
    : Buffer.from(payload.replace(/\s/g, ""), "base64");
}

function normalizeBase64ImageUrl(payload: string, format: string) {
  return payload.startsWith("data:")
    ? payload
    : createBase64ImageUrl(payload, format);
}

function appendOptionalFormValue(
  formData: FormData,
  key: string,
  value: unknown,
) {
  if (typeof value === "string" && value) {
    formData.append(key, value);
  }
}

function readImageDimensions(buffer: Buffer) {
  return (
    readPngDimensions(buffer) ??
    readJpegDimensions(buffer) ??
    readWebpDimensions(buffer)
  );
}

function readPngDimensions(buffer: Buffer) {
  if (
    buffer.length < 24 ||
    buffer.readUInt32BE(0) !== 0x89504e47 ||
    buffer.readUInt32BE(4) !== 0x0d0a1a0a
  ) {
    return undefined;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    format: "png",
  };
}

function readJpegDimensions(buffer: Buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;

  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset);

    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      break;
    }

    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
        format: "jpeg",
      };
    }

    offset += segmentLength;
  }

  return undefined;
}

function readWebpDimensions(buffer: Buffer) {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return undefined;
  }

  const chunkType = buffer.toString("ascii", 12, 16);

  if (chunkType === "VP8X" && buffer.length >= 30) {
    return {
      width: readUInt24LE(buffer, 24) + 1,
      height: readUInt24LE(buffer, 27) + 1,
      format: "webp",
    };
  }

  if (chunkType === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      format: "webp",
    };
  }

  if (chunkType === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);

    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      format: "webp",
    };
  }

  return undefined;
}

function readUInt24LE(buffer: Buffer, offset: number) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

async function generateVideoWithOpenAICompatible({
  apiKey,
  baseUrl,
  protocol,
  composer,
  prompt,
}: {
  apiKey: string;
  baseUrl: string;
  protocol?: ChannelProtocol;
  composer: AgentComposerMetadata;
  prompt: string;
}): Promise<VideoGenerationResult> {
  return isSeedanceVideoModel(composer.videoModel)
    ? generateSeedanceVideoWithOpenAICompatible({
        apiKey,
        baseUrl,
        protocol,
        composer,
        prompt,
      })
    : generateOpenAIVideoWithOpenAICompatible({
        apiKey,
        baseUrl,
        composer,
        prompt,
      });
}

async function generateOpenAIVideoWithOpenAICompatible({
  apiKey,
  baseUrl,
  composer,
  prompt,
}: {
  apiKey: string;
  baseUrl: string;
  composer: AgentComposerMetadata;
  prompt: string;
}): Promise<VideoGenerationResult> {
  const referenceImages = getComposerReferenceImages(composer);
  const createResponse = await requestOpenAICompatibleVideoCreatePayload({
    apiKey,
    baseUrl,
    composer,
    prompt,
    referenceImages,
  });
  const initialState = {
    ...extractVideoGenerationState(createResponse.payload, composer),
    requestParams: createResponse.requestParams,
  };

  assertVideoProviderNotFailed(createResponse.payload, initialState.providerStatus);

  if (initialState.url) {
    return createVideoResult(initialState);
  }

  if (!initialState.taskId) {
    throw new Error(
      `The video provider did not return a task id or result URL. Response: ${serializePayload(createResponse.payload)}`,
    );
  }

  const finalState = await pollVideoGenerationUntilComplete({
    apiKey,
    baseUrl,
    composer,
    initialState,
    provider: "openai",
  });

  if (!finalState.url) {
    throw new Error(
      `The video provider finished without a usable video URL. Response state: ${serializePayload(finalState)}`,
    );
  }

  return createVideoResult(finalState);
}

async function generateSeedanceVideoWithOpenAICompatible({
  apiKey,
  baseUrl,
  protocol,
  composer,
  prompt,
}: {
  apiKey: string;
  baseUrl: string;
  protocol?: ChannelProtocol;
  composer: AgentComposerMetadata;
  prompt: string;
}): Promise<VideoGenerationResult> {
  const requestParams = createVideoRequestParamsForComposer(
    composer,
    prompt,
    baseUrl,
  );
  const requestBody = protocol === "volcengine-ark"
    ? await createSeedanceVideoRequestBodyForArk(composer, prompt)
    : createSeedanceVideoRequestBody(composer, prompt);
  const createPayload = await requestProviderPayload({
    apiKey,
    baseUrl,
    body: requestBody,
    method: "POST",
    path: SEEDANCE_VIDEO_CREATE_PATH,
  });
  const initialState = {
    ...extractVideoGenerationState(createPayload, composer),
    requestParams,
  };

  assertVideoProviderNotFailed(createPayload, initialState.providerStatus);

  if (initialState.url) {
    return createVideoResult(initialState);
  }

  if (!initialState.taskId) {
    throw new Error(
      `The Seedance video provider did not return a task id or result URL. Response: ${serializePayload(createPayload)}`,
    );
  }

  const finalState = await pollVideoGenerationUntilComplete({
    apiKey,
    baseUrl,
    composer,
    initialState,
    provider: "seedance",
  });

  if (!finalState.url) {
    throw new Error(
      `The Seedance video provider finished without a usable video URL. Response state: ${serializePayload(finalState)}`,
    );
  }

  return createVideoResult(finalState);
}

async function pollVideoGenerationUntilComplete({
  apiKey,
  baseUrl,
  composer,
  initialState,
  provider,
}: {
  apiKey: string;
  baseUrl: string;
  composer: AgentComposerMetadata;
  initialState: VideoGenerationState;
  provider: "openai" | "seedance";
}) {
  const startedAt = Date.now();
  let currentState = initialState;

  while (Date.now() - startedAt < VIDEO_POLL_TIMEOUT_MS) {
    await wait(VIDEO_POLL_INTERVAL_MS);

    const payload = await requestProviderPayload({
      apiKey,
      baseUrl,
      body:
        provider === "openai" && VIDEO_STATUS_METHOD === "POST"
          ? {
              id: currentState.taskId,
              taskId: currentState.taskId,
            }
          : undefined,
      method:
        provider === "openai" && VIDEO_STATUS_METHOD === "POST"
          ? "POST"
          : "GET",
      path:
        provider === "seedance"
          ? resolvePathWithTaskId(SEEDANCE_VIDEO_STATUS_PATH, currentState.taskId!)
          : resolvePathWithTaskId(VIDEO_STATUS_PATH, currentState.taskId!),
    });

    currentState = {
      ...currentState,
      ...extractVideoGenerationState(payload, composer),
    };

    const normalizedStatus = normalizeVideoProviderStatus(
      currentState.providerStatus,
    );

    if (currentState.url) {
      return currentState;
    }

    if (provider === "openai" && normalizedStatus === "success") {
      return {
        ...currentState,
        ...(await requestOpenAICompatibleVideoContent({
          apiKey,
          baseUrl,
          composer,
          taskId: currentState.taskId!,
        })),
      };
    }

    if (normalizedStatus === "error") {
      const providerError = extractProviderErrorMessage(payload);
      throw new Error(
        providerError ||
          `The video provider reported failure with status "${currentState.providerStatus ?? "unknown"}".`,
      );
    }
  }

  throw new Error(
    `Timed out after ${Math.round(VIDEO_POLL_TIMEOUT_MS / 1000)} seconds while waiting for video generation.`,
  );
}

async function createSeedanceVideoRequestBodyForArk(
  composer: AgentComposerMetadata,
  prompt: string,
) {
  const body = createSeedanceVideoRequestBody(composer, prompt);
  const references = await Promise.all(
    getComposerReferenceImages(composer)
      .slice(0, 9)
      .map(async (referenceImage, index) => {
        const { blob } = await resolveReferenceImageBlob(referenceImage, index);
        return {
          type: "image_url" as const,
          image_url: { url: await blobToDataUrl(blob) },
          role: "reference_image" as const,
        };
      }),
  );
  return {
    ...body,
    content: [{ type: "text", text: prompt }, ...references],
  };
}

async function generateImageWithArk({
  apiKey,
  baseUrl,
  composer,
  prompt,
}: {
  apiKey: string;
  baseUrl: string;
  composer: AgentComposerMetadata;
  prompt: string;
}): Promise<ImageGenerationResult> {
  const imageSize = getOpenAICompatibleImageSizeCandidates(
    composer.resolution ?? "1080p",
    composer.ratio ?? "1:1",
  )[0];
  const referenceImages = await Promise.all(
    getComposerReferenceImages(composer).map(async (referenceImage, index) => {
      const { blob } = await resolveReferenceImageBlob(referenceImage, index);
      return blobToDataUrl(blob);
    }),
  );
  const body = {
    model: composer.imageModel,
    prompt,
    response_format: "url",
    stream: false,
    watermark: false,
    sequential_image_generation: "disabled",
    ...(imageSize ? { size: imageSize.size } : {}),
    ...(composer.ratio ? { aspect_ratio: composer.ratio } : {}),
    ...(referenceImages.length ? { image: referenceImages } : {}),
  };
  const endpoint = "images/generations";
  const response = await fetch(createApiUrl(baseUrl, endpoint), {
    method: "POST",
    headers: {
      Authorization: createBearerAuthHeader(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await getErrorResponseText(response));
  }

  const payload = await parseOpenAICompatibleImageResponse(response);
  return {
    status: "success",
    images: await extractImagesFromPayload(payload, composer),
    requestParams: {
      endpoint,
      requestUrl: createApiUrl(baseUrl, endpoint),
      method: "POST",
      contentType: "application/json",
      model: composer.imageModel,
      prompt,
      size: imageSize?.size,
      aspect_ratio: composer.ratio,
      response_format: "url",
      referenceCount: referenceImages.length,
      requestBody: stringifyRequestBody(body),
    },
    note: "Generated through the Volcengine Ark Seedream image endpoint.",
  };
}

async function blobToDataUrl(blob: Blob) {
  const bytes = Buffer.from(await blob.arrayBuffer());
  const mimeType = blob.type || "image/png";
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function assertVideoProviderNotFailed(payload: unknown, providerStatus?: string) {
  if (normalizeVideoProviderStatus(providerStatus) !== "error") {
    return;
  }

  const providerError = extractProviderErrorMessage(payload);
  throw new Error(
    providerError ||
      `The video provider reported failure with status "${providerStatus ?? "unknown"}".`,
  );
}

function createVideoResult(state: VideoGenerationState): VideoGenerationResult {
  return {
    status: "success",
    url: state.url!,
    thumbnailUrl: state.thumbnailUrl,
    format: state.format,
    taskId: state.taskId,
    providerStatus: state.providerStatus,
    requestParams: state.requestParams,
    note: state.taskId
      ? `Generated through the OpenAI-compatible video provider. Task ID: ${state.taskId}`
      : "Generated through the OpenAI-compatible video provider.",
  };
}

async function requestOpenAICompatibleVideoCreatePayload({
      apiKey,
      baseUrl,
      composer,
  prompt,
  referenceImages,
}: {
  apiKey: string;
  baseUrl: string;
  composer: AgentComposerMetadata;
  prompt: string;
  referenceImages: NonNullable<AgentComposerMetadata["referenceImages"]>;
}) {
  const resolvedReferenceImages = await Promise.all(
    referenceImages
      .slice(0, 7)
      .map((referenceImage, index) =>
        resolveReferenceImageBlob(referenceImage, index),
      ),
  );
  const body = createOpenAICompatibleVideoFormBody(composer, prompt);
  const hasReferenceImages = resolvedReferenceImages.length > 0;
  let response: Response;

  try {
    response = await fetch(createApiUrl(baseUrl, VIDEO_CREATE_PATH), {
      method: "POST",
      headers: {
        Authorization: createBearerAuthHeader(apiKey),
        ...(!hasReferenceImages ? { "Content-Type": "application/json" } : {}),
      },
      body: hasReferenceImages
        ? createOpenAICompatibleVideoFormData(body, resolvedReferenceImages)
        : JSON.stringify(createOpenAICompatibleVideoJsonBody(body)),
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(`Video submit fetch failed: ${toErrorMessage(error)}`);
  }

  if (!response.ok) {
    throw new Error(await getErrorResponseText(response));
  }

  return {
    payload: await parseOpenAICompatibleVideoCreateResponse(response),
    requestParams: createOpenAICompatibleVideoRequestParams({
      baseUrl,
      composer,
      prompt,
    }),
  };
}

async function parseOpenAICompatibleVideoCreateResponse(response: Response) {
  if (response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    return parseVideoEventStreamPayload(response);
  }

  return parseJsonIfPresent(response);
}

async function parseVideoEventStreamPayload(response: Response) {
  if (!response.body) {
    throw new Error("Video stream response had no readable body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const payloads: unknown[] = [];
  let buffer = "";
  let lastVideoUrl = "";
  let lastError = "";

  const processBlock = (block: string) => {
    const parsed = parseServerSentEventBlock(block);

    if (!parsed) {
      return;
    }

    try {
      const payload = JSON.parse(parsed.data) as unknown;
      payloads.push(payload);

      const error = extractProviderErrorMessage(payload);
      if (isStreamErrorPayload(payload) && error) {
        lastError = error;
      }

      const url = findFirstStringByKeys(payload, [
        "video_url",
        "videoUrl",
        "url",
        "download_url",
        "downloadUrl",
        "file_url",
        "fileUrl",
      ]);

      if (url) {
        lastVideoUrl = url;
      }
    } catch {
      const url = extractVideoUrlFromText(parsed.data);

      if (url) {
        lastVideoUrl = url;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.search(/\r?\n\r?\n/);
    while (separatorIndex >= 0) {
      const separator = buffer.match(/\r?\n\r?\n/)?.[0] ?? "\n\n";
      processBlock(buffer.slice(0, separatorIndex));
      buffer = buffer.slice(separatorIndex + separator.length);
      separatorIndex = buffer.search(/\r?\n\r?\n/);
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    processBlock(buffer);
  }

  if (lastVideoUrl) {
    return {
      status: "completed",
      video_url: lastVideoUrl,
      events: payloads,
    };
  }

  if (lastError) {
    throw new Error(lastError);
  }

  return {
    status: "pending",
    events: payloads,
  };
}

function parseServerSentEventBlock(block: string) {
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  const data = dataLines.join("\n").trim();

  if (!data || data === "[DONE]") {
    return null;
  }

  return { data };
}

function isStreamErrorPayload(payload: unknown) {
  if (!isRecord(payload)) {
    return false;
  }

  const type = String(payload.type ?? payload.event ?? payload.status ?? "").toLowerCase();

  return (
    type.includes("error") ||
    type === "failed" ||
    Boolean(payload.error)
  );
}

function extractVideoUrlFromText(text: string) {
  const markdown = text.match(
    /!?\[[^\]]*]\((https?:\/\/[^)\s]+\.(?:mp4|webm|mov|m4v)(?:\?[^)\s]*)?)\)/i,
  );

  if (markdown?.[1]) {
    return markdown[1];
  }

  return (
    text.match(
      /https?:\/\/[^\s"'<>)]*\.(?:mp4|webm|mov|m4v)(?:\?[^\s"'<>)]*)?/i,
    )?.[0] ?? ""
  );
}

function createOpenAICompatibleVideoFormData(
  body: OpenAICompatibleVideoBody,
  referenceImages: Array<{ blob: Blob; filename: string }>,
) {
  const formData = new FormData();

  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string" && value) {
      formData.append(key, value);
    }
  }

  for (const referenceImage of referenceImages) {
    formData.append(
      "input_reference[]",
      referenceImage.blob,
      referenceImage.filename,
    );
    formData.append("image[]", referenceImage.blob, referenceImage.filename);
  }

  return formData;
}

async function requestOpenAICompatibleVideoContent({
  apiKey,
  baseUrl,
  composer,
  taskId,
}: {
  apiKey: string;
  baseUrl: string;
  composer: AgentComposerMetadata;
  taskId: string;
}): Promise<Pick<VideoGenerationState, "format" | "url">> {
  const response = await fetch(
    createApiUrl(baseUrl, resolvePathWithTaskId(VIDEO_CONTENT_PATH, taskId)),
    {
      method: "GET",
      headers: {
        Authorization: createBearerAuthHeader(apiKey),
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(await getErrorResponseText(response));
  }

  const contentType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    getVideoMimeType(composer.videoFormat ?? "mp4");

  if (contentType.toLowerCase().includes("json")) {
    const payload = await parseJsonIfPresent(response);
    const url = findFirstStringByKeys(payload, [
      "video_url",
      "videoUrl",
      "download_url",
      "downloadUrl",
      "file_url",
      "fileUrl",
      "play_url",
      "playUrl",
      "url",
    ]);

    if (!url) {
      throw new Error(
        `The video content endpoint returned JSON without a usable video URL. Response: ${serializePayload(payload)}`,
      );
    }

    return {
      url,
      format: composer.videoFormat ?? inferMediaFormat(url),
    };
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    url: `data:${contentType};base64,${buffer.toString("base64")}`,
    format:
      mimeTypeToExtension(contentType) ??
      composer.videoFormat ??
      inferMediaFormat(contentType),
  };
}

async function requestProviderPayload({
  apiKey,
  baseUrl,
  body,
  method,
  path,
}: {
  apiKey: string;
  baseUrl: string;
  body?: unknown;
  method: "GET" | "POST";
  path: string;
}) {
  const response = await fetch(createApiUrl(baseUrl, path), {
    method,
    headers: {
      Authorization: createBearerAuthHeader(apiKey),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await getErrorResponseText(response));
  }

  return await parseJsonIfPresent(response);
}

async function parseJsonIfPresent(response: Response) {
  const text = (await response.text()).trim();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Provider returned non-JSON response: ${text.slice(0, 300)}`);
  }
}

function extractVideoGenerationState(
  payload: unknown,
  composer: AgentComposerMetadata,
): VideoGenerationState {
  const taskId = findFirstStringByKeys(payload, [
    "task_id",
    "taskId",
    "taskID",
    "generation_id",
    "generationId",
    "job_id",
    "jobId",
    "video_id",
    "videoId",
    "id",
  ]);
  const providerStatus = findFirstStringByKeys(payload, [
    "status",
    "state",
    "phase",
  ]);
  const url = findFirstStringByKeys(payload, [
    "video_url",
    "videoUrl",
    "download_url",
    "downloadUrl",
    "file_url",
    "fileUrl",
    "play_url",
    "playUrl",
    "url",
  ]);
  const thumbnailUrl = findFirstStringByKeys(payload, [
    "thumbnail_url",
    "thumbnailUrl",
    "cover_url",
    "coverUrl",
    "poster_url",
    "posterUrl",
    "image_url",
    "imageUrl",
  ]);

  return {
    taskId,
    providerStatus,
    url,
    thumbnailUrl,
    format: composer.videoFormat ?? inferMediaFormat(url),
  };
}

function findFirstStringByKeys(value: unknown, keys: string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstStringByKeys(item, keys);

      if (found) {
        return found;
      }
    }

    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of keys) {
    const candidate = value[key];

    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  for (const nested of Object.values(value)) {
    const found = findFirstStringByKeys(nested, keys);

    if (found) {
      return found;
    }
  }

  return undefined;
}

function extractChatCompletionText(payload: unknown): string {
  if (Array.isArray(payload)) {
    return payload.map(extractChatCompletionText).join("");
  }

  if (!isRecord(payload)) {
    return "";
  }

  const choices = payload.choices;

  if (Array.isArray(choices)) {
    return choices
      .map((choice) => {
        if (!isRecord(choice)) {
          return "";
        }

        const delta = choice.delta;
        const message = choice.message;
        const deltaContent = isRecord(delta) ? delta.content : undefined;
        const messageContent = isRecord(message) ? message.content : undefined;

        return [deltaContent, messageContent]
          .filter((content): content is string => typeof content === "string")
          .join("");
      })
      .join("");
  }

  return Object.values(payload).map(extractChatCompletionText).join("");
}

function extractImageUrls(payload: unknown, text: string) {
  const urls = new Set<string>(extractImageUrlsFromText(text));

  collectImageUrlsFromUnknown(payload, urls);

  return [...urls];
}

function collectImageUrlsFromUnknown(value: unknown, urls: Set<string>) {
  if (typeof value === "string") {
    for (const url of extractImageUrlsFromText(value)) {
      urls.add(url);
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectImageUrlsFromUnknown(item, urls);
    }

    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const nested of Object.values(value)) {
    collectImageUrlsFromUnknown(nested, urls);
  }
}

function extractImageUrlsFromText(text: string) {
  const urls = new Set<string>();
  const markdownImagePattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const markdownLinkPattern = /\[[^\]]+]\((https?:\/\/[^)\s]+|data:[^)\s]+)(?:\s+"[^"]*")?\)/g;
  const plainUrlPattern = /https?:\/\/[^\s<>"'`锛屻€傦紒锛熴€侊級)]+/g;
  const dataUrlPattern = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi;
  let match: RegExpExecArray | null;

  while ((match = markdownImagePattern.exec(text))) {
    addLikelyImageUrl(urls, match[1]);
  }

  while ((match = markdownLinkPattern.exec(text))) {
    addLikelyImageUrl(urls, match[1]);
  }

  while ((match = plainUrlPattern.exec(text))) {
    addLikelyImageUrl(urls, match[0].replace(/[.,;:!?]+$/, ""));
  }

  while ((match = dataUrlPattern.exec(text))) {
    addLikelyImageUrl(urls, match[0].replace(/\s/g, ""));
  }

  return [...urls];
}

function addLikelyImageUrl(urls: Set<string>, url?: string) {
  if (!url) {
    return;
  }

  const trimmedUrl = url.trim();

  if (
    trimmedUrl.startsWith("data:image/") ||
    /^https?:\/\/.+\.(?:png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i.test(trimmedUrl) ||
    /^https?:\/\/.+\/(?:files\/)?image(?:[?#].*)?$/i.test(trimmedUrl)
  ) {
    urls.add(trimmedUrl);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeVideoProviderStatus(status?: string) {
  const normalized = status?.trim().toLowerCase();

  if (!normalized) {
    return "unknown";
  }

  if (
    [
      "succeeded",
      "success",
      "completed",
      "complete",
      "done",
      "finished",
      "ready",
    ].includes(normalized)
  ) {
    return "success";
  }

  if (
    [
      "failed",
      "error",
      "cancelled",
      "canceled",
      "rejected",
      "expired",
    ].includes(normalized)
  ) {
    return "error";
  }

  return "pending";
}

function inferMediaFormat(url?: string) {
  if (!url) {
    return undefined;
  }

  const match = url.match(/\.([a-z0-9]+)(?:$|\?)/i);
  return match?.[1]?.toLowerCase();
}

function resolvePathWithTaskId(path: string, taskId: string) {
  if (path.includes("{id}")) {
    return path.replaceAll("{id}", encodeURIComponent(taskId));
  }

  return `${path.replace(/\/+$/, "")}/${encodeURIComponent(taskId)}`;
}

async function getErrorResponseText(response: Response) {
  const fallback = `Provider request failed with HTTP ${response.status}.`;
  let text = "";

  try {
    text = (await response.text()).trim();
  } catch {
    return fallback;
  }

  if (!text) {
    return fallback;
  }

  if (isHtmlResponseText(text)) {
    return getHtmlProviderErrorMessage(response.status);
  }

  const parsed = parseJsonLike(text);
  const message = parsed ? extractProviderErrorMessage(parsed) ?? text : text;

  return message.trim() || fallback;
}

function isHtmlResponseText(text: string) {
  return /<!doctype html/i.test(text) || /<html[\s>]/i.test(text);
}

function getHtmlProviderErrorMessage(status: number) {
  if (status === 520 || status === 522 || status === 524) {
    return `Gateway timeout or origin connection error (HTTP ${status}). Check reverse proxy/CDN timeout or use an async result endpoint.`;
  }

  if (status >= 500) {
    return `The server returned an HTML error page (HTTP ${status}) instead of a JSON API response.`;
  }

  return `The endpoint returned HTML instead of JSON (HTTP ${status}). Check the API URL or proxy/CDN interception.`;
}

function parseJsonLike(text: string): unknown | null {
  const candidates = [text];
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        return JSON.parse(candidate.replace(/\\"/g, '"'));
      } catch {
        // Try the next candidate.
      }
    }
  }

  return null;
}

function extractProviderErrorMessage(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (Array.isArray(value)) {
    const messages = value
      .map((item) => extractProviderErrorMessage(item) ?? serializePayload(item))
      .filter(Boolean);

    return messages.length > 0 ? messages.join("\n") : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const error = value.error;

  if (isRecord(error)) {
    const details = [
      getStringByKey(error, "message"),
      getStringByKey(error, "type"),
      getStringByKey(error, "code"),
      getStringByKey(error, "param"),
    ].filter(Boolean);

    if (details.length > 0) {
      return details.join(" ");
    }
  }

  const direct =
    getStringByKey(value, "detail") ??
    getStringByKey(value, "message") ??
    getStringByKey(value, "msg") ??
    getStringByKey(value, "error_description");

  if (direct) {
    return direct;
  }

  if (Array.isArray(value.detail)) {
    return extractProviderErrorMessage(value.detail);
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return (
    extractProviderErrorMessage(error) ??
    extractProviderErrorMessage(value.data) ??
    null
  );
}

function getStringByKey(source: Record<string, unknown>, key: string) {
  const value = source[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeProviderErrorMessage(
  message: string,
  context: ProviderErrorContext = "media-generation",
): string {
  const text = message.trim();

  if (!text) {
    return "Generation failed. Please try again later.";
  }

  const lower = text.toLowerCase();

  if (
    /temporarily unavailable|system under load|server overloaded|service overloaded|over capacity|busy|try again later|currently overloaded/.test(
      lower,
    ) ||
    /鏈嶅姟绻佸繖|绯荤粺绻佸繖|璐熻浇|绋嶅悗閲嶈瘯/.test(text)
  ) {
    return "Service is busy. Please try again later.";
  }

  if (
    /unsupported.*(reference|image)|invalid.*(reference|image)|reference.*not supported|image edit.*not supported/.test(
      lower,
    )
  ) {
    return "The current model or endpoint does not support reference images or image editing. Remove reference images or switch models.";
  }

  if (
    /invalid[_\s-]?size|size is invalid|unsupported[_\s-]?size|invalid resolution|unsupported resolution/.test(
      lower,
    )
  ) {
    return "The current model does not support the selected size or resolution. Adjust ratio/resolution or switch models.";
  }

  if (
    /invalid[_\s-]?(duration|seconds)|unsupported[_\s-]?(duration|seconds)|duration is invalid|seconds is invalid/.test(
      lower,
    )
  ) {
    return "The current model does not support the selected duration. Adjust seconds or switch video models.";
  }

  if (/task[_\s-]?id is empty|empty task[_\s-]?id|missing task[_\s-]?id/.test(lower)) {
    return "The video creation endpoint did not return a valid task ID, so the result cannot be queried. Switch video models or check the provider response format.";
  }

  if (
    /(unsupported|invalid).*(tool|function|image_generation|tool_choice)|tool.*(unsupported|invalid)|model.*not support.*tool/.test(
      lower,
    )
  ) {
    return context === "chat-tool"
      ? "The chat model does not support tool calls. Switch to a tool-capable chat model; keep image/video models in generation settings."
      : "The generation endpoint or model does not support this call style. Check Base URL, endpoint path, and model compatibility.";
  }

  if (
    /invalid[_\s-]?parameter|unsupported parameter|unknown parameter|invalid request|param/.test(
      lower,
    )
  ) {
    return "The current model does not support some generation parameters. Adjust size, format, duration, or references and try again.";
  }

  if (
    /no available channel|channel_circuit_open|circuit breaker|unsupported_model|auto-recovery probe/.test(
      lower,
    ) ||
    /娓犻亾|閫氶亾|鍒嗙粍|鏃犲彲鐢▅娌℃湁鍙敤|妯″瀷鏆備笉鏀寔|鏆傛椂涓嶅彲鐢▅鐔旀柇/.test(text)
  ) {
    return "The current model is temporarily unavailable. Try later or switch models.";
  }

  if (
    /insufficient|balance|quota|billing|credit|pre[-\s]?charge|payment/.test(
      lower,
    ) ||
    /浣欓|棰濆害|棰勬墸|鎵ｈ垂|娆犺垂|鍏呭€紎璐︽埛閲戦|浣欓涓嶈冻/.test(text)
  ) {
    return "The endpoint cannot complete the request. Check quota/balance or switch API configuration.";
  }

  if (
    /access token|unauthorized|forbidden|invalid api key|permission|auth/.test(
      lower,
    ) ||
    /鏃犳潈|閴存潈|鏉冮檺|瀵嗛挜/.test(text)
  ) {
    return "Authentication failed. Check API Key, Base URL, plan permissions, or this video model permission.";
  }

  return text
    .replace(/\s*\(?request\s*id\s*[:锛歖\s*[^)\s]+[)]?/gi, "")
    .replace(/\s*\(?璇锋眰\s*id\s*[:锛歖\s*[^)\s]+[)]?/gi, "")
    .replace(/\bmodel\s+[-\w.:/]+\b/gi, "model")
    .replace(/\$[0-9]+(?:\.[0-9]+)?/g, "***")
    .trim();
}

function createBase64ImageUrl(base64: string, format: string) {
  return `data:${getImageMimeType(format)};base64,${base64}`;
}

function getImageMimeType(format: string) {
  const normalized = format.trim().toLowerCase();

  if (normalized === "jpg" || normalized === "jpeg") {
    return "image/jpeg";
  }

  if (normalized === "webp") {
    return "image/webp";
  }

  return "image/png";
}

async function* createRuntimeErrorEvents(
  error: string,
): AsyncIterable<AgentEvent> {
  const message: AgentMessage = {
    id: createId("msg"),
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
  };

  yield {
    type: "message.created",
    message,
  };
  yield {
    type: "message.delta",
    messageId: message.id,
    delta: `Runtime configuration error: ${error}`,
  };
  yield {
    type: "message.done",
    messageId: message.id,
  };
}

function isMediaToolName(toolName: string) {
  return toolName === "image_generation" || toolName === "video_generation";
}

async function* createAiSdkEvents({
  composer,
  mediaToolIntent,
  modelRoutes,
  languageModel,
  messages,
  model,
  providerRuntime,
  runtime,
}: {
  composer?: AgentComposerMetadata;
  mediaToolIntent: ChatMediaToolIntent;
  modelRoutes?: Record<string, ModelRoute>;
  languageModel: LanguageModel;
  messages: ReturnType<typeof normalizeMessages>;
  model: string;
  providerRuntime: ProviderRuntime;
  runtime: string;
}): AsyncIterable<AgentEvent> {
  const assistantMessage: AgentMessage = {
    id: createId("msg"),
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    metadata: {
      model,
      runtime,
    },
  };
  const toolMessageIds = new Map<string, string>();
  const toolNames = new Map<string, string>();
  const toolArgs = new Map<string, unknown>();
  const activeToolCalls = new Map<string, string>();
  let assistantHasText = false;
  let mediaToolSucceeded = false;

  yield {
    type: "message.created",
    message: assistantMessage,
  };

  try {
    const tools = createAiSdkTools({
      composer,
      enabledTools: mediaToolIntent,
      modelRoutes,
      runtime: providerRuntime,
    });
    const result = streamText({
      model: languageModel,
      messages,
      tools,
      stopWhen: isStepCount(4),
      instructions: createAiSdkInstructions(composer, mediaToolIntent),
    });

    for await (const part of result.stream) {
      if (part.type === "text-delta") {
        assistantHasText = true;
        yield {
          type: "message.delta",
          messageId: assistantMessage.id,
          delta: part.text,
        };
        continue;
      }

      if (part.type === "tool-call") {
        const toolCallId = getToolCallIdFromPart(part);
        const toolName = getToolNameFromPart(part);

        if (!toolCallId) {
          continue;
        }

        const toolMessage: AgentMessage = {
          id: createId("msg"),
          role: "tool",
          content: "",
          createdAt: new Date().toISOString(),
          metadata: {
            runtime,
          },
        };
        toolMessageIds.set(toolCallId, toolMessage.id);
        toolNames.set(toolCallId, toolName);
        activeToolCalls.set(toolCallId, toolMessage.id);

        const selectedToolModel =
          toolName === "video_generation"
            ? composer?.videoModel
            : composer?.imageModel;
        const toolRoute = resolveModelRoute(
          selectedToolModel,
          modelRoutes,
          providerRuntime,
        );
        const resolvedArgs = resolveMediaToolArgs(
          toolName,
          getInputFromPart(part),
          resolveComposerRoutes(composer, modelRoutes),
          toolRoute.runtime,
        );

        toolArgs.set(toolCallId, resolvedArgs);

        yield {
          type: "message.created",
          message: toolMessage,
        };
        yield {
          type: "tool.pending",
          messageId: toolMessage.id,
          toolCall: {
            id: toolCallId,
            name: toolName,
            args: resolvedArgs,
            status: "pending",
          },
        };
        yield {
          type: "tool.running",
          messageId: toolMessage.id,
          toolCallId,
        };
        continue;
      }

      if (part.type === "tool-result") {
        const messageId = toolMessageIds.get(part.toolCallId);
        const toolName = toolNames.get(part.toolCallId);

        if (!messageId) {
          continue;
        }

        if (toolName && isMediaToolName(toolName)) {
          mediaToolSucceeded = true;
        }

        yield {
          type: "tool.done",
          messageId,
          toolCallId: part.toolCallId,
          result: part.output,
        };
        activeToolCalls.delete(part.toolCallId);
        continue;
      }

      if (part.type === "tool-error") {
        const messageId = toolMessageIds.get(part.toolCallId);
        const toolName = toolNames.get(part.toolCallId);
        const args = toolArgs.get(part.toolCallId) as
          | { requestParams?: MediaRequestParams }
          | undefined;

        if (!messageId) {
          continue;
        }

        yield {
          type: "tool.error",
          messageId,
          toolCallId: part.toolCallId,
          error: toErrorMessage(part.error),
          result:
            toolName && isMediaToolName(toolName)
              ? {
                  requestParams: args?.requestParams,
                  status: "error",
                }
              : undefined,
        };
        activeToolCalls.delete(part.toolCallId);
        continue;
      }

      if (part.type === "error") {
        throw part.error;
      }
    }
  } catch (error) {
    const errorMessage = sanitizeProviderErrorMessage(
      toErrorMessage(error),
      "chat-tool",
    );

    for (const [toolCallId, messageId] of activeToolCalls) {
      const toolName = toolNames.get(toolCallId);
      const args = toolArgs.get(toolCallId) as
        | { requestParams?: MediaRequestParams }
        | undefined;

      yield {
        type: "tool.error",
        messageId,
        toolCallId,
        error: errorMessage,
        result:
          toolName && isMediaToolName(toolName)
            ? {
                requestParams: args?.requestParams,
                status: "error",
              }
            : undefined,
      };
    }
    activeToolCalls.clear();

    // A media tool result is already a usable completion. The language model
    // may make one more request to write a conversational summary; if that
    // follow-up fails, do not turn a successful image/video card into a chat
    // error such as `openai_error`.
    if (mediaToolSucceeded) {
      if (!assistantHasText) {
        const completedMediaTool = [...toolNames.values()].find(
          (toolName) => isMediaToolName(toolName),
        );
        const completionLabel =
          completedMediaTool === "video_generation" ? "视频" : "图片";

        yield {
          type: "message.delta",
          messageId: assistantMessage.id,
          delta: `${completionLabel}生成完成。`,
        };
      }

      yield {
        type: "message.done",
        messageId: assistantMessage.id,
      };
      return;
    }

    yield {
      type: "message.delta",
      messageId: assistantMessage.id,
      delta: errorMessage,
    };
  }

  yield {
    type: "message.done",
    messageId: assistantMessage.id,
  };
}

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequestBody;
  const { user, sessionId } = await ensureAnonymousUser();
  const content = body.content?.trim() ?? "";
  const composer = body.metadata?.composer;
  const modelRoutes = body.metadata?.modelRoutes;
  const resolved = resolveLanguageModel(body);
  const messages = normalizeMessages(body.messages, content, composer);
  const requestedMediaToolIntent =
    composer?.mode === "chat"
      ? detectChatMediaToolIntent({
          composer,
          content,
          messages: body.messages,
        })
      : {
          enableImage: false,
        enableVideo: false,
      };
  const providerRuntime = {
    ...resolved.providerRuntime,
    userId: user.id,
  };
  const requestedAvailableMediaToolIntent = resolveAvailableMediaToolIntent({
    composer,
    enabledTools: requestedMediaToolIntent,
    modelRoutes,
    runtime: providerRuntime,
  });
  // In chat mode, expose every configured media tool to the language model.
  // The model makes the semantic choice from the tool descriptions; the
  // keyword detector is only used by the no-chat-credentials fallback below.
  const mediaToolIntent =
    composer?.mode === "chat"
      ? resolveAvailableMediaToolIntent({
          composer,
          enabledTools: { enableImage: true, enableVideo: true },
          modelRoutes,
          runtime: providerRuntime,
        })
      : { enableImage: false, enableVideo: false };

  try {
    if (composer?.mode === "image" || composer?.mode === "video") {
      const selectedMediaModel =
        composer.mode === "video" ? composer.videoModel : composer.imageModel;
      const mediaRoute = resolveModelRoute(
        selectedMediaModel,
        modelRoutes,
        {
          apiKey: body.metadata?.apiKey,
          baseUrl: body.metadata?.baseUrl,
        },
      );
      return attachSessionCookie(createAgentEventStreamResponse(
        createMediaGenerationEvents({
          composer: resolveComposerRoutes(composer, modelRoutes)!,
          prompt: content,
          runtime: {
            apiKey: mediaRoute.runtime.apiKey,
            baseUrl: mediaRoute.runtime.baseUrl,
            protocol: mediaRoute.runtime.protocol,
            userId: user.id,
          },
        }),
      ), sessionId);
    }

    if (!resolved.hasCredentials) {
      if (
        requestedAvailableMediaToolIntent.enableImage ||
        requestedAvailableMediaToolIntent.enableVideo
      ) {
        return attachSessionCookie(createAgentEventStreamResponse(
          createChatMediaToolEvents({
            composer: composer!,
            intent: requestedAvailableMediaToolIntent,
            modelRoutes,
            prompt: content,
            runtime: providerRuntime,
          }),
        ), sessionId);
      }

      return attachSessionCookie(createAgentEventStreamResponse(createFallbackEvents()), sessionId);
    }

    return attachSessionCookie(createAgentEventStreamResponse(
      createAiSdkEvents({
        composer,
        mediaToolIntent,
        modelRoutes,
        languageModel: resolved.languageModel,
        messages,
        model: resolved.model,
        providerRuntime,
        runtime: resolved.runtime,
      }),
    ), sessionId);
  } catch (error) {
    return attachSessionCookie(createAgentEventStreamResponse(
      createRuntimeErrorEvents(toErrorMessage(error)),
    ), sessionId);
  }
}

function createApiUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function createBearerAuthHeader(apiKey: string) {
  return `Bearer ${apiKey.trim()}`;
}

function serializePayload(payload: unknown) {
  try {
    return JSON.stringify(payload).slice(0, 500);
  } catch {
    return String(payload);
  }
}

function parsePositiveInt(rawValue: string | undefined, fallback: number) {
  const parsed = Number.parseInt(rawValue ?? "", 10);

  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
