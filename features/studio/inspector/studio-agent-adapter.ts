"use client";

import type {
  AgentAdapter,
  AgentAdapterApprovalInput,
  AgentAdapterSendInput,
} from "@/lib/agent/adapter";
import { readAgentEventStream } from "@/lib/agent/stream";
import type { AgentEvent } from "@/lib/agent/types";

async function* postStudioAgent(
  endpoint: string,
  body: unknown,
): AsyncIterable<AgentEvent> {
  const response = await fetch(endpoint, {
    body: JSON.stringify(body),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(
      payload?.message || `Agent request failed (${response.status})`,
    );
  }
  if (!response.body) throw new Error("Agent response stream is empty.");
  yield* readAgentEventStream(response.body);
}

export function createStudioAgentAdapter(projectId: string): AgentAdapter {
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/agent`;
  return {
    sendMessage(input: AgentAdapterSendInput) {
      return postStudioAgent(endpoint, input);
    },
    resolveApproval(input: AgentAdapterApprovalInput) {
      return postStudioAgent(endpoint, input);
    },
  };
}
