# Integration Guide

This template exposes one UI contract and multiple runtime adapters. The recommended integration path is to keep the UI unchanged and add or replace adapters.

## Data Flow

```txt
runtime route -> AgentEvent stream -> AgentAdapter -> useAgent -> AgentMessage[] -> components/agent
```

`components/agent` only renders `AgentMessage[]`. It does not know whether a response came from AI SDK, LangGraph, or another runtime.

## Use the Chat UI

```tsx
"use client";

import { Chat } from "@/components/agent/chat";
import { useAgent } from "@/hooks/use-agent";
import { createAiSdkAdapter } from "@/lib/agent/ai-sdk-adapter";

export default function ChatPage() {
  const agent = useAgent({
    adapter: createAiSdkAdapter(),
  });

  return <Chat agent={agent} locale="zh-CN" />;
}
```

`Chat` accepts shell data through props so apps can replace the demo conversation list without changing UI internals:

```tsx
<Chat
  agent={agent}
  archivedThreads={archivedThreads}
  locale="en"
  recentThreads={recentThreads}
/>
```

Supported locales are `en` and `zh-CN`. The top bar includes a language selector, so users can switch the shell, prompt suggestions label, and input placeholder at runtime. Runtime data, message content, and tool labels can still be supplied by the host app.

## Runtime Connection

The template does not include a login system or an admin model-management backend. It stays focused on reusable Agent UI components and runtime adapter boundaries.

For local testing, the Settings panel accepts an OpenAI-compatible Base URL and API Key. The model selector can fetch models from `POST /api/models`, and `/api/chat` forwards the selected model plus connection settings through the AI SDK OpenAI-compatible provider.

Production apps can replace this with their own account, billing, model whitelist, or server-side credential layer without changing `components/agent`.

## Adapter Contract

Every runtime adapter implements:

```ts
export type AgentAdapter = {
  sendMessage: (input: AgentAdapterSendInput) => AsyncIterable<AgentEvent>;
  resolveApproval: (
    input: AgentAdapterApprovalInput
  ) => AsyncIterable<AgentEvent>;
};
```

The adapter can call HTTP routes, WebSockets, or any other transport. The only requirement is that it yields `AgentEvent` values.

## Runtime Routes

Routes should return newline-delimited JSON with one `AgentEvent` per line. Use the shared helper:

```ts
import { createAgentEventStreamResponse } from "@/lib/agent/stream";

return createAgentEventStreamResponse(events);
```

The browser side can parse that stream with:

```ts
import { readAgentEventStream } from "@/lib/agent/stream";
```

## Current Adapters

- `createAiSdkAdapter`: posts to `/api/chat`.
- `createLangGraphAdapter`: posts to `/api/agent`.

## Adding a New Runtime

1. Add a route or transport that emits `AgentEvent`.
2. Add a client adapter that implements `AgentAdapter`.
3. Create a demo page that passes the adapter into `useAgent`.
4. Keep runtime-native objects out of `components/agent`.

## Verification

Run:

```bash
pnpm lint
pnpm build
```

Then manually check the runtime page and at least one tool-call flow.
