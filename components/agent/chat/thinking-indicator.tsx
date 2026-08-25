"use client";

import { useEffect, useState } from "react";
import { BrainCircuit, Sparkles } from "lucide-react";

import type { AgentMessage } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

const thinkingLabels = [
  "正在思考",
  "正在组织答案",
  "正在核对上下文",
];

export function ThinkingIndicator({ messages }: { messages: AgentMessage[] }) {
  const [labelIndex, setLabelIndex] = useState(0);
  const latestUserIndex = findLastIndex(messages, (message) => message.role === "user");
  const currentTurn = latestUserIndex >= 0 ? messages.slice(latestUserIndex + 1) : [];
  const hasAssistantText = currentTurn.some(
    (message) => message.role === "assistant" && message.content.trim(),
  );
  const activeTool = currentTurn.some(
    (message) =>
      message.toolCall?.status === "pending" ||
      message.toolCall?.status === "running",
  );
  const hasCompletedTool = currentTurn.some(
    (message) =>
      message.toolCall?.status === "done" ||
      message.toolCall?.status === "error",
  );

  useEffect(() => {
    if (hasCompletedTool || activeTool || hasAssistantText) {
      return;
    }

    const timer = window.setInterval(() => {
      setLabelIndex((current) => (current + 1) % thinkingLabels.length);
    }, 1800);

    return () => window.clearInterval(timer);
  }, [activeTool, hasAssistantText, hasCompletedTool]);

  if (hasAssistantText || activeTool || latestUserIndex < 0) {
    return null;
  }

  const label = hasCompletedTool ? "正在整理结果" : thinkingLabels[labelIndex];

  return (
    <div
      aria-live="polite"
      className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground"
      role="status"
    >
      <span className="relative flex size-5 items-center justify-center rounded-full bg-primary/10 text-primary">
        <BrainCircuit className="size-3.5" />
        <Sparkles className="absolute -right-1 -top-1 size-2.5 animate-pulse" />
      </span>
      <span>{label}</span>
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {[0, 1, 2].map((dot) => (
          <span
            className={cn(
              "size-1 rounded-full bg-primary/60",
              dot === 0 && "animate-bounce [animation-delay:-0.3s]",
              dot === 1 && "animate-bounce [animation-delay:-0.15s]",
              dot === 2 && "animate-bounce",
            )}
            key={dot}
          />
        ))}
      </span>
    </div>
  );
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index;
    }
  }

  return -1;
}
