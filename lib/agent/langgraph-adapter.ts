"use client";

import type {
  AgentAdapter,
  AgentAdapterApprovalInput,
  AgentAdapterSendInput,
} from "@/lib/agent/adapter";
import { readAgentEventStream } from "@/lib/agent/stream";
import type { AgentEvent } from "@/lib/agent/types";

type LangGraphAdapterOptions = {
  endpoint?: string;
  approveEndpoint?: string;
  denyEndpoint?: string;
};

async function* postLangGraphEventStream(
  endpoint: string,
  body: unknown,
): AsyncIterable<AgentEvent> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      errorBody || `LangGraph runtime request failed with ${response.status}.`,
    );
  }

  if (!response.body) {
    throw new Error("LangGraph runtime returned an empty response body.");
  }

  yield* readAgentEventStream(response.body);
}

export function createLangGraphAdapter({
  endpoint = "/api/agent",
  approveEndpoint = "/api/agent/approve",
  denyEndpoint = "/api/agent/deny",
}: LangGraphAdapterOptions = {}): AgentAdapter {
  return {
    sendMessage(input: AgentAdapterSendInput) {
      return postLangGraphEventStream(endpoint, {
        ...input,
        runtime: "langgraph",
      });
    },

    resolveApproval(input: AgentAdapterApprovalInput) {
      return postLangGraphEventStream(
        input.decision === "approved" ? approveEndpoint : denyEndpoint,
        {
          ...input,
          runtime: "langgraph",
        },
      );
    },
  };
}
