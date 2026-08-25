import {
  Annotation,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
  isInterrupted,
} from "@langchain/langgraph";

import type {
  AgentEvent,
  AgentMessage,
  AgentToolCall,
} from "@/lib/agent/types";

type ApprovalDecision = "approved" | "denied";

type LangGraphResumeValue = {
  decision: ApprovalDecision;
  payload?: unknown;
  reason?: string;
};

type LangGraphDeployResult = {
  status: string;
  deploymentUrl?: string;
  environment?: string;
  reason?: string;
};

const LANGGRAPH_TOOL_CALL_ID = "tool_langgraph_deploy";
const LANGGRAPH_APPROVAL_ID = "approval_langgraph_deploy";
const LANGGRAPH_THREAD_ID = "agent-ui-langgraph-demo";
const pendingApprovalRecords = new Map<
  string,
  {
    messageId: string;
    toolCallId: string;
  }
>();

const LangGraphState = Annotation.Root({
  content: Annotation<string>(),
  approvalId: Annotation<string>(),
  decision: Annotation<ApprovalDecision>(),
  reason: Annotation<string>(),
  result: Annotation<LangGraphDeployResult>(),
});

const checkpointer = new MemorySaver();

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createToolMessage(): AgentMessage {
  return {
    id: createId("msg"),
    role: "tool",
    content: "",
    createdAt: new Date().toISOString(),
    metadata: {
      runtime: "langgraph",
    },
  };
}

function createAssistantMessage(content: string): AgentMessage {
  return {
    id: createId("msg"),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
    metadata: {
      runtime: "langgraph",
    },
  };
}

function createDeployToolCall(): AgentToolCall {
  return {
    id: LANGGRAPH_TOOL_CALL_ID,
    name: "langgraph_deploy",
    args: {
      environment: "preview",
      action: "deploy",
    },
    status: "pending",
    approvalId: LANGGRAPH_APPROVAL_ID,
  };
}

const approvalNode = (state: typeof LangGraphState.State) => {
  const resume = interrupt<
    {
      approvalId: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
      message: string;
    },
    LangGraphResumeValue
  >({
    approvalId: state.approvalId,
    toolCallId: LANGGRAPH_TOOL_CALL_ID,
    toolName: "langgraph_deploy",
    args: {
      environment: "preview",
      action: "deploy",
    },
    message: "Approve the preview deployment before the graph continues.",
  });

  return {
    decision: resume.decision,
    reason: resume.reason ?? "",
  };
};

const deployNode = (state: typeof LangGraphState.State) => {
  if (state.decision === "denied") {
    return {
      result: {
        status: "denied",
        reason: state.reason || "User denied the deployment.",
      } satisfies LangGraphDeployResult,
    };
  }

  return {
    result: {
      status: "ready",
      deploymentUrl: "https://preview.example.com",
      environment: "preview",
    } satisfies LangGraphDeployResult,
  };
};

const graph = new StateGraph(LangGraphState)
  .addNode("approval", approvalNode)
  .addNode("deploy", deployNode)
  .addEdge(START, "approval")
  .addEdge("approval", "deploy")
  .addEdge("deploy", END)
  .compile({
    checkpointer,
  });

function getThreadConfig(threadId = LANGGRAPH_THREAD_ID) {
  return {
    configurable: {
      thread_id: threadId,
    },
  };
}

function getApprovalRecordKey({
  approvalId,
  threadId,
}: {
  approvalId: string;
  threadId?: string;
}) {
  return `${threadId ?? LANGGRAPH_THREAD_ID}:${approvalId}`;
}

