import type { AgentMessage } from "@/lib/agent/types";
import type { AgentComposerReferenceImage } from "../composer";

import { groupMessagesWithToolCards } from "./message-groups";
import { MessageBubble } from "./message-bubble";
import { ToolCard } from "../tool/tool-card";
import type { ToolRegistry } from "../tool/tool-registry";

type MessageListProps = {
  messages: AgentMessage[];
  pendingApprovalIds?: string[];
  onApprove?: (approvalId: string) => Promise<void> | void;
  onDeny?: (approvalId: string) => Promise<void> | void;
  onDeleteMessage?: (messageId: string) => void;
  onEditMessage?: (message: AgentMessage) => void;
  onRegenerateMessage?: (messageId: string) => void;
  onUseAsReferenceImage?: (referenceImage: AgentComposerReferenceImage) => void;
  isThinking?: boolean;
  locale?: "en" | "zh-CN";
  registry?: ToolRegistry;
};

export function MessageList({
  messages,
  pendingApprovalIds = [],
  onApprove,
  onDeny,
  onDeleteMessage,
  onEditMessage,
  onRegenerateMessage,
  onUseAsReferenceImage,
  isThinking = false,
  locale = "en",
  registry,
}: MessageListProps) {
  const groupedMessages = groupMessagesWithToolCards(messages);
  const latestUserIndex = findLastIndex(
    messages,
    (message) => message.role === "user",
  );
  const thinkingAssistantId = isThinking
    ? messages
        .map((message, index) => ({ message, index }))
        .reverse()
        .find(
          ({ message, index }) =>
            index > latestUserIndex &&
            message.role === "assistant" &&
            !message.content.trim(),
        )?.message.id
    : undefined;

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-5 pt-0">
      {groupedMessages.map((group) => (
        <div className="min-w-0 max-w-full space-y-3" key={group.id}>
          {group.message ? (
            <MessageBubble
              message={group.message}
              locale={locale}
              onApprove={onApprove}
              onDeleteMessage={onDeleteMessage}
              onDeny={onDeny}
              onEditMessage={onEditMessage}
              onRegenerateMessage={onRegenerateMessage}
              pendingApprovalIds={pendingApprovalIds}
              registry={registry}
              toolMessages={group.toolMessages}
              showThinking={group.message.id === thinkingAssistantId}
              thinkingMessages={messages}
              onUseAsReferenceImage={onUseAsReferenceImage}
            />
          ) : null}
          {!group.message
            ? group.toolMessages.map((toolMessage) => (
                <ToolCard
                  createdAt={toolMessage.createdAt}
                  isApprovalSubmitting={
                    toolMessage.toolCall?.approvalId
                      ? pendingApprovalIds.includes(
                          toolMessage.toolCall.approvalId,
                        )
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
              ))
            : null}
        </div>
      ))}
    </div>
  );
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index;
    }
  }

  return -1;
}
