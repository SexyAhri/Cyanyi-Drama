"use client";

import { Bot, LoaderCircle, Send, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { MessageList } from "@/components/agent/message";
import type { ToolRegistry } from "@/components/agent/tool/tool-registry";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgent } from "@/hooks/use-agent";

import { getStageCopy } from "../i18n";
import type {
  StudioAgentContext,
  StudioLocale,
  WorkspaceSnapshot,
} from "../types";
import { createStudioAgentAdapter } from "./studio-agent-adapter";

const copy = {
  "zh-CN": {
    ask: "询问当前制作状态",
    check: "检查当前阶段",
    empty: "上下文 Agent",
    failed: "列出失败任务",
    retry: "重试失败媒体任务",
    send: "发送",
    selected: "当前选择",
  },
  en: {
    ask: "Ask about the current production state",
    check: "Check current stage",
    empty: "Context agent",
    failed: "List failed tasks",
    retry: "Retry failed media task",
    send: "Send",
    selected: "Selected",
  },
} as const;

const operations = [
  "cancel_media_task",
  "cancel_workflow",
  "pause_workflow",
  "resume_workflow",
  "retry_media_task",
  "retry_workflow",
] as const;

function createStudioToolRegistry(locale: StudioLocale): ToolRegistry {
  const labels =
    locale === "en"
      ? [
          "Cancel media task",
          "Cancel workflow",
          "Pause workflow",
          "Resume workflow",
          "Retry media task",
          "Retry workflow",
        ]
      : [
          "取消媒体任务",
          "取消工作流",
          "暂停工作流",
          "恢复工作流",
          "重试媒体任务",
          "重试工作流",
        ];
  const description =
    locale === "en"
      ? "Requires your approval before changing production state."
      : "更改制作状态前需要你的批准。";
  return Object.fromEntries(
    operations.map((name, index) => [
      name,
      { description, label: labels[index], name, showArgs: false },
    ]),
  );
}

export function AgentPanel({
  context,
  locale,
  onRefresh,
  snapshot,
}: {
  context: StudioAgentContext;
  locale: StudioLocale;
  onRefresh: () => Promise<unknown> | void;
  snapshot: WorkspaceSnapshot;
}) {
  const text = copy[locale];
  const [input, setInput] = useState("");
  const adapter = useMemo(
    () => createStudioAgentAdapter(snapshot.project.id),
    [snapshot.project.id],
  );
  const registry = useMemo(() => createStudioToolRegistry(locale), [locale]);
  const agent = useAgent({
    adapter,
    threadId: `studio:${snapshot.project.id}:${context.episodeId ?? "project"}`,
    onEvent: (event) => {
      if (event.type === "tool.done") void onRefresh();
    },
  });
  const reset = agent.reset;
  const contextKey = `${context.episodeId ?? ""}:${context.stageId}:${context.selection?.kind ?? ""}:${context.selection?.id ?? ""}`;

  useEffect(() => {
    reset();
    setInput("");
  }, [contextKey, reset]);

  function submit(value = input) {
    const content = value.trim();
    if (!content || agent.isLoading || agent.isStreaming) return;
    setInput("");
    void agent.sendMessage(content, {
      metadata: { locale, studioContext: context },
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-3">
        <p className="truncate text-xs font-medium">
          {getStageCopy(locale, context.stageId).title}
        </p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {context.selection
            ? `${text.selected} · ${context.selection.label}`
            : snapshot.project.name}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {agent.messages.length ? (
          <MessageList
            locale={locale}
            messages={agent.messages}
            onApprove={agent.approveToolCall}
            onDeny={agent.denyToolCall}
            pendingApprovalIds={agent.pendingApprovalIds}
            registry={registry}
          />
        ) : (
          <div className="flex min-h-56 flex-col items-center justify-center gap-4 text-center">
            <span className="flex size-9 items-center justify-center rounded-md border bg-muted/30">
              <Bot className="size-4" />
            </span>
            <p className="text-sm font-medium">{text.empty}</p>
            <div className="flex max-w-64 flex-wrap justify-center gap-2">
              {[text.check, text.failed, text.retry].map((suggestion) => (
                <Button
                  key={suggestion}
                  onClick={() => submit(suggestion)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Sparkles className="size-3.5" />
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      <form
        className="border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="relative">
          <Textarea
            aria-label={text.ask}
            className="max-h-32 min-h-20 resize-none pr-11"
            disabled={agent.isLoading || agent.isStreaming}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={text.ask}
            value={input}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={text.send}
                  className="absolute right-2 bottom-2"
                  disabled={
                    !input.trim() || agent.isLoading || agent.isStreaming
                  }
                  size="icon-sm"
                  type="submit"
                />
              }
            >
              {agent.isLoading || agent.isStreaming ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </TooltipTrigger>
            <TooltipContent>{text.send}</TooltipContent>
          </Tooltip>
        </div>
        {agent.error ? (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {agent.error.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}
