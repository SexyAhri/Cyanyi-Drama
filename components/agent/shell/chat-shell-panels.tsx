"use client";

import {
  Archive,
  ArchiveRestore,
  Bot,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { AgentSettingsDialog } from "./agent-settings-dialog";
import type { ShellCopy } from "./chat-shell-i18n";
import type {
  ModelOption,
  ChannelModelUpdate,
  RuntimeConnectionSettings,
  ShellThread,
  ShellUser,
} from "./chat-shell-types";
import type { ShellSettings } from "./shell-settings";

export type ShellPanel = "archive" | "help" | "search" | "settings";

type ChatShellPanelsProps = {
  archivedThreads: ShellThread[];
  copy: ShellCopy;
  models: ModelOption[];
  onOpenChange: (panel: ShellPanel | null) => void;
  onRuntimeConnectionClear: () => void;
  onRuntimeConnectionChange: (settings: RuntimeConnectionSettings) => void;
  onModelsChange?: (update: ChannelModelUpdate) => void;
  onTestRuntimeConnection: () => void;
  onSearchChange: (value: string) => void;
  onSelectThread: (threadId: string) => void;
  onSettingsChange: (settings: ShellSettings) => void;
  onUnarchiveThread?: (threadId: string) => void;
  openPanel: ShellPanel | null;
  searchQuery: string;
  searchResults: ShellThread[];
  runtimeConnection: RuntimeConnectionSettings;
  settings: ShellSettings;
  user?: ShellUser | null;
};

export function ChatShellPanels({
  archivedThreads,
  copy,
  models,
  onOpenChange,
  onRuntimeConnectionClear,
  onRuntimeConnectionChange,
  onModelsChange,
  onSearchChange,
  onSelectThread,
  onSettingsChange,
  onTestRuntimeConnection,
  onUnarchiveThread,
  openPanel,
  searchQuery,
  searchResults,
  runtimeConnection,
  settings,
  user,
}: ChatShellPanelsProps) {
  return (
    <>
      <ShellDialog
        description={copy.searchDescription}
        icon={<Search />}
        onOpenChange={(open) => onOpenChange(open ? "search" : null)}
        open={openPanel === "search"}
        title={copy.searchChats}
      >
        <Input
          autoFocus
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={copy.searchPlaceholder}
          value={searchQuery}
        />
        <ThreadList
          emptyLabel={copy.noMatchingChats}
          items={searchResults}
          onSelect={(threadId) => {
            onSelectThread(threadId);
            onOpenChange(null);
          }}
        />
      </ShellDialog>

      <ShellDialog
        description={copy.archiveDescription}
        icon={<Archive />}
        onOpenChange={(open) => onOpenChange(open ? "archive" : null)}
        open={openPanel === "archive"}
        title={copy.archivedChats}
      >
        <ThreadList
          emptyLabel={copy.archiveEmpty}
          items={archivedThreads}
          onRestore={onUnarchiveThread}
          onSelect={(threadId) => {
            onSelectThread(threadId);
            onOpenChange(null);
          }}
        />
      </ShellDialog>

      <ShellDialog
        description={copy.helpDescription}
        icon={<Bot />}
        onOpenChange={(open) => onOpenChange(open ? "help" : null)}
        open={openPanel === "help"}
        title={copy.help}
      >
        <div className="grid gap-2 text-sm">
          <HelpRow label={copy.helpNewChat} value={copy.helpNewChatValue} />
          <HelpRow label={copy.helpSearch} value={copy.helpSearchValue} />
          <HelpRow label={copy.helpSettings} value={copy.helpSettingsValue} />
        </div>
      </ShellDialog>

      <AgentSettingsDialog
        copy={copy}
        models={models}
        onModelsChange={onModelsChange}
        onOpenChange={(open) => onOpenChange(open ? "settings" : null)}
        onRuntimeConnectionChange={onRuntimeConnectionChange}
        onRuntimeConnectionClear={onRuntimeConnectionClear}
        onSettingsChange={onSettingsChange}
        onTestRuntimeConnection={onTestRuntimeConnection}
        open={openPanel === "settings"}
        runtimeConnection={runtimeConnection}
        settings={settings}
        user={user}
      />
    </>
  );
}

function ShellDialog({
  className,
  children,
  description,
  icon,
  onOpenChange,
  open,
  title,
}: React.PropsWithChildren<{
  className?: string;
  description: string;
  icon: React.ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}>) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className={cn("sm:max-w-lg", className)}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
              {icon}
            </div>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

function ThreadList({
  emptyLabel,
  items,
  onRestore,
  onSelect,
}: {
  emptyLabel: string;
  items: ShellThread[];
  onRestore?: (threadId: string) => void;
  onSelect: (threadId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="grid gap-1">
      {items.map((item) => {
        const Icon = item.icon ?? Bot;

        return (
          <div className="relative" key={item.id}>
            <Button
              className="h-10 w-full justify-start px-2 pr-9"
              onClick={() => onSelect(item.id)}
              type="button"
              variant="ghost"
            >
              <Icon />
              <span className="truncate">{item.title}</span>
            </Button>
            {onRestore ? (
              <Button
                aria-label="Unarchive chat"
                className="absolute right-1 top-1"
                onClick={(event) => {
                  event.stopPropagation();
                  onRestore(item.id);
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <ArchiveRestore />
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function HelpRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <span className="font-medium">{label}</span>
      <Badge className="max-w-56 justify-start truncate" variant="outline">
        {value}
      </Badge>
    </div>
  );
}
