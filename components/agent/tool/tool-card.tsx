"use client";

import { useState } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock3,
  Loader2,
  Terminal,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { AgentComposerReferenceImage } from "../composer";
import { Separator } from "@/components/ui/separator";
import type { AgentToolCall, ToolCallStatus } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

import { ApprovalButtons } from "./approval-buttons";
import { MediaToolCard } from "./media-tool-card";
import {
  defaultToolRegistry,
  formatUnknown,
  type ToolRegistry,
} from "./tool-registry";

type ToolCardProps = {
  toolCall: AgentToolCall;
  createdAt?: string;
  onApprove?: (approvalId: string) => Promise<void> | void;
  onDeny?: (approvalId: string) => Promise<void> | void;
  isApprovalSubmitting?: boolean;
  locale?: "en" | "zh-CN";
  registry?: ToolRegistry;
  embedded?: boolean;
  onUseAsReferenceImage?: (referenceImage: AgentComposerReferenceImage) => void;
};

const statusMeta: Record<
  ToolCallStatus,
  {
    icon: typeof Clock3;
    badgeClassName: string;
  }
> = {
  pending: {
    icon: Clock3,
    badgeClassName: "border-border bg-secondary text-secondary-foreground",
  },
  approved: {
    icon: CheckCircle2,
    badgeClassName: "border-border bg-secondary text-secondary-foreground",
  },
  denied: {
    icon: Ban,
    badgeClassName: "bg-destructive/10 text-destructive",
  },
  running: {
    icon: Loader2,
    badgeClassName: "border-border bg-secondary text-secondary-foreground",
  },
  done: {
    icon: CheckCircle2,
    badgeClassName: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  error: {
    icon: XCircle,
    badgeClassName: "bg-destructive/10 text-destructive",
  },
};

const copy = {
  "zh-CN": {
    arguments: "参数",
    description: "工具调用",
    error: "错误",
    name: "名称",
    result: "结果",
    running: "工具正在执行。",
    statuses: {
      approved: "已批准",
      denied: "已拒绝",
      done: "已完成",
      error: "错误",
      pending: "待审批",
      running: "执行中",
    },
    toolId: "工具 ID",
    waiting: "正在等待工具开始执行。",
  },
  en: {
    arguments: "Arguments",
    description: "Tool call",
    error: "Error",
    name: "Name",
    result: "Result",
    running: "Tool is running.",
    statuses: {
      approved: "Approved",
      denied: "Denied",
      done: "Done",
      error: "Error",
      pending: "Pending",
      running: "Running",
    },
    toolId: "Tool ID",
    waiting: "Waiting for the tool to start.",
  },
} as const;

export function ToolCard({
  toolCall,
  createdAt,
  onApprove,
  onDeny,
  isApprovalSubmitting,
  locale = "en",
  registry = defaultToolRegistry,
  embedded = false,
  onUseAsReferenceImage,
}: ToolCardProps) {
  const registryItem = registry[toolCall.name];
  const text = copy[locale];
  const title = registryItem?.label ?? toolCall.name;
  const description = registryItem?.description ?? text.description;
  const meta = statusMeta[toolCall.status];
  const StatusIcon = meta.icon;
  const isMediaTool =
    toolCall.name === "image_generation" ||
    toolCall.name === "video_generation";

  if (isMediaTool) {
    return (
      <MediaToolCard
        createdAt={createdAt}
        embedded={embedded}
        onUseAsReferenceImage={onUseAsReferenceImage}
        toolCall={toolCall}
      />
    );
  }

  return (
    <Card
      className={cn(
        "w-full rounded-lg bg-background",
        !embedded && "mx-auto max-w-157",
        toolCall.status === "error" && "ring-destructive/30",
      )}
      size="sm"
    >
      <CardHeader>
        <div className="flex min-w-0 items-start gap-2">
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
            {toolCall.status === "running" ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : (
              <Terminal className="size-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <CardTitle className="truncate">{title}</CardTitle>
            <CardDescription className="mt-0.5">{description}</CardDescription>
          </div>
        </div>
        <CardAction>
          <Badge className={meta.badgeClassName} variant="outline">
            <StatusIcon
              className={cn(toolCall.status === "running" && "animate-spin")}
            />
            {text.statuses[toolCall.status]}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <span className="font-medium text-foreground">{text.toolId}</span>
            <p className="mt-1 truncate font-mono">{toolCall.id}</p>
          </div>
          <div>
            <span className="font-medium text-foreground">{text.name}</span>
            <p className="mt-1 truncate font-mono">{toolCall.name}</p>
          </div>
        </div>

        <Separator />

        {registryItem?.showArgs !== false ? (
          <ToolDataSection
            defaultOpen
            label={text.arguments}
            value={
              registryItem?.renderArgs?.(toolCall.args) ?? (
                <JsonBlock value={toolCall.args} />
              )
            }
          />
        ) : null}

        {toolCall.result !== undefined ? (
          <ToolDataSection
            defaultOpen
            label={text.result}
            value={
              registryItem?.renderResult?.(toolCall.result) ?? (
                <JsonBlock value={toolCall.result} />
              )
            }
          />
        ) : null}

        {toolCall.error ? (
          <ToolDataSection
            defaultOpen
            label={text.error}
            tone="error"
            value={
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {toolCall.error}
              </div>
            }
          />
        ) : null}

        {toolCall.status === "pending" && !toolCall.approvalId ? (
          <div className="flex items-center gap-2 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            <CircleDashed className="size-4" />
            {text.waiting}
          </div>
        ) : null}

        {toolCall.status === "running" ? (
          <div className="flex items-center gap-2 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {text.running}
          </div>
        ) : null}

        {toolCall.approvalId && toolCall.status === "pending" ? (
          <ApprovalButtons
            disabled={isApprovalSubmitting}
            locale={locale}
            onApprove={() => onApprove?.(toolCall.approvalId!)}
            onDeny={() => onDeny?.(toolCall.approvalId!)}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function ToolDataSection({
  label,
  value,
  defaultOpen = false,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  defaultOpen?: boolean;
  tone?: "error";
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted",
          tone === "error" && "text-destructive",
        )}
      >
        <span>{label}</span>
        <ChevronDown
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{value}</CollapsibleContent>
    </Collapsible>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap wrap-break-word rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed">
      {formatUnknown(value)}
    </pre>
  );
}
