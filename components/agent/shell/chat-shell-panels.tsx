"use client";

import {
  Archive,
  ArchiveRestore,
  Bot,
  Compass,
  Search,
  Settings,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import type { ShellCopy } from "./chat-shell-i18n";
import type {
  ModelOption,
  ChannelModelUpdate,
  RuntimeConnectionSettings,
  ShellNavItem,
  ShellThread,
} from "./chat-shell-types";
import { ChannelSettingsPanel } from "./channel-settings-panel";
import { PreferencesSettingsPanel } from "./preferences-settings-panel";

export type ShellPanel = "archive" | "explore" | "help" | "search" | "settings";

export type ShellSettings = {
  compactSidebar: boolean;
  analysisModel: string;
  characterModel: string;
  locationModel: string;
  storyboardModel: string;
  editModel: string;
  videoModel: string;
  audioModel: string;
  lipSyncModel: string;
  videoRatio: string;
  artStyle: string;
  ttsRate: string;
};

type ChatShellPanelsProps = {
  archivedThreads: ShellThread[];
  copy: ShellCopy;
  exploreItems: ShellNavItem[];
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
};

export function ChatShellPanels({
  archivedThreads,
  copy,
  exploreItems,
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
        description={copy.exploreDescription}
        icon={<Compass />}
        onOpenChange={(open) => onOpenChange(open ? "explore" : null)}
        open={openPanel === "explore"}
        title={copy.explore}
      >
        <div className="grid gap-2">
          {exploreItems.map((item) => {
            const Icon = item.icon;

            return (
              <a
                className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted"
                href={item.href}
                key={item.id}
              >
                <Icon className="size-4 text-muted-foreground" />
                <span className="font-medium">{item.label}</span>
              </a>
            );
          })}
        </div>
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
          <HelpRow label={copy.helpRuntime} value={copy.helpRuntimeValue} />
          <HelpRow label={copy.helpSettings} value={copy.helpSettingsValue} />
        </div>
      </ShellDialog>

      <ShellDialog
        className="max-h-[92vh] overflow-y-auto sm:max-w-5xl"
        description={copy.settingsDescription}
        icon={<Settings />}
        onOpenChange={(open) => onOpenChange(open ? "settings" : null)}
        open={openPanel === "settings"}
        title={copy.settings}
      >
        <Tabs className="w-full" defaultValue="channels">
          <TabsList
            className="w-full justify-start gap-5 border-b px-0 pb-0"
            variant="line"
          >
            <TabsTrigger className="flex-none px-0 pb-3" value="channels">
              {copy.settingsChannels}
            </TabsTrigger>
            <TabsTrigger className="flex-none px-0 pb-3" value="preferences">
              {copy.settingsPreferences}
            </TabsTrigger>
            <TabsTrigger
              className="flex-none px-0 pb-3"
              value="prompt-sources"
            >
              {copy.settingsPromptSources}
            </TabsTrigger>
            <TabsTrigger className="flex-none px-0 pb-3" value="webdav">
              {copy.settingsWebdav}
            </TabsTrigger>
          </TabsList>

          <TabsContent className="mt-4 grid gap-3" value="channels">
            <ChannelSettingsPanel
              copy={copy}
              models={models}
              onFinish={() => onOpenChange(null)}
              onRefreshModels={onTestRuntimeConnection}
              onRuntimeConnectionChange={onRuntimeConnectionChange}
              onModelsChange={onModelsChange}
              onRuntimeConnectionClear={onRuntimeConnectionClear}
              runtimeConnection={runtimeConnection}
            />
          </TabsContent>

          <TabsContent className="mt-4 grid gap-3" value="preferences">
            <PreferencesSettingsPanel
              copy={copy}
              models={models}
              onChange={onSettingsChange}
              settings={settings}
            />
          </TabsContent>

          <TabsContent className="mt-4" value="prompt-sources">
            <SettingsPlaceholder
              description={copy.settingsPromptSourcesDescription}
              message={copy.settingsComingSoon}
            />
          </TabsContent>

          <TabsContent className="mt-4" value="webdav">
            <SettingsPlaceholder
              description={copy.settingsWebdavDescription}
              message={copy.settingsComingSoon}
            />
          </TabsContent>
        </Tabs>
      </ShellDialog>
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


function SettingsPlaceholder({
  description,
  message,
}: {
  description: string;
  message: string;
}) {
  return (
    <div className="grid min-h-48 place-content-center gap-2 rounded-lg border border-dashed p-6 text-center">
      <p className="font-medium">{message}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
