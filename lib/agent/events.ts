import type {
  AgentEvent,
  AgentMessage,
  AgentToolCall,
  ToolCallStatus,
} from "@/lib/agent/types";
import { extractImagePromptArtifact } from "@/lib/agent/image-prompt-context";
import { getFinalPrompt, splitPromptReply } from "@/lib/agent/reply-sections";

export class AgentEventMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentEventMergeError";
  }
}

function updateMessage(
  messages: AgentMessage[],
  messageId: string,
  update: (message: AgentMessage) => AgentMessage,
) {
  let found = false;
  const nextMessages = messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    found = true;
    return update(message);
  });

  if (!found) {
    throw new AgentEventMergeError(`Unknown messageId: ${messageId}`);
  }

  return nextMessages;
}

function updateToolCall(
  messages: AgentMessage[],
  messageId: string,
  toolCallId: string,
  update: (toolCall: AgentToolCall) => AgentToolCall,
) {
  return updateMessage(messages, messageId, (message) => {
    if (!message.toolCall || message.toolCall.id !== toolCallId) {
      throw new AgentEventMergeError(`Unknown toolCallId: ${toolCallId}`);
    }

    return {
      ...message,
      toolCall: update(message.toolCall),
    };
  });
}

function updateApprovalToolCall(
  messages: AgentMessage[],
  approvalId: string,
  status: ToolCallStatus,
) {
  let found = false;
  const nextMessages = messages.map((message) => {
    if (message.toolCall?.approvalId !== approvalId) {
      return message;
    }

    found = true;
    return {
      ...message,
      toolCall: {
        ...message.toolCall,
        status,
      },
    };
  });

  if (!found) {
    throw new AgentEventMergeError(`Unknown approvalId: ${approvalId}`);
  }

  return nextMessages;
}

export function mergeAgentEvent(
  messages: AgentMessage[],
  event: AgentEvent,
): AgentMessage[] {
  switch (event.type) {
    case "message.created":
      return [...messages, event.message];

    case "message.delta":
      return updateMessage(messages, event.messageId, (message) => ({
        ...message,
        content: `${message.content}${event.delta}`,
      }));

    case "message.done":
      return updateMessage(messages, event.messageId, (message) => {
        const replySections = message.role === "assistant" ? splitPromptReply(message.content) : null;
        const finalPrompt = message.role === "assistant" ? getFinalPrompt(message.content) : null;
        const imagePrompt =
          message.role === "assistant"
            ? extractImagePromptArtifact(message.content) ?? (finalPrompt ? { positive: finalPrompt } : null)
            : null;
        return {
          ...message,
          metadata: {
            ...message.metadata,
            finishedAt: new Date().toISOString(),
            ...(replySections ? { replySections } : {}),
            ...(imagePrompt
              ? {
                  imagePrompt: {
                    ...imagePrompt,
                    sourceMessageId: message.id,
                  },
                }
              : {}),
          },
        };
      });

    case "tool.pending": {
      const assistant = [...messages].reverse().find((message) => message.role === "assistant" || message.role === "user");
      const staged = assistant?.role === "assistant"
        ? updateMessage(messages, assistant.id, (message) => ({
            ...message,
            metadata: { ...message.metadata, processContentLength: message.content.length },
          }))
        : messages;
      return updateMessage(staged, event.messageId, (message) => ({
        ...message,
        toolCall: {
          ...event.toolCall,
          status: "pending",
        },
      }));
    }

    case "tool.running":
      return updateToolCall(
        messages,
        event.messageId,
        event.toolCallId,
        (toolCall) => ({
          ...toolCall,
          status: "running",
        }),
      );

    case "tool.done":
      return updateToolCall(
        updateMessage(messages, event.messageId, (message) => ({ ...message, metadata: { ...message.metadata, finishedAt: new Date().toISOString() } })),
        event.messageId,
        event.toolCallId,
        (toolCall) => ({
          ...toolCall,
          status: "done",
          result: event.result,
        }),
      );

    case "tool.error":
      return updateToolCall(
        updateMessage(messages, event.messageId, (message) => ({ ...message, metadata: { ...message.metadata, finishedAt: new Date().toISOString() } })),
        event.messageId,
        event.toolCallId,
        (toolCall) => ({
          ...toolCall,
          status: "error",
          error: event.error,
          ...(event.result === undefined ? {} : { result: event.result }),
        }),
      );

    case "approval.required":
      return updateToolCall(
        messages,
        event.messageId,
        event.toolCallId,
        (toolCall) => ({
          ...toolCall,
          approvalId: event.approvalId,
          status: "pending",
        }),
      );

    case "approval.resolved":
      return updateApprovalToolCall(messages, event.approvalId, event.decision);
  }
}