export async function* runLangGraphApprovalExample({
  content,
  threadId,
}: {
  content: string;
  threadId?: string;
}): AsyncIterable<AgentEvent> {
  const toolMessage = createToolMessage();
  const toolCall = createDeployToolCall();

  yield {
    type: "message.created",
    message: toolMessage,
  };
  yield {
    type: "tool.pending",
    messageId: toolMessage.id,
    toolCall,
  };

  const output = await graph.invoke(
    {
      content,
      approvalId: LANGGRAPH_APPROVAL_ID,
    },
    getThreadConfig(threadId),
  );

  if (isInterrupted(output)) {
    pendingApprovalRecords.set(
      getApprovalRecordKey({
        approvalId: LANGGRAPH_APPROVAL_ID,
        threadId,
      }),
      {
        messageId: toolMessage.id,
        toolCallId: toolCall.id,
      },
    );

    yield {
      type: "approval.required",
      messageId: toolMessage.id,
      toolCallId: toolCall.id,
      approvalId: LANGGRAPH_APPROVAL_ID,
    };
    return;
  }

  yield {
    type: "tool.error",
    messageId: toolMessage.id,
    toolCallId: toolCall.id,
    error: "LangGraph run finished without an interrupt.",
  };
}

export async function* resumeLangGraphApprovalExample({
  approvalId,
  decision,
  payload,
  reason,
  threadId,
}: {
  approvalId: string;
  decision: ApprovalDecision;
  payload?: unknown;
  reason?: string;
  threadId?: string;
}): AsyncIterable<AgentEvent> {
  yield {
    type: "approval.resolved",
    approvalId,
    decision,
  };

  const state = await graph.getState(getThreadConfig(threadId));
  const approvalRecord = pendingApprovalRecords.get(
    getApprovalRecordKey({
      approvalId,
      threadId,
    }),
  );
  const toolMessageId = approvalRecord?.messageId;
  const toolCallId = approvalRecord?.toolCallId ?? LANGGRAPH_TOOL_CALL_ID;

  if (!toolMessageId) {
    yield {
      type: "message.created",
      message: createAssistantMessage(
        "The approval was resolved, but the server could not find the original LangGraph tool card for this in-memory demo thread.",
      ),
    };
    return;
  }

  if (decision === "denied") {
    const output = await graph.invoke(
      createResumeCommand({
        decision,
        reason,
      }),
      getThreadConfig(threadId),
    );

    yield {
      type: "tool.done",
      messageId: toolMessageId,
      toolCallId,
      result: output.result,
    };
    pendingApprovalRecords.delete(
      getApprovalRecordKey({
        approvalId,
        threadId,
      }),
    );
    yield {
      type: "message.created",
      message: createAssistantMessage(
        "The LangGraph run was resumed with a denial, so the deployment did not execute.",
      ),
    };
    return;
  }

  if (!state.next.includes("approval")) {
    yield {
      type: "tool.error",
      messageId: toolMessageId,
      toolCallId,
      error: "No pending LangGraph approval was found for this thread.",
    };
    return;
  }

  yield {
    type: "tool.running",
    messageId: toolMessageId,
    toolCallId,
  };

  const output = await graph.invoke(
    createResumeCommand({
      decision,
      payload,
    }),
    getThreadConfig(threadId),
  );

  yield {
    type: "tool.done",
    messageId: toolMessageId,
    toolCallId,
    result: output.result,
  };
  pendingApprovalRecords.delete(
    getApprovalRecordKey({
      approvalId,
      threadId,
    }),
  );
  yield {
    type: "message.created",
    message: createAssistantMessage(
      "Approval received. LangGraph resumed from the interrupt and completed the preview deployment.",
    ),
  };
}

function createResumeCommand(value: LangGraphResumeValue) {
  return new Command({
    resume: value,
  }) as Parameters<typeof graph.invoke>[0];
}

export async function getLangGraphRunState(threadId?: string) {
  const state = await graph.getState(getThreadConfig(threadId));
  const pendingApprovals = Array.from(pendingApprovalRecords.entries())
    .filter(([key]) => key.startsWith(`${threadId ?? LANGGRAPH_THREAD_ID}:`))
    .map(([key, record]) => ({
      approvalId: key.split(":").at(-1) ?? LANGGRAPH_APPROVAL_ID,
      toolCallId: record.toolCallId,
      status: "pending" as const,
    }));

  return {
    runId: threadId ?? LANGGRAPH_THREAD_ID,
    threadId: threadId ?? LANGGRAPH_THREAD_ID,
    status: pendingApprovals.length > 0 ? "interrupted" : "idle",
    values: state.values,
    next: state.next,
    pendingApprovals,
  };
}
