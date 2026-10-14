# Adding Tools

All tool calls share the same UI surface: `ToolCard`. A new tool should change runtime behavior and optional display metadata, not create a separate tool component unless the generic card cannot express the result.

## Tool Event Shape

Emit a tool call as events:

```ts
yield {
  type: "message.created",
  message: {
    id: "msg_tool_1",
    role: "tool",
    content: "",
  },
};

yield {
  type: "tool.pending",
  messageId: "msg_tool_1",
  toolCall: {
    id: "tool_1",
    name: "my_tool",
    args: { query: "example" },
    status: "pending",
  },
};

yield {
  type: "tool.running",
  messageId: "msg_tool_1",
  toolCallId: "tool_1",
};

yield {
  type: "tool.done",
  messageId: "msg_tool_1",
  toolCallId: "tool_1",
  result: { ok: true },
};
```

Use `tool.error` instead of `tool.done` when execution fails.

## Register Display Metadata

Add optional display metadata in `components/agent/tool/tool-registry.tsx`:

```tsx
export const defaultToolRegistry: ToolRegistry = {
  my_tool: {
    name: "my_tool",
    label: "My tool",
    description: "Runs a custom action.",
    renderArgs: (args) => <JsonPreview value={args} />,
    renderResult: (result) => <JsonPreview value={result} />,
  },
};
```

Unregistered tools still render through the generic `ToolCard`.

## AI SDK Tool Example

Define tools in the route or runtime layer, not in UI components:

```ts
import { jsonSchema, tool } from "ai";

const tools = {
  my_tool: tool({
    description: "Run a custom action.",
    inputSchema: jsonSchema<{ query: string }>({
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    }),
    execute: async ({ query }) => ({ query, ok: true }),
  }),
};
```

Then translate AI SDK stream parts into `AgentEvent`.

## HITL Tool Calls

If a tool needs approval:

1. Emit `tool.pending` with a stable `toolCall.id`.
2. Emit `approval.required` with a backend-generated `approvalId`.
3. Wait for `AgentAdapter.resolveApproval`.
4. Emit `approval.resolved`.
5. Continue with `tool.running` and `tool.done`, or end with `denied`.

Do not generate `approvalId` in UI components.

## Approval Runtime Boundaries

The project assistant uses `lib/studio/agent-runtime.ts` and the project-scoped Agent API. Keep ownership, operation allowlists, context permissions and approval policy checks on the server. Model replies and proposed operations are untrusted input; a plain-text fallback must not grant an operation or approval.

The separate `lib/agent/langgraph-runtime.ts` and `/chat/langgraph` route demonstrate interruption and resume with `MemorySaver`. Their in-memory approval state is an example, not durable production workflow storage. UI components consume normalized `AgentEvent` and `AgentMessage` values; only runtime code imports LangGraph primitives.

An approval flow emits `tool.pending` and `approval.required`, then accepts an authenticated decision through `AgentAdapter.resolveApproval`. Approval IDs come from the backend and must be bound to the user, project and proposed operation. Re-check access and current tool permissions before executing. A denied operation cannot enter `tool.running`.

For any new durable approval flow, persist the approval, run/thread, tool call, decision, timestamps and audit actor. Resolve decisions once, reject stale or mismatched resume payloads, and prevent duplicate execution server-side. Frontend button disabling is only an interaction aid.

Typical event sequences:

```text
approve: approval.resolved → tool.running → tool.done
deny:    approval.resolved → message.created
failure: approval.resolved → tool.running → tool.error
```

## Production Agent Checks

Register production prompt contracts in `lib/prompts/` and keep localized templates, variable contracts and Canary hashes together. System rules and quality requirements in a prompt do not automatically validate output. Use the task's schema and semantic validators for enforceable checks; preserve diagnostic Trace summaries without exposing credentials or untrusted raw payloads.

Model-backed tools must use the existing billing context and wallet settlement path in `lib/billing/`. Do not add a parallel estimate-only charge record or bypass the published Agent configuration. Tasks created by a tool retain their frozen input, configuration and request identity on retry/resume.
