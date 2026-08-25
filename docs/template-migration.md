# Template Migration

Use this guide when moving the Agent UI template into another app.

The template should be copied as a clean UI/runtime boundary. Product features such as image generation, billing, login, recharge, admin pages, or provider management should be added by the target app after the copy.

## Required Files

Core UI:

```txt
components/agent/
components/agent/chat/
components/agent/shell/
components/agent/message/
components/agent/tool/
components/agent/input/
components/agent/debug/
components/ui/chat.tsx
components/ui/chat-message.tsx
components/ui/message-input.tsx
components/ui/message-list.tsx
components/ui/markdown-renderer.tsx
components/ui/copy-button.tsx
components/ui/typing-indicator.tsx
components/ui/prompt-suggestions.tsx
components/ui/message-scroller.tsx
```

State and protocol:

```txt
hooks/use-agent.ts
hooks/use-runtime-connection.ts
lib/agent/types.ts
lib/agent/events.ts
lib/agent/adapter.ts
lib/agent/stream.ts
```

Utilities and shared UI dependencies:

```txt
lib/utils.ts
components/ui/button.tsx
components/ui/card.tsx
components/ui/badge.tsx
components/ui/collapsible.tsx
components/ui/select.tsx
components/ui/scroll-area.tsx
components/ui/textarea.tsx
components/ui/tooltip.tsx
```

If you keep the ChatGPT-style shell, also copy the shadcn primitives used by `components/agent/shell`, such as dialog, dropdown menu, sheet, sidebar, select, input, label, alert, badge, avatar, separator, scroll area, and tooltip.

## Optional Example Files

AI SDK example:

```txt
lib/agent/ai-sdk-adapter.ts
app/api/chat/route.ts
app/api/models/route.ts
app/chat/page.tsx
```

LangGraph example:

```txt
lib/agent/langgraph-adapter.ts
lib/agent/langgraph-runtime.ts
app/api/agent/
app/chat/langgraph/page.tsx
```

## Required Dependencies

Keep these aligned with the target app:

```txt
next
react
react-dom
tailwindcss
lucide-react
react-markdown
remark-gfm
ai
@ai-sdk/openai-compatible
@langchain/langgraph
```

Only install `ai` or `@langchain/langgraph` if the target app uses those examples. The core UI can work with any adapter that emits `AgentEvent`.

## Migration Steps

1. Copy the core UI, protocol, and utility files.
2. Copy or recreate the shadcn/ui primitives used by `components/agent`.
3. Add one runtime adapter.
4. Render `Chat` with `useAgent`.
5. Verify the UI flow with a real adapter boundary before wiring product-specific runtime logic.
6. Replace demo thread data with the target app's history source.
7. Replace or remove `use-runtime-connection.ts` if the product manages credentials on the server.

## Migrating `cyanyi-ai-image`

Recommended order:

1. Start from a fresh copy of this template.
2. Add image generation under feature modules, for example `features/image-generation`.
3. Move image request validation, provider calls, and persistence into routes or services.
4. Convert image task state into `AgentEvent` so the existing chat UI can render progress.
5. Add specialized image result cards through the tool registry only after the generic `ToolCard` is insufficient.
6. Migrate gallery, history, favorites, download, and export after the generation flow is stable.
7. Treat login, recharge, quotas, and new-api integration as product-layer work, not template work.

Keep these boundaries during the migration:

- `components/agent` remains generic.
- Business modules can import the template UI, but the template UI should not import business modules.
- Business APIs should emit normalized events or provide adapters.
- Avoid growing chat, shell, or tool files into product catch-all files.

## Boundary Audit

After migration, run a quick search:

```bash
rg "langgraph|streamText|openai|mcp|cyanyi|image" components/agent hooks/use-agent.ts
```

The search should not show runtime or business imports inside `components/agent`. Runtime-specific code belongs in adapters and routes. Product-specific code belongs in feature modules.

## Verification

Run:

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
```

Then manually verify:

- `/chat` can send a message.
- Settings can test an OpenAI-compatible Base URL and API Key if that path is kept.
- The model selector refreshes models when opened.
- Chinese and English shell copy both render correctly.
