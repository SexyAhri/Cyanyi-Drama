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
