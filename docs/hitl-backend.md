# HITL Backend Requirements

Human-in-the-loop approval is modeled as a resumable backend interruption, not as local UI dialog state.

## Required Flow

1. Backend creates a tool call.
2. Backend pauses before execution and creates an `approvalId`.
3. Frontend receives `tool.pending` and `approval.required`.
4. User clicks Approve or Deny.
5. `useAgent` calls `AgentAdapter.resolveApproval`.
6. Backend resolves the approval exactly once.
7. Backend resumes or stops the run and emits follow-up events.

## Approval Record

A production backend should persist an approval record similar to:

```ts
type ApprovalRecord = {
  approvalId: string;
  runId: string;
  threadId: string;
  messageId: string;
  toolCallId: string;
  status: "pending" | "approved" | "denied" | "expired";
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  reason?: string;
};
```

The demo LangGraph runtime uses in-memory state. Replace it with durable storage for production.

## Idempotency

The backend must treat approval resolution as idempotent:

- A pending approval can transition once to `approved` or `denied`.
- Duplicate approve or deny requests should return the current resolved state.
- A denied approval must not later enter `running`.
- A completed tool must not return to `running`.

The frontend disables duplicate clicks, but the backend remains the source of truth.

## Event Mapping

Approve:

```txt
approval.resolved -> tool.running -> tool.done -> message.created
```

Deny:

```txt
approval.resolved -> tool.done or message.created
```

Error:

```txt
approval.resolved -> tool.running -> tool.error
```

## LangGraph Notes

The example in `lib/agent/langgraph-runtime.ts` uses:

- `interrupt(...)` to pause before deployment.
- `MemorySaver` to keep thread state.
- `new Command({ resume })` to continue.

Only runtime files should import LangGraph primitives. UI components should receive the normalized `AgentEvent` and `AgentMessage` structures.

## Production Checklist

- Persist approval records.
- Persist thread and run state.
- Authenticate approval requests.
- Authorize the approving user.
- Store audit metadata.
- Return stable IDs after refresh or reconnect.
- Expire stale approvals.
- Validate resume payloads server-side.
