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
import { MediaGenerationToolCard } from "./tool-renderers";
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
  registry?: ToolRegistry;
  embedded?: boolean;
  onUseAsReferenceImage?: (
    referenceImage: AgentComposerReferenceImage,
  ) => void;
};

const statusMeta: Record<
  ToolCallStatus,
  {
    label: string;
    icon: typeof Clock3;
    badgeClassName: string;
  }
> = {
  pending: {
    label: "Pending",
    icon: Clock3,
    badgeClassName: "border-border bg-secondary text-secondary-foreground",
  },
  approved: {
    label: "Approved",
    icon: CheckCircle2,
    badgeClassName: "border-border bg-secondary text-secondary-foreground",
  },
  denied: {
    label: "Denied",
    icon: Ban,
    badgeClassName: "bg-destructive/10 text-destructive",
  },
  running: {
    label: "Running",
    icon: Loader2,
    badgeClassName: "border-border bg-secondary text-secondary-foreground",
  },
  done: {
    label: "Done",
    icon: CheckCircle2,
    badgeClassName: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  error: {
    label: "Error",
    icon: XCircle,
    badgeClassName: "bg-destructive/10 text-destructive",
  },
};

export function ToolCard({
  toolCall,
  createdAt,
  onApprove,
  onDeny,
  isApprovalSubmitting,
  registry = defaultToolRegistry,
  embedded = false,
  onUseAsReferenceImage,
}: ToolCardProps) {
  const registryItem = registry[toolCall.name];
  const title = registryItem?.label ?? toolCall.name;
  const description = registryItem?.description ?? "Tool call";
  const meta = statusMeta[toolCall.status];
  const StatusIcon = meta.icon;
  const isMediaTool =
    toolCall.name === "image_generation" || toolCall.name === "video_generation";

  if (isMediaTool) {
    return (
      <MediaGenerationToolCard
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
            {meta.label}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <span className="font-medium text-foreground">Tool ID</span>
            <p className="mt-1 truncate font-mono">{toolCall.id}</p>
          </div>
          <div>
            <span className="font-medium text-foreground">Name</span>
            <p className="mt-1 truncate font-mono">{toolCall.name}</p>
          </div>
        </div>

        <Separator />

        <ToolDataSection
          defaultOpen
          label="Arguments"
          value={
            registryItem?.renderArgs?.(toolCall.args) ?? (
              <JsonBlock value={toolCall.args} />
            )
          }
        />

        {toolCall.result !== undefined ? (
          <ToolDataSection
            defaultOpen
            label="Result"
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
            label="Error"
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
            Waiting for the tool to start.
          </div>
        ) : null}

        {toolCall.status === "running" ? (
          <div className="flex items-center gap-2 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Tool is running.
          </div>
        ) : null}

        {toolCall.approvalId ? (
          <ApprovalButtons
            disabled={toolCall.status !== "pending" || isApprovalSubmitting}
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
