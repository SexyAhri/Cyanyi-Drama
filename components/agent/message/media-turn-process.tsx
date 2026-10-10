"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import type { AgentMessage } from "@/lib/agent/types";
import { getMediaToolPresentation } from "../tool/media-tool-card-data";

export function MediaTurnProcess({ message, tools, locale, fallbackLabel }: {
  message: AgentMessage; tools: AgentMessage[]; locale: "en" | "zh-CN";
  fallbackLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const metadata = message.metadata;
  const texts = Array.isArray(metadata?.processTexts)
    ? metadata.processTexts.filter((text): text is string => typeof text === "string") : [];
  const start = typeof metadata?.processStartedAt === "string" ? Date.parse(metadata.processStartedAt) : NaN;
  const end = typeof metadata?.processFinishedAt === "string" ? Date.parse(metadata.processFinishedAt) : NaN;
  const seconds = Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 1000) : null;
  const duration = seconds === null ? null : locale === "zh-CN"
    ? `${seconds >= 60 ? `${Math.floor(seconds / 60)}分` : ""}${seconds % 60}秒`
    : `${seconds >= 60 ? `${Math.floor(seconds / 60)}m ` : ""}${seconds % 60}s`;
  const active = metadata?.processActive === true;
  const label = active ? (locale === "zh-CN" ? "正在生成" : "Generating")
    : duration ? (locale === "zh-CN" ? `用时 ${duration}` : `Took ${duration}`)
    : fallbackLabel ?? (locale === "zh-CN" ? "生成过程" : "Generation process");
  const processTools = tools.filter((tool) => {
    const media = tool.toolCall ? getMediaToolPresentation(tool.toolCall) : null;
    if (!media || (media.lifecycle === "success" && !media.safetyRetry)) return false;
    return !(!tool.metadata?.directMediaGeneration &&
      (media.lifecycle === "error" || media.lifecycle === "denied") &&
      Boolean(message.content.trim()));
  });
  if (!texts.length && !processTools.length) {
    return <div className="py-1 text-sm text-muted-foreground">{label}</div>;
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full">
      <CollapsibleTrigger className="flex items-center gap-1.5 rounded-md py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span>{label}</span><ChevronRight className={`size-4 ${open ? "rotate-90" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 space-y-4 border-b border-border/60 pb-4 text-sm leading-7 text-muted-foreground [overflow-wrap:anywhere]">
          {texts.map((text, index) => <MarkdownRenderer key={index}>{text}</MarkdownRenderer>)}
          {processTools.map((tool) => {
            const media = tool.toolCall ? getMediaToolPresentation(tool.toolCall) : null;
            if (!media) return null;
            const explainedFailure = !tool.metadata?.directMediaGeneration &&
              (media.lifecycle === "error" || media.lifecycle === "denied") &&
              Boolean(message.content.trim());
            if (explainedFailure) return null;
            return <div key={tool.id} className="space-y-2">
              {media.safetyRetry ? <><p>{locale === "zh-CN" ? "首次尝试被安全检查拦截，已调整描述并重新生成。" : "The first attempt was blocked by a safety check. The description was revised for another attempt."}</p><details><summary className="cursor-pointer">{locale === "zh-CN" ? "查看调整后的描述" : "View revised description"}</summary><p className="mt-2 whitespace-pre-wrap">{media.safetyRetry.revisedPrompt}</p></details></> : null}
              {media.lifecycle !== "success" ? <p>{media.kind === "image" ? (locale === "zh-CN" ? "图片生成" : "Image generation") : (locale === "zh-CN" ? "视频生成" : "Video generation")} · {media.lifecycle === "error" || media.lifecycle === "denied" ? (locale === "zh-CN" ? "未完成" : "Failed") : (locale === "zh-CN" ? "进行中" : "In progress")}</p> : null}
            </div>;
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
