"use client";

import { useEffect, useState } from "react";
import { Circle } from "lucide-react";

import type { AgentMessage } from "@/lib/agent/types";

export function ThinkingIndicator({ messages }: { messages: AgentMessage[] }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
    if (activeTool || hasAssistantText || latestUserIndex < 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [activeTool, hasAssistantText, latestUserIndex]);

  if (hasAssistantText || activeTool || latestUserIndex < 0) {
    return null;
  }

  const label = hasCompletedTool ? "正在整理生成结果" : "正在等待回复";
  const elapsedLabel = elapsedSeconds < 60
    ? `${elapsedSeconds} 秒`
    : `${Math.floor(elapsedSeconds / 60)} 分 ${elapsedSeconds % 60} 秒`;

  return (
    <div
      aria-live="polite"
      aria-label={label}
      className="flex min-h-8 items-center gap-2.5 py-1 text-sm text-muted-foreground"
      role="status"
    >
      <Circle
        aria-hidden="true"
        className="size-3 shrink-0 animate-pulse fill-current text-foreground motion-reduce:animate-none"
        strokeWidth={0}
      />
      <span aria-hidden="true">{label}<span className="ml-0.5">…</span></span>
      {elapsedSeconds >= 5 ? (
        <span aria-hidden="true" className="text-xs tabular-nums">
          已等待 {elapsedLabel}
        </span>
      ) : null}
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
