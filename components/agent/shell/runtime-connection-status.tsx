"use client";

import { AlertCircle, CheckCircle2, Circle, LoaderCircle } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { ShellCopy } from "./chat-shell-i18n";
import type { RuntimeConnectionSettings } from "./chat-shell-types";

type RuntimeConnectionStatusProps = {
  className?: string;
  copy: ShellCopy;
  settings: RuntimeConnectionSettings;
};

export function RuntimeConnectionStatus({
  className,
  copy,
  settings,
}: RuntimeConnectionStatusProps) {
  const label = getRuntimeConnectionStatusLabel(settings, copy);

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted",
          getStatusClassName(settings.status),
          className,
        )}
      >
        <StatusIcon status={settings.status} />
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function getRuntimeConnectionStatusLabel(
  settings: RuntimeConnectionSettings,
  copy: ShellCopy,
) {
  return settings.statusMessage || getDefaultStatusLabel(settings.status, copy);
}

function getDefaultStatusLabel(
  status: RuntimeConnectionSettings["status"],
  copy: ShellCopy,
) {
  if (status === "loading") {
    return copy.connectionLoading;
  }

  if (status === "success") {
    return copy.connectionSuccess;
  }

  if (status === "error") {
    return copy.connectionError;
  }

  return copy.connectionIdle;
}

function StatusIcon({ status }: { status: RuntimeConnectionSettings["status"] }) {
  if (status === "success") {
    return <CheckCircle2 className="size-4" />;
  }

  if (status === "error") {
    return <AlertCircle className="size-4" />;
  }

  if (status === "loading") {
    return <LoaderCircle className="size-4 animate-spin" />;
  }

  return <Circle className="size-4" />;
}

function getStatusClassName(status: RuntimeConnectionSettings["status"]) {
  if (status === "success") {
    return "text-emerald-600 dark:text-emerald-400";
  }

  if (status === "error") {
    return "text-destructive";
  }

  if (status === "loading") {
    return "text-amber-600 dark:text-amber-400";
  }

  return "text-muted-foreground";
}
