"use client";

import { useMemo, useState } from "react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { inferModelCapabilities } from "@/lib/agent/provider-types";

import { ChatSidebar } from "./chat-sidebar";
import { demoArchivedThreads, demoRecentThreads } from "./chat-shell-data";
import { getShellCopy } from "./chat-shell-i18n";
import {
  ChatShellPanels,
  type ShellPanel,
} from "./chat-shell-panels";
import {
  createDefaultShellSettings,
  type ShellSettings,
} from "./shell-settings";
import { ChatTopbar } from "./chat-topbar";
import type {
  AgentLocale,
  ModelOption,
  ChannelModelUpdate,
  RuntimeConnectionSettings,
  ShellThread,
  ShellUser,
} from "./chat-shell-types";
import {
  filterShellThreads,
  findShellThread,
  getShellThreadTitle,
} from "./chat-shell-utils";

type ChatShellProps = {
  appVersion?: string;
  archivedThreads?: ShellThread[];
  children: React.ReactNode;
  currentThreadId?: string | null;
  locale: AgentLocale;
  models: ModelOption[];
  onLocaleChange: (locale: AgentLocale) => void;
  onActiveModelChange?: (modelId: string) => void;
  onArchiveThread?: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onLogout?: () => void;
  onModelChange: (modelId: string) => void;
  onModelsChange?: (update: ChannelModelUpdate) => void;
  onNewChat: () => void;
  onRenameThread?: (threadId: string, title: string) => void;
  onReorderThread?: (draggedThreadId: string, targetThreadId: string) => void;
  onRuntimeConnectionClear?: () => void;
  onRuntimeConnectionChange?: (settings: RuntimeConnectionSettings) => void;
  onSelectThread?: (thread: ShellThread) => void;
  onTestRuntimeConnection?: () => void;
  onToggleThreadPinned?: (threadId: string) => void;
  onUnarchiveThread?: (threadId: string) => void;
  recentThreads?: ShellThread[];
  runtimeConnection?: RuntimeConnectionSettings;
  selectedModel: string;
  topbarActions?: React.ReactNode;
  user?: ShellUser | null;
};

export function ChatShell({
  appVersion,
  archivedThreads = demoArchivedThreads,
  children,
  currentThreadId,
  locale,
  models,
  onLocaleChange,
  onActiveModelChange,
  onArchiveThread,
  onDeleteThread,
  onLogout,
  onModelChange,
  onModelsChange,
  onNewChat,
  onRenameThread,
  onReorderThread,
  onRuntimeConnectionClear,
  onRuntimeConnectionChange,
  onSelectThread,
  onTestRuntimeConnection,
  onToggleThreadPinned,
  onUnarchiveThread,
  recentThreads = demoRecentThreads,
  runtimeConnection = {
    apiKey: "",
    baseUrl: "",
    status: "idle",
  },
  selectedModel,
  topbarActions,
  user,
}: ChatShellProps) {
  const copy = getShellCopy(locale);
  const [internalActiveThreadId, setInternalActiveThreadId] = useState<
    string | null
  >(null);
  const [openPanel, setOpenPanel] = useState<ShellPanel | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [settings, setSettings] = useState<ShellSettings>(() =>
    createDefaultShellSettings(selectedModel),
  );

  const allThreads = useMemo(
    () => [...recentThreads, ...archivedThreads],
    [archivedThreads, recentThreads],
  );

  const searchResults = useMemo(
    () => filterShellThreads(allThreads, searchQuery),
    [allThreads, searchQuery],
  );

  const activeThreadId = currentThreadId ?? internalActiveThreadId;
  const shellModels = useMemo(() => models, [models]);
  const chatModels = useMemo(
    () => models.filter(isConversationModel),
    [models],
  );

  const currentThreadTitle = getShellThreadTitle({
    activeThreadId,
    fallbackTitle: copy.newChat,
    threads: allThreads,
  });

  function handleModelChange(modelId: string) {
    onActiveModelChange?.(modelId);
    onModelChange(modelId);
  }

  function handleNewChat() {
    setInternalActiveThreadId(null);
    onNewChat();
  }

  function handleSelectThread(threadId: string) {
    const nextThread = findShellThread(allThreads, threadId);

    setInternalActiveThreadId(threadId);

    if (nextThread) {
      onSelectThread?.(nextThread);
    }
  }

  return (
    <SidebarProvider defaultOpen>
      <ChatSidebar
        activeThreadId={activeThreadId}
        compact={settings.compactSidebar}
        copy={copy}
        locale={locale}
        models={chatModels}
        onLocaleChange={onLocaleChange}
        onModelChange={handleModelChange}
        onNewChat={handleNewChat}
        onArchiveThread={onArchiveThread}
        onDeleteThread={onDeleteThread}
        onOpenArchive={() => setOpenPanel("archive")}
        onOpenHelp={() => setOpenPanel("help")}
        onOpenSearch={() => setOpenPanel("search")}
        onOpenSettings={() => setOpenPanel("settings")}
        onLogout={onLogout}
        onRenameThread={onRenameThread}
        onReorderThread={onReorderThread}
        onSelectThread={handleSelectThread}
        onToggleThreadPinned={onToggleThreadPinned}
        recentThreads={recentThreads}
        selectedModel={selectedModel}
        user={user}
      />
      <SidebarInset className="min-h-svh overflow-hidden">
        <ChatTopbar
          appVersion={appVersion}
          currentThreadTitle={currentThreadTitle}
          copy={copy}
          onNewChat={handleNewChat}
          onOpenSettings={() => setOpenPanel("settings")}
          topbarActions={topbarActions}
        />
        {children}
      </SidebarInset>
      <ChatShellPanels
        archivedThreads={archivedThreads}
        copy={copy}
        models={shellModels}
        onOpenChange={setOpenPanel}
        onModelsChange={onModelsChange}
        onRuntimeConnectionClear={onRuntimeConnectionClear ?? (() => undefined)}
        onRuntimeConnectionChange={
          onRuntimeConnectionChange ?? (() => undefined)
        }
        onSearchChange={setSearchQuery}
        onSelectThread={handleSelectThread}
        onSettingsChange={setSettings}
        onTestRuntimeConnection={onTestRuntimeConnection ?? (() => undefined)}
        onUnarchiveThread={onUnarchiveThread}
        openPanel={openPanel}
        searchQuery={searchQuery}
        searchResults={searchResults}
        runtimeConnection={runtimeConnection}
        settings={settings}
      />
    </SidebarProvider>
  );
}

function isConversationModel(model: ModelOption) {
  const modalities = new Set([
    ...(model.capabilities?.modalities ?? []),
    ...inferModelCapabilities(model.modelId || model.id).modalities,
  ]);
  return !(["image", "video", "audio", "lipsync", "voicedesign"] as const).some(
    (modality) => modalities.has(modality),
  );
}
