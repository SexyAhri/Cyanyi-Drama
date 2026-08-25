# Example Pages

The example pages demonstrate runtime boundaries without changing reusable UI components.

## `/chat`

Uses `createAiSdkAdapter()` and `/api/chat`.

Purpose:

- AI SDK streaming text.
- OpenAI-compatible runtime connection from the Settings panel.
- Image generation through an OpenAI-compatible `images/generations` endpoint when configured.

## `/chat/langgraph`

Uses `createLangGraphAdapter()` and `/api/agent`.

Purpose:

- LangGraph `interrupt`.
- Human approval rendered through `ToolCard`.
- LangGraph `resume` through `Command({ resume })`.

## Boundary Check

Example pages should only compose:

- an adapter,
- `useAgent`,
- `Chat`.

They should not contain runtime protocol parsing, tool rendering rules, or event merge logic.
