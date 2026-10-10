"use client";

import { Copy, Download, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ChatMessage } from "@/components/ui/chat-message";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AgentMessage } from "@/lib/agent/types";
import { getReplySections } from "@/lib/agent/reply-sections";

import type { AgentComposerReferenceImage } from "../composer";
import { ThinkingIndicator } from "../chat/thinking-indicator";
import { ToolCard } from "../tool/tool-card";
import type { ToolRegistry } from "../tool/tool-registry";
import { MediaTurnProcess } from "./media-turn-process";

const copy = {
  "zh-CN": {
    copied: "已复制消息",
    copy: "复制",
    copyFailed: "复制失败",
    delete: "删除",
    download: "下载",
    downloadStarted: "已开始下载",
    edit: "编辑",
    favorite: "收藏",
    noDownload: "暂无可下载内容",
    regenerate: "重新生成",
  },
  en: {
    copied: "Message copied",
    copy: "Copy",
    copyFailed: "Unable to copy",
    delete: "Delete",
    download: "Download",
    downloadStarted: "Download started",
    edit: "Edit",
    favorite: "Favorite",
    noDownload: "No downloadable content",
    regenerate: "Regenerate",
  },
} as const;

type MessageBubbleProps = {
  message: AgentMessage;
  toolMessages?: AgentMessage[];
  pendingApprovalIds?: string[];
  onApprove?: (approvalId: string) => Promise<void> | void;
  onDeny?: (approvalId: string) => Promise<void> | void;
  onUseAsReferenceImage?: (referenceImage: AgentComposerReferenceImage) => void;
  onEditMessage?: (message: AgentMessage) => void;
  onDeleteMessage?: (messageId: string) => void;
  onRegenerateMessage?: (messageId: string) => void;
  onRetryMedia?: (message: AgentMessage, edit: boolean) => void;
  isBusy?: boolean;
  showThinking?: boolean;
  isReplyStreaming?: boolean;
  thinkingMessages?: AgentMessage[];
  locale?: "en" | "zh-CN";
  registry?: ToolRegistry;
};

