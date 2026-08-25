"use client";

import { Copy, Download, Pencil, RotateCcw, Star, Trash2 } from "lucide-react";
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

import type { AgentComposerReferenceImage } from "../composer";
import { ThinkingIndicator } from "../chat/thinking-indicator";
import { ToolCard } from "../tool/tool-card";

type MessageBubbleProps = {
  message: AgentMessage;
  toolMessages?: AgentMessage[];
  pendingApprovalIds?: string[];
  onApprove?: (approvalId: string) => Promise<void> | void;
  onDeny?: (approvalId: string) => Promise<void> | void;
  onUseAsReferenceImage?: (
    referenceImage: AgentComposerReferenceImage,
  ) => void;
  onEditMessage?: (message: AgentMessage) => void;
  onDeleteMessage?: (messageId: string) => void;
  onRegenerateMessage?: (messageId: string) => void;
  showThinking?: boolean;
  thinkingMessages?: AgentMessage[];
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
  showThinking = false,
  thinkingMessages = [],
}: MessageBubbleProps) {
  const messageAttachments = getMessageAttachments(message);
  const supplementalContent =
    message.role === "assistant" && toolMessages.length > 0 ? (
      <div className="space-y-3">
        {toolMessages.map((toolMessage) => (
          <ToolCard
            createdAt={toolMessage.createdAt}
            embedded
            isApprovalSubmitting={
              toolMessage.toolCall?.approvalId
                ? pendingApprovalIds.includes(toolMessage.toolCall.approvalId)
                : false
            }
            key={toolMessage.id}
            onApprove={onApprove}
            onDeny={onDeny}
            onUseAsReferenceImage={onUseAsReferenceImage}
            toolCall={toolMessage.toolCall!}
          />
        ))}
      </div>
    ) : undefined;

  const downloadableAsset = getDownloadableAsset(toolMessages);
  const actions = (
    <MessageBubbleActions
      canDownload={Boolean(downloadableAsset)}
      isAssistant={message.role === "assistant"}
      isUser={message.role === "user"}
      onCopy={() => void copyMessageContent(message.content)}
      onDelete={
        onDeleteMessage ? () => onDeleteMessage(message.id) : undefined
      }
      onDownload={
        downloadableAsset
          ? () => downloadAsset(downloadableAsset.url, downloadableAsset.fileName)
          : undefined
      }
      onEdit={onEditMessage ? () => onEditMessage(message) : undefined}
      onRegenerate={
        onRegenerateMessage ? () => onRegenerateMessage(message.id) : undefined
      }
    />
  );

  return (
    <ChatMessage
      actions={actions}
      animation="scale"
      content={message.content}
      createdAt={message.createdAt ? new Date(message.createdAt) : undefined}
      experimental_attachments={messageAttachments}
      id={message.id}
      role={message.role === "user" ? "user" : "assistant"}
      showTimeStamp={Boolean(message.createdAt)}
      emptyState={
        showThinking ? <ThinkingIndicator messages={thinkingMessages} /> : undefined
      }
      supplementalContent={supplementalContent}
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
  canDownload,
  isAssistant,
  isUser,
  onCopy,
  onDelete,
  onDownload,
  onEdit,
  onRegenerate,
}: {
  canDownload: boolean;
  isAssistant: boolean;
  isUser: boolean;
  onCopy: () => void;
  onDelete?: () => void;
  onDownload?: () => void;
  onEdit?: () => void;
  onRegenerate?: () => void;
}) {
  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-background/95 px-1.5 py-1 shadow-xs backdrop-blur">
        <ActionButton icon={Copy} label="复制" onClick={onCopy} />
        {isUser ? (
          <ActionButton
            disabled={!onEdit}
            icon={Pencil}
            label="编辑"
            onClick={onEdit}
          />
        ) : null}
        {isAssistant ? (
          <ActionButton
            disabled={!onRegenerate}
            icon={RotateCcw}
            label="重新生成"
            onClick={onRegenerate}
          />
        ) : null}
        {isAssistant ? (
          <ActionButton disabled icon={Star} label="收藏" />
        ) : null}
        {isAssistant ? (
          <ActionButton
            disabled={!canDownload}
            icon={Download}
            label={canDownload ? "下载" : "暂无可下载内容"}
            onClick={onDownload}
          />
        ) : null}
        <ActionButton
          disabled={!onDelete}
          icon={Trash2}
          label="删除"
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

async function copyMessageContent(content: string) {
  try {
    await navigator.clipboard.writeText(content);
    toast.success("已复制消息");
  } catch {
    toast.error("复制失败");
  }
}

function getDownloadableAsset(toolMessages: AgentMessage[]) {
  for (const toolMessage of toolMessages) {
    const result = toolMessage.toolCall?.result;

    if (!result || typeof result !== "object") {
      continue;
    }

    const images = Array.isArray((result as { images?: unknown[] }).images)
      ? (result as { images: Array<{ url?: unknown; format?: unknown }> }).images
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

function downloadAsset(url: string, fileName: string) {
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.rel = "noreferrer";
  link.target = "_blank";
  document.body.append(link);
  link.click();
  link.remove();
  toast.success("已开始下载");
}
