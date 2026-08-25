"use client";

import { Bug, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { useAgent } from "@/hooks/use-agent";

type DebugPanelProps = {
  agent: ReturnType<typeof useAgent>;
};

export function DebugPanel({ agent }: DebugPanelProps) {
  const [open, setOpen] = useState(false);

  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open ? (
        <div className="mb-2 w-[min(24rem,calc(100vw-2rem))] rounded-lg border bg-background/95 text-xs shadow-lg backdrop-blur">
          <div className="flex items-center justify-between gap-2 border-b p-2">
            <div className="flex items-center gap-2">
              <Bug className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">Agent Debug</span>
              <Badge variant="outline">{agent.debug.events.length}</Badge>
            </div>
            <Button
              aria-label="Close debug panel"
              onClick={() => setOpen(false)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
          <div className="p-3">
          <div className="grid grid-cols-2 gap-2">
            <DebugValue label="Messages" value={agent.messages.length} />
            <DebugValue label="Loading" value={String(agent.isLoading)} />
            <DebugValue label="Streaming" value={String(agent.isStreaming)} />
            <DebugValue
              label="Pending"
              value={agent.debug.pendingApprovalIds.length}
            />
          </div>

          {agent.debug.lastError ? (
            <div className="mt-3 rounded-md bg-destructive/10 p-2 text-destructive">
              {agent.debug.lastError}
            </div>
          ) : null}

          <div className="mt-3">
            <p className="mb-1 font-medium">Recent events</p>
            <ScrollArea className="h-52 rounded-md border bg-muted/30">
              <pre className="whitespace-pre-wrap wrap-break-word p-2 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(agent.debug.events.slice(-10), null, 2)}
              </pre>
            </ScrollArea>
          </div>
        </div>
        </div>
      ) : null}

      <Button
        aria-label="Open debug panel"
        className="relative rounded-full shadow-lg"
        onClick={() => setOpen((current) => !current)}
        size="icon"
        type="button"
        variant="outline"
      >
        <Bug />
        {agent.debug.events.length ? (
          <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
            {Math.min(agent.debug.events.length, 9)}
          </span>
        ) : null}
      </Button>
    </div>
  );
}

function DebugValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-md bg-muted/50 p-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono">{String(value)}</p>
    </div>
  );
}
