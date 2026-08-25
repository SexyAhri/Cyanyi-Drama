import {
  Compass,
  MessageSquare,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";

import type { ShellNavItem, ShellThread } from "./chat-shell-types";

export const primaryNavItems: ShellNavItem[] = [
  {
    id: "search",
    label: "Search",
    icon: Search,
  },
  {
    id: "explore",
    label: "Explore",
    icon: Compass,
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
  },
];

export const runtimeNavItems: ShellNavItem[] = [
  {
    id: "ai-sdk",
    href: "/chat",
    label: "AI SDK",
    icon: Sparkles,
  },
  {
    id: "langgraph",
    href: "/chat/langgraph",
    label: "LangGraph",
    icon: Compass,
  },
];

export const demoRecentThreads: ShellThread[] = [
  {
    id: "tool-approval-flow",
    title: "Tool approval flow",
    icon: MessageSquare,
    messages: [
      {
        id: "tool-approval-flow-user",
        role: "user",
        content: "Show me a tool approval flow with a pending action.",
        createdAt: "2026-07-03T09:00:00.000Z",
      },
      {
        id: "tool-approval-flow-assistant",
        role: "assistant",
        content:
          "The approval card is rendered when a tool emits an approval.required event. The shell keeps the thread selected while the agent hook owns the pending approval state.",
        createdAt: "2026-07-03T09:00:08.000Z",
      },
    ],
  },
  {
    id: "weather-lookup-demo",
    title: "Weather lookup demo",
    icon: MessageSquare,
    messages: [
      {
        id: "weather-lookup-demo-user",
        role: "user",
        content: "What's the weather demo supposed to show?",
        createdAt: "2026-07-03T09:05:00.000Z",
      },
      {
        id: "weather-lookup-demo-assistant",
        role: "assistant",
        content:
          "It demonstrates a short user request, a runtime adapter response, and a clean return to the composer without leaving loading state behind.",
        createdAt: "2026-07-03T09:05:07.000Z",
      },
    ],
  },
  {
    id: "long-markdown-response",
    title: "Long markdown response",
    icon: MessageSquare,
    messages: [
      {
        id: "long-markdown-response-user",
        role: "user",
        content: "Give me the markdown rendering checklist.",
        createdAt: "2026-07-03T09:12:00.000Z",
      },
      {
        id: "long-markdown-response-assistant",
        role: "assistant",
        content:
          "A good markdown pass checks paragraphs, lists, inline code, fenced code blocks, tables, and links. The chat viewport should stay scrollable while the input remains anchored.",
        createdAt: "2026-07-03T09:12:10.000Z",
      },
    ],
  },
  {
    id: "adapter-migration-notes",
    title: "Adapter migration notes",
    icon: MessageSquare,
    messages: [
      {
        id: "adapter-migration-notes-user",
        role: "user",
        content: "How should a backend adapter plug into this template?",
        createdAt: "2026-07-03T09:20:00.000Z",
      },
      {
        id: "adapter-migration-notes-assistant",
        role: "assistant",
        content:
          "Keep transport code inside the adapter, emit normalized AgentEvent objects, and let useAgent merge events into AgentMessage state. UI components should stay protocol-agnostic.",
        createdAt: "2026-07-03T09:20:12.000Z",
      },
    ],
  },
];

export const demoArchivedThreads: ShellThread[] = [
  {
    id: "archived-tool-card",
    title: "Tool card polish",
    icon: MessageSquare,
    messages: [
      {
        id: "archived-tool-card-user",
        role: "user",
        content: "Summarize the tool card polish work.",
        createdAt: "2026-07-02T10:00:00.000Z",
      },
      {
        id: "archived-tool-card-assistant",
        role: "assistant",
        content:
          "Tool cards should expose name, status, arguments, results, and approval controls while keeping the main message stream readable.",
        createdAt: "2026-07-02T10:00:11.000Z",
      },
    ],
  },
  {
    id: "archived-hitl-copy",
    title: "HITL approval copy",
    icon: MessageSquare,
    messages: [
      {
        id: "archived-hitl-copy-user",
        role: "user",
        content: "What copy should approvals use?",
        createdAt: "2026-07-02T10:25:00.000Z",
      },
      {
        id: "archived-hitl-copy-assistant",
        role: "assistant",
        content:
          "Approval copy should state the requested action, the risk, and the available decisions. Keep buttons short and put details in the body.",
        createdAt: "2026-07-02T10:25:08.000Z",
      },
    ],
  },
  {
    id: "archived-template-docs",
    title: "Template docs cleanup",
    icon: MessageSquare,
    messages: [
      {
        id: "archived-template-docs-user",
        role: "user",
        content: "What still belongs in the integration guide?",
        createdAt: "2026-07-02T11:00:00.000Z",
      },
      {
        id: "archived-template-docs-assistant",
        role: "assistant",
        content:
          "The guide should cover adapter contracts, event shape, approval handling, shell customization, and the minimal steps for wiring a real backend.",
        createdAt: "2026-07-02T11:00:13.000Z",
      },
    ],
  },
];
