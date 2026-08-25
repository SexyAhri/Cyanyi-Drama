export type AgentMessageRole = "user" | "assistant" | "tool";

export type ToolCallStatus =
  | "pending"
  | "approved"
  | "denied"
  | "running"
  | "done"
  | "error";

export type AgentToolCall = {
  id: string;
  name: string;
  args: unknown;
  status: ToolCallStatus;
  approvalId?: string;
  result?: unknown;
  error?: string;
};

export type AgentMessage = {
  id: string;
  role: AgentMessageRole;
  content: string;
  createdAt?: string;
  toolCall?: AgentToolCall;
  metadata?: Record<string, unknown>;
};

export type AgentEvent =
  | {
      type: "message.created";
      message: AgentMessage;
    }
  | {
      type: "message.delta";
      messageId: string;
      delta: string;
    }
  | {
      type: "message.done";
      messageId: string;
    }
  | {
      type: "tool.pending";
      messageId: string;
      toolCall: AgentToolCall;
    }
  | {
      type: "tool.running";
      messageId: string;
      toolCallId: string;
    }
  | {
      type: "tool.done";
      messageId: string;
      toolCallId: string;
      result: unknown;
    }
  | {
      type: "tool.error";
      messageId: string;
      toolCallId: string;
      error: string;
      result?: unknown;
    }
  | {
      type: "approval.required";
      messageId: string;
      toolCallId: string;
      approvalId: string;
    }
  | {
      type: "approval.resolved";
      approvalId: string;
      decision: "approved" | "denied";
    };
