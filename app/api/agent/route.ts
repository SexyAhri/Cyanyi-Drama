import { createAgentEventStreamResponse } from "@/lib/agent/stream";
import {
  resumeLangGraphApprovalExample,
  runLangGraphApprovalExample,
} from "@/lib/agent/langgraph-runtime";

type AgentRouteRequestBody = {
  content?: string;
  threadId?: string;
  approvalId?: string;
  decision?: "approved" | "denied";
  payload?: unknown;
  reason?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as AgentRouteRequestBody;

  if (body.approvalId && body.decision) {
    return createAgentEventStreamResponse(
      resumeLangGraphApprovalExample({
        approvalId: body.approvalId,
        decision: body.decision,
        payload: body.payload,
        reason: body.reason,
        threadId: body.threadId,
      })
    );
  }

  return createAgentEventStreamResponse(
    runLangGraphApprovalExample({
      content: body.content ?? "",
      threadId: body.threadId,
    })
  );
}