export function MessageBubble({
  message,
  toolMessages = [],
  pendingApprovalIds = [],
  onApprove,
  onDeny,
  onUseAsReferenceImage,
  onEditMessage,
  onDeleteMessage,
  onRegenerateMessage,
  onRetryMedia,
  isBusy = false,
  showThinking = false,
  isReplyStreaming = false,
  thinkingMessages = [],
  locale = "en",
  registry,
}: MessageBubbleProps) {
  const messageAttachments = getMessageAttachments(message);
  const contentIsToolError =
    message.role === "assistant" &&
    toolMessages.some(
      (toolMessage) =>
        toolMessage.toolCall?.status === "error" &&
        toolMessage.toolCall.error?.trim() === message.content.trim(),
    );
  const hasAssistantReply =
    message.role === "assistant" &&
    (Boolean(message.content.trim()) ||
      (Array.isArray(message.metadata?.explainedToolCallIds) && message.metadata.explainedToolCallIds.length > 0)) &&
    !contentIsToolError;
  const visibleToolMessages = toolMessages.filter((toolMessage) => {
    const toolCall = toolMessage.toolCall;
    const isFailedMediaTool =
      toolCall?.status === "error" &&
      (toolCall.name === "image_generation" ||
        toolCall.name === "video_generation");
    const explainedToolCallIds = message.metadata?.explainedToolCallIds;
    const hasExplanation = !toolMessage.metadata?.directMediaGeneration ||
      (Array.isArray(explainedToolCallIds) && explainedToolCallIds.includes(toolCall?.id));
    const toolIndex = toolMessages.indexOf(toolMessage);
    const hasSuccessfulRetry = toolMessages.slice(toolIndex + 1).some((candidate) => {
      const result = candidate.toolCall?.result as { safetyRetry?: unknown } | undefined;
      return candidate.toolCall?.name === toolCall?.name && candidate.toolCall?.status === "done" && Boolean(result?.safetyRetry);
    });
    if (message.metadata?.mediaTurn && isFailedMediaTool && hasSuccessfulRetry) return false;
    return !(hasAssistantReply && hasExplanation && isFailedMediaTool);
  });
  const supplementalContent =
    message.role === "assistant" && visibleToolMessages.length > 0 ? (
      <div className="space-y-3">
        {visibleToolMessages.map((toolMessage) => (
          <ToolCard
            hideProcessDetails={message.metadata?.mediaTurn === true}
            createdAt={toolMessage.createdAt}
            embedded
            isApprovalSubmitting={
              toolMessage.toolCall?.approvalId
                ? pendingApprovalIds.includes(toolMessage.toolCall.approvalId)
                : false
            }
            key={toolMessage.id}
            locale={locale}
            onApprove={onApprove}
            onDeny={onDeny}
            onUseAsReferenceImage={onUseAsReferenceImage}
            registry={registry}
            toolCall={toolMessage.toolCall!}
          />
        ))}
      </div>
    ) : undefined;

  const downloadableAsset = getDownloadableAsset(toolMessages);
  const isMediaTurn = message.metadata?.mediaTurn === true;
  const replySections = message.role === "assistant" && !isMediaTurn && !isReplyStreaming
    ? getReplySections(message.metadata?.replySections, message.content) : null;
  const analysisMessage = replySections ? { ...message, metadata: {
    ...message.metadata,
    processTexts: [replySections.analysis],
    processStartedAt: message.createdAt,
    processFinishedAt: message.metadata?.finishedAt,
  } } : null;
  const lastMediaTool = toolMessages.filter((tool) => tool.toolCall?.name === "image_generation" || tool.toolCall?.name === "video_generation").at(-1);
  const failedMedia = lastMediaTool?.toolCall?.status === "error" ? lastMediaTool : undefined;
  const actions = (
    <div className="space-y-2">
      {failedMedia && onRetryMedia ? <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={isBusy} onClick={() => onRetryMedia(failedMedia, false)}>{locale === "zh-CN" ? "重试生成" : "Retry generation"}</Button>
        <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => onRetryMedia(failedMedia, true)}>{locale === "zh-CN" ? "修改描述" : "Edit description"}</Button>
      </div> : null}
    <MessageBubbleActions
      canDownload={Boolean(downloadableAsset)}
      isAssistant={message.role === "assistant"}
      isUser={message.role === "user"}
      locale={locale}
      hasContent={Boolean(message.content.trim())}
      onCopy={() => void copyMessageContent(replySections?.answer ?? message.content, locale)}
      onDelete={!isBusy && onDeleteMessage ? () => onDeleteMessage(message.id) : undefined}
      onDownload={
        downloadableAsset
          ? () =>
              downloadAsset(
                downloadableAsset.url,
                downloadableAsset.fileName,
                locale,
              )
          : undefined
      }
      onEdit={!isBusy && onEditMessage ? () => onEditMessage(message) : undefined}
      onRegenerate={
        !isBusy && onRegenerateMessage ? () => onRegenerateMessage(message.id) : undefined
      }
    />
    </div>
  );

  return (
    <ChatMessage
      leadingContent={isMediaTurn ? <div className="space-y-4"><MediaTurnProcess message={message} tools={toolMessages} locale={locale} />{supplementalContent}</div> : analysisMessage ? <MediaTurnProcess message={analysisMessage} tools={[]} locale={locale} fallbackLabel={locale === "zh-CN" ? "分析与建议" : "Analysis and suggestions"} /> : undefined}
      actions={isReplyStreaming || (showThinking && !message.content.trim()) ? undefined : actions}
      animation={showThinking && !message.content.trim() ? "none" : "scale"}
      content={contentIsToolError ? "" : replySections?.answer ?? message.content}
      createdAt={message.createdAt ? new Date(message.createdAt) : undefined}
      experimental_attachments={messageAttachments}
      id={message.id}
      role={message.role === "user" ? "user" : "assistant"}
      showTimeStamp={!isMediaTurn && Boolean(message.createdAt) && !(showThinking && !message.content.trim())}
      emptyState={
        showThinking ? (
          <ThinkingIndicator messages={thinkingMessages} />
        ) : undefined
      }
      supplementalContent={isMediaTurn ? undefined : supplementalContent}
    />
  );
}

