import type { Message } from "@/components/ui/chat-message";
import type { AgentMessage } from "@/lib/agent/types";

export function toChatMessage(message: AgentMessage): Message {
  return {
    id: message.id,
    role: message.role === "user" ? "user" : "assistant",
    content: message.content,
    createdAt: message.createdAt ? new Date(message.createdAt) : undefined,
  };
}
