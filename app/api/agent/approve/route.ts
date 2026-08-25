import { createAgentEventStreamResponse } from "@/lib/agent/stream";
import { resumeLangGraphApprovalExample } from "@/lib/agent/langgraph-runtime";

type ApprovalRequestBody = {
  approvalId: string;
  payload?: unknown;
  threadId?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as ApprovalRequestBody;

  return createAgentEventStreamResponse(
    resumeLangGraphApprovalExample({
      approvalId: body.approvalId,
      decision: "approved",
      payload: body.payload,
      threadId: body.threadId,
    })
  );
}