function getMessageAttachments(message: AgentMessage) {
  const composer =
    message.metadata &&
    typeof message.metadata === "object" &&
    "composer" in message.metadata &&
    message.metadata.composer &&
    typeof message.metadata.composer === "object"
      ? (message.metadata.composer as Record<string, unknown>)
      : null;

  if (!composer) {
    return undefined;
  }

  const candidates = [
    ...(Array.isArray(composer.referenceImages)
      ? composer.referenceImages.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object",
        )
      : []),
    ...(composer.referenceImage && typeof composer.referenceImage === "object"
      ? [composer.referenceImage as Record<string, unknown>]
      : []),
  ];
  const seen = new Set<string>();
  const attachments = candidates
    .map((item, index) => {
      const url = typeof item.url === "string" ? item.url.trim() : "";

      if (!url || seen.has(url)) {
        return null;
      }

      seen.add(url);
      const format =
        typeof item.format === "string" && item.format.trim()
          ? item.format.trim().replace(/^\./, "")
          : "png";

      return {
        url,
        contentType:
          typeof item.mimeType === "string" ? item.mimeType : "image/png",
        name: `reference-${index + 1}.${format}`,
      };
    })
    .filter(
      (
        attachment,
      ): attachment is {
        url: string;
        contentType: string;
        name: string;
      } => Boolean(attachment),
    );

  return attachments.length > 0 ? attachments : undefined;
}

function MessageBubbleActions({
  hasContent,
  canDownload,
  isAssistant,
  isUser,
  locale,
  onCopy,
  onDelete,
  onDownload,
  onEdit,
  onRegenerate,
}: {
  hasContent: boolean;
  canDownload: boolean;
  isAssistant: boolean;
  isUser: boolean;
  locale: "en" | "zh-CN";
  onCopy: () => void;
  onDelete?: () => void;
  onDownload?: () => void;
  onEdit?: () => void;
  onRegenerate?: () => void;
}) {
  const text = copy[locale];
  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 py-1">
        {hasContent ? <ActionButton icon={Copy} label={text.copy} onClick={onCopy} /> : null}
        {isUser ? (
          <ActionButton
            disabled={!onEdit}
            icon={Pencil}
            label={text.edit}
            onClick={onEdit}
          />
        ) : null}
        {isAssistant ? (
          <ActionButton
            disabled={!onRegenerate}
            icon={RotateCcw}
            label={text.regenerate}
            onClick={onRegenerate}
          />
        ) : null}
        {isAssistant && canDownload ? (
          <ActionButton
            disabled={!canDownload}
            icon={Download}
            label={canDownload ? text.download : text.noDownload}
            onClick={onDownload}
          />
        ) : null}
        <ActionButton
          disabled={!onDelete}
          icon={Trash2}
          label={text.delete}
          onClick={onDelete}
        />
      </div>
    </TooltipProvider>
  );
}

function ActionButton({
  disabled = false,
  icon: Icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: typeof Copy;
  label: string;
  onClick?: () => void;
}) {
  const button = (
    <Button
      aria-label={label}
      className="text-muted-foreground hover:text-foreground"
      disabled={disabled}
      onClick={onClick}
      size="icon-xs"
      type="button"
      variant="ghost"
    >
      <Icon />
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={disabled ? <span>{button}</span> : button} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

async function copyMessageContent(
  content: string,
  locale: "en" | "zh-CN",
) {
  try {
    await navigator.clipboard.writeText(content);
    toast.success(copy[locale].copied);
  } catch {
    toast.error(copy[locale].copyFailed);
  }
}

function getDownloadableAsset(toolMessages: AgentMessage[]) {
  for (const toolMessage of toolMessages) {
    const result = toolMessage.toolCall?.result;

    if (!result || typeof result !== "object") {
      continue;
    }

    const images = Array.isArray((result as { images?: unknown[] }).images)
      ? (result as { images: Array<{ url?: unknown; format?: unknown }> })
          .images
      : [];

    for (const image of images) {
      if (typeof image.url === "string" && image.url.trim()) {
        return {
          url: image.url,
          fileName: `generated-image.${normalizeAssetExtension(image.format) ?? "png"}`,
        };
      }
    }

    const videoUrl = (result as { url?: unknown }).url;
    if (typeof videoUrl === "string" && videoUrl.trim()) {
      return {
        url: videoUrl,
        fileName: `generated-video.${normalizeAssetExtension((result as { format?: unknown }).format) ?? "mp4"}`,
      };
    }
  }

  return null;
}

function normalizeAssetExtension(format: unknown) {
  if (typeof format !== "string") {
    return null;
  }

  const normalized = format.trim().toLowerCase().replace(/^\./, "");
  return normalized || null;
}

function downloadAsset(
  url: string,
  fileName: string,
  locale: "en" | "zh-CN",
) {
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.rel = "noreferrer";
  link.target = "_blank";
  document.body.append(link);
  link.click();
  link.remove();
  toast.success(copy[locale].downloadStarted);
}
