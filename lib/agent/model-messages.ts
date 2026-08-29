import type { ModelMessage } from "ai";

import type { AgentMessage } from "./types";

export type AgentComposerMetadata = {
  mode?: "chat" | "image" | "video";
  imageModel?: string;
  videoModel?: string;
  ratio?: string;
  resolution?: string;
  imageRatio?: string;
  imageResolution?: string;
  imageCount?: number;
  imageQuality?: string;
  videoRatio?: string;
  videoResolution?: string;
  videoDuration?: string;
  imageFormat?: string;
  videoFormat?: string;
  style?: string;
  duration?: string;
  template?: string;
  templatePrompt?: string;
  referenceImages?: AgentComposerReferenceImage[];
  referenceImage?: AgentComposerReferenceImage;
};

type AgentComposerReferenceImage = {
  url?: string;
  format?: string;
  width?: number;
  height?: number;
  mimeType?: string;
  model?: string;
  prompt?: string;
  sourceToolCallId?: string;
};

export function normalizeMessages(
  messages: AgentMessage[] = [],
  content?: string,
  composer?: AgentComposerMetadata,
): ModelMessage[] {
  const submittedContent = content?.trim() ?? "";
  const currentReferenceImages =
    composer?.mode === "chat"
      ? getReferenceImagePartsFromComposer(composer)
      : [];
  const submittedMessage = resolveSubmittedMessage(messages, submittedContent);
  const submittedReferenceImages =
    currentReferenceImages.length > 0
      ? currentReferenceImages
      : submittedMessage
        ? getMessageReferenceImageParts(submittedMessage)
        : [];
  const historyMessages = submittedMessage
    ? messages.filter((message) => message.id !== submittedMessage.id)
    : messages;
  const historyUserMessages = historyMessages.filter(
    (message) => message.role === "user",
  );
  const activeImageMessageId =
    submittedReferenceImages.length > 0
      ? null
      : (findLastUserMessageWithReferenceImages(historyUserMessages)?.id ??
        null);

  const modelMessages: ModelMessage[] = historyMessages
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message) => {
      if (message.role === "user") {
        const referenceImages =
          message.id !== activeImageMessageId
            ? []
            : getMessageReferenceImageParts(message);

        if (referenceImages.length === 0) {
          return {
            role: "user" as const,
            content: message.content,
          };
        }

        return {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: message.content,
            },
            ...referenceImages,
          ],
        };
      }

      return {
        role: message.role as "assistant",
        content: message.content,
      };
    });

  if (submittedContent) {
    modelMessages.push({
      role: "user",
      content:
        submittedReferenceImages.length > 0
          ? [
              {
                type: "text" as const,
                text: submittedContent,
              },
              ...submittedReferenceImages,
            ]
          : submittedContent,
    });
  }

  return modelMessages;
}

export function getComposerReferenceImages(composer: AgentComposerMetadata) {
  const candidates = [
    ...(composer.referenceImages ?? []),
    ...(composer.referenceImage ? [composer.referenceImage] : []),
  ];
  const seen = new Set<string>();

  return candidates.filter((referenceImage) => {
    const url = referenceImage?.url?.trim();

    if (!url || seen.has(url)) {
      return false;
    }

    seen.add(url);
    return true;
  });
}

export function resolveComposerForMediaKind(
  composer: AgentComposerMetadata,
  kind: "image" | "video",
): AgentComposerMetadata {
  if (kind === "image") {
    return {
      ...composer,
      mode: "image",
      ratio: composer.imageRatio ?? composer.ratio,
      resolution: composer.imageResolution ?? composer.resolution,
    };
  }

  return {
    ...composer,
    mode: "video",
    ratio: composer.videoRatio ?? composer.ratio,
    resolution: composer.videoResolution ?? composer.resolution,
    duration: composer.videoDuration ?? composer.duration,
  };
}

function findLastUserMessageWithReferenceImages(messages: AgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message && getMessageReferenceImageParts(message).length > 0) {
      return message;
    }
  }

  return null;
}

function resolveSubmittedMessage(
  messages: AgentMessage[],
  submittedContent: string,
) {
  if (!submittedContent) {
    return null;
  }

  const lastAssistantIndex = findLastMessageIndex(
    messages,
    (message) => message.role === "assistant",
  );
  const lastSubmittedUserIndex = findLastMessageIndex(
    messages,
    (message) =>
      message.role === "user" && message.content.trim() === submittedContent,
  );

  if (lastSubmittedUserIndex <= lastAssistantIndex) {
    return null;
  }

  return messages[lastSubmittedUserIndex] ?? null;
}

function findLastMessageIndex(
  messages: AgentMessage[],
  predicate: (message: AgentMessage) => boolean,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message && predicate(message)) {
      return index;
    }
  }

  return -1;
}

function getReferenceImagePartsFromComposer(composer: AgentComposerMetadata) {
  return getComposerReferenceImages(composer)
    .map((referenceImage) => {
      const url = referenceImage.url?.trim();

      if (!url) {
        return null;
      }

      return {
        type: "image" as const,
        image: url,
        mediaType: referenceImage.mimeType,
      };
    })
    .filter(
      (
        referenceImage,
      ): referenceImage is {
        type: "image";
        image: string;
        mediaType: string | undefined;
      } => Boolean(referenceImage),
    );
}

function getMessageReferenceImageParts(message: AgentMessage) {
  const composer = getMessageComposerMetadata(message);

  if (!composer) {
    return [];
  }

  return getReferenceImagePartsFromComposer(composer);
}

function getMessageComposerMetadata(message: AgentMessage) {
  const metadata = message.metadata;

  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const composer =
    "composer" in metadata &&
    metadata.composer &&
    typeof metadata.composer === "object"
      ? metadata.composer
      : null;

  return composer ? (composer as AgentComposerMetadata) : null;
}
