import { createAgentEventStreamResponse } from "@/lib/agent/stream";
import { resumeLangGraphApprovalExample } from "@/lib/agent/langgraph-runtime";

type DenyRequestBody = {
  approvalId: string;
  reason?: string;
  threadId?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as DenyRequestBody;

  return createAgentEventStreamResponse(
    resumeLangGraphApprovalExample({
      approvalId: body.approvalId,
      decision: "denied",
      reason: body.reason,
      threadId: body.threadId,
    })
  );
}
