import type { AgentMessage, AgentToolCall } from "@/lib/agent/types";

export function canEditComposerAfterMediaToolComplete(messages: AgentMessage[]) {
  const lastUserMessageIndex = findLastUserMessageIndex(messages);

  if (lastUserMessageIndex < 0) {
    return false;
  }

  const currentTurnMediaTools = messages
    .slice(lastUserMessageIndex + 1)
    .map((message) => message.toolCall)
    .filter(isMediaGenerationToolCall);

  return (
    currentTurnMediaTools.some((toolCall) => toolCall.status === "done") &&
    !currentTurnMediaTools.some((toolCall) =>
      toolCall.status === "pending" ||
      toolCall.status === "approved" ||
      toolCall.status === "running",
    )
  );
}

export function removeMessageGroup(messages: AgentMessage[], messageId: string) {
  const targetIndex = messages.findIndex((message) => message.id === messageId);

  if (targetIndex < 0) return messages;

  const targetMessage = messages[targetIndex];
  if (targetMessage?.role === "user") {
    const nextUserIndex = messages.findIndex(
      (message, index) => index > targetIndex && message.role === "user",
    );
    const endIndex = nextUserIndex >= 0 ? nextUserIndex : messages.length;
    return [...messages.slice(0, targetIndex), ...messages.slice(endIndex)];
  }

  let startIndex = targetIndex;
  while (startIndex > 0 && messages[startIndex - 1]?.role === "tool") {
    startIndex -= 1;
  }

  let endIndex = targetIndex + 1;
  while (endIndex < messages.length && messages[endIndex]?.role === "tool") {
    endIndex += 1;
  }

  return [...messages.slice(0, startIndex), ...messages.slice(endIndex)];
}

export function trimMessagesForRegeneration(
  messages: AgentMessage[],
  userMessageId: string,
) {
  const userIndex = messages.findIndex((message) => message.id === userMessageId);
  return userIndex < 0 ? messages : messages.slice(0, userIndex);
}

function findLastUserMessageIndex(messages: AgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

function isMediaGenerationToolCall(
  toolCall?: AgentToolCall,
): toolCall is AgentToolCall {
  return (
    toolCall?.name === "image_generation" ||
    toolCall?.name === "video_generation"
  );
}
