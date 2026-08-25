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
