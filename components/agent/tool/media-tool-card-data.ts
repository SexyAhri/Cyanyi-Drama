import type { AgentComposerReferenceImage } from "../composer";
import type { AgentToolCall } from "@/lib/agent/types";

type ImageResult = {
  images?: Array<{
    format?: string;
    height?: number;
    url?: string;
    width?: number;
  }>;
};

type VideoResult = {
  thumbnailUrl?: string;
  url?: string;
};

type MediaArgs = {
  format?: string;
  model?: string;
  prompt?: string;
  templatePrompt?: string;
};

export type MediaToolLifecycle =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "denied";

export type MediaToolPresentation = {
  assetUrl?: string;
  error?: string;
  kind: "image" | "video";
  lifecycle: MediaToolLifecycle;
  previewSrc?: string;
  referenceImage?: AgentComposerReferenceImage;
};

export function getMediaToolPresentation(
  toolCall: AgentToolCall,
): MediaToolPresentation | null {
  const args = (toolCall.args ?? {}) as MediaArgs;
  if (toolCall.name === "image_generation") {
    const result = (toolCall.result ?? {}) as ImageResult;
    const image = result.images?.find((item) => Boolean(item.url));
    const assetUrl = image?.url;
    return {
      assetUrl,
      error: toolCall.error,
      kind: "image",
      lifecycle: resolveLifecycle(toolCall.status, Boolean(assetUrl)),
      previewSrc: assetUrl,
      referenceImage: assetUrl
        ? {
            format: image?.format ?? args.format,
            height: image?.height,
            model: args.model,
            prompt: args.prompt?.trim() || args.templatePrompt?.trim(),
            sourceToolCallId: toolCall.id,
            url: assetUrl,
            width: image?.width,
          }
        : undefined,
    };
  }

  if (toolCall.name === "video_generation") {
    const result = (toolCall.result ?? {}) as VideoResult;
    return {
      assetUrl: result.url,
      error: toolCall.error,
      kind: "video",
      lifecycle: resolveLifecycle(toolCall.status, Boolean(result.url)),
      previewSrc: result.thumbnailUrl,
    };
  }

  return null;
}

function resolveLifecycle(
  status: AgentToolCall["status"],
  hasAsset: boolean,
): MediaToolLifecycle {
  if (status === "error") return "error";
  if (status === "denied") return "denied";
  if (hasAsset) return "success";
  if (status === "running") return "running";
  if (status === "done") return "error";
  return "pending";
}
