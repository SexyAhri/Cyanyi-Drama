import type { AgentEvent, AgentMessage } from "@/lib/agent/types";

export type AgentAdapterSendInput = {
  messages: AgentMessage[];
  content: string;
  threadId?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
};

export type AgentAdapterApprovalInput = {
  approvalId: string;
  decision: "approved" | "denied";
  payload?: unknown;
  reason?: string;
};

export type AgentAdapter = {
  sendMessage: (input: AgentAdapterSendInput) => AsyncIterable<AgentEvent>;
  resolveApproval: (
    input: AgentAdapterApprovalInput,
  ) => AsyncIterable<AgentEvent>;
};
