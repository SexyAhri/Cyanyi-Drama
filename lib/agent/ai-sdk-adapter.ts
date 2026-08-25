"use client";

import type {
  AgentAdapter,
  AgentAdapterApprovalInput,
  AgentAdapterSendInput,
} from "@/lib/agent/adapter";
import { readAgentEventStream } from "@/lib/agent/stream";
import type { AgentEvent } from "@/lib/agent/types";

type AiSdkAdapterOptions = {
  chatEndpoint?: string;
  agentEndpoint?: string;
};

async function* postAgentEventStream(
  endpoint: string,
  body: unknown,
): AsyncIterable<AgentEvent> {
  const headers = new Headers({
    "Content-Type": "application/json",
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      errorBody || `Agent runtime request failed with ${response.status}.`,
    );
  }

  if (!response.body) {
    throw new Error("Agent runtime returned an empty response body.");
  }

  yield* readAgentEventStream(response.body);
}

export function createAiSdkAdapter({
  chatEndpoint = "/api/chat",
  agentEndpoint = "/api/agent",
}: AiSdkAdapterOptions = {}): AgentAdapter {
  return {
    sendMessage(input: AgentAdapterSendInput) {
      return postAgentEventStream(chatEndpoint, input);
    },

    resolveApproval(input: AgentAdapterApprovalInput) {
      return postAgentEventStream(agentEndpoint, input);
    },
  };
}
