"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ChatContainer, ChatMessages } from "@/components/ui/chat";
import type { useAgent } from "@/hooks/use-agent";
import { useRuntimeConnection } from "@/hooks/use-runtime-connection";
import type { AgentMessage } from "@/lib/agent/types";
import {
  loadRuntimeSettings,
  subscribeToRuntimeSettings,
} from "@/lib/settings/runtime-client";
import {
  DEFAULT_RUNTIME_SETTINGS,
  type RuntimeSettings,
} from "@/lib/settings/runtime-contract";
import { cn } from "@/lib/utils";

import {
  AgentComposer,
  applyRuntimeSettingsToComposer,
  type AgentComposerReferenceImage,
  type AgentComposerSettings,
  createDefaultComposerSettings,
  normalizeComposerSettings,
  resolveComposerModelOptions,
} from "../composer";
import { DebugPanel } from "../debug";
import { MessageList } from "../message";
import {
  ChatShell,
  getShellCopy,
  type AgentLocale,
  type ModelOption,
  type ShellNavItem,
  type ShellThread,
  type ShellUser,
} from "../shell";
import { defaultSuggestions } from "./chat-defaults";
import { canEditComposerAfterMediaToolComplete } from "./chat-utils";
import { PromptStarter } from "./prompt-starter";
import { useChatThreads } from "./use-chat-threads";

export type ChatProps = {
  archivedThreads?: ShellThread[];
  agent: ReturnType<typeof useAgent>;
  locale?: AgentLocale;
  models?: ModelOption[];
  onLogout?: () => void;
  recentThreads?: ShellThread[];
  shellActions?: React.ReactNode;
  runtimeItems?: ShellNavItem[];
  suggestions?: string[];
  user?: ShellUser | null;
};

export function Chat({
  archivedThreads,
  agent,
  locale,
  models: modelOptions = [],
  onLogout,
  recentThreads,
  shellActions,
  runtimeItems,
  suggestions = defaultSuggestions,
  user,
}: ChatProps) {
  const [activeLocale, setActiveLocale] = useState<AgentLocale>(
    locale ?? "en",
  );
  const [input, setInput] = useState("");
  const runtime = useRuntimeConnection(modelOptions);
  const composerModelOptions = useMemo(
    () => resolveComposerModelOptions(runtime.models),
    [runtime.models],
  );
  const [composerSettings, setComposerSettings] = useState(() =>
    createDefaultComposerSettings(
      composerModelOptions,
      DEFAULT_RUNTIME_SETTINGS,
    ),
  );
  const composerSettingsRef = useRef(composerSettings);
  const runtimeSettingsRef = useRef<RuntimeSettings>(DEFAULT_RUNTIME_SETTINGS);
  const copy = getShellCopy(activeLocale);
  const {
    activeThreadId,
    archiveThread,
    createThread,
    deleteThread,
    isHydrated,
    renameThread,
    reorderThread,
    restoreThread,
    setActiveThreadId,
    toggleThreadPinned,
    threads,
    unarchiveThread,
    updateActiveThread,
  } = useChatThreads({
    initialThreads: [
      ...(recentThreads ?? []),
      ...(archivedThreads ?? []).map((thread) => ({
        ...thread,
        archived: true,
      })),
    ],
    newThreadTitle: copy.newChat,
  });
  const hasRestoredPersistedThreadRef = useRef(false);

  useEffect(() => {
    if (locale) {
      setActiveLocale(locale);
    }
  }, [locale]);

  useEffect(() => {
    composerSettingsRef.current = composerSettings;
  }, [composerSettings]);

  useEffect(() => {
    let active = true;

    const applySettings = (settings: RuntimeSettings) => {
      runtimeSettingsRef.current = settings;
      setComposerSettings((current) => {
        const next = applyRuntimeSettingsToComposer(
          current,
          settings,
          composerModelOptions,
        );
        composerSettingsRef.current = next;
        return next;
      });
    };

    void loadRuntimeSettings()
      .then((settings) => {
        if (active) applySettings(settings);
      })
      .catch(() => undefined);
    const unsubscribe = subscribeToRuntimeSettings((settings) => {
      if (active) applySettings(settings);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [composerModelOptions]);

  useEffect(() => {
    setComposerSettings((current) =>
      normalizeComposerSettings(current, composerModelOptions),
    );
  }, [composerModelOptions]);

  const hasToolMessages = agent.messages.some((message) => message.toolCall);
  const isAgentBusy = agent.isLoading || agent.isStreaming;
  const canEditComposerWhileBusy =
    isAgentBusy && canEditComposerAfterMediaToolComplete(agent.messages);

  useEffect(() => {
    updateActiveThread(agent.messages);
  }, [agent.messages, updateActiveThread]);

  useEffect(() => {
    if (!isHydrated || hasRestoredPersistedThreadRef.current) {
      return;
    }

    hasRestoredPersistedThreadRef.current = true;

    if (!activeThreadId) {
      return;
    }

    const activeThread = threads.find((thread) => thread.id === activeThreadId);

    if (!activeThread) {
      return;
    }

    agent.loadMessages(activeThread.messages ?? []);
  }, [activeThreadId, agent, isHydrated, threads]);

  function handleSubmit(event?: { preventDefault?: () => void }) {
    event?.preventDefault?.();

    const trimmed = input.trim();

    if (!trimmed) {
      return;
    }

    const messageComposerSettings = composerSettingsRef.current;
    setInput("");
    void agent.sendMessage(trimmed, {
      metadata: {
        ...runtime.metadata,
        composer: messageComposerSettings,
      },
    });

    if (messageComposerSettings.mode === "chat") {
      setComposerSettings((current) => {
        const nextSettings =
          current.mode === "chat"
            ? {
                ...current,
                referenceImages: [],
                referenceImage: undefined,
              }
            : current;
        composerSettingsRef.current = nextSettings;
        return nextSettings;
      });
    }
  }

  function handleComposerSettingsChange(nextSettings: AgentComposerSettings) {
    composerSettingsRef.current = nextSettings;
    setComposerSettings(nextSettings);
  }

  function setComposerSettingsWithUpdater(
    updater: (current: AgentComposerSettings) => AgentComposerSettings,
  ) {
    setComposerSettings((current) => {
      const nextSettings = updater(current);
      composerSettingsRef.current = nextSettings;
      return nextSettings;
    });
  }

  function append(message: { role: "user"; content: string }) {
    const messageComposerSettings = composerSettingsRef.current;
    setInput("");
    void agent.sendMessage(message.content, {
      metadata: {
        ...runtime.metadata,
        composer: messageComposerSettings,
      },
    });

    if (messageComposerSettings.mode === "chat") {
      setComposerSettingsWithUpdater((current) =>
        current.mode === "chat"
          ? {
              ...current,
              referenceImages: [],
              referenceImage: undefined,
            }
          : current,
      );
    }
  }

  function handleSelectThread(thread: ShellThread) {
    setInput("");
    setActiveThreadId(thread.id);
    agent.loadMessages(thread.messages ?? []);
  }

  function handleNewChat() {
    setInput("");
    const thread = createThread();
    agent.loadMessages(thread.messages ?? []);
  }

  function handleUseAsReferenceImage(
    referenceImage: AgentComposerReferenceImage,
  ) {
    setComposerSettingsWithUpdater((current) =>
      normalizeComposerSettings(
        {
          ...current,
          mode: "image",
          template: "none",
          templatePrompt: undefined,
          referenceImage: undefined,
          referenceImages: dedupeReferenceImages([
            ...current.referenceImages,
            referenceImage,
          ]),
        },
        composerModelOptions,
      ),
    );
  }

  function handleEditMessage(message: AgentMessage) {
    if (message.role !== "user") {
      return;
    }

    setInput(message.content);
    const storedComposerSettings = getComposerSettingsFromMessage(
      message,
      composerModelOptions,
      runtimeSettingsRef.current,
    );
    const nextComposerSettings =
      storedComposerSettings ??
      createDefaultComposerSettings(
        composerModelOptions,
        runtimeSettingsRef.current,
      );

    composerSettingsRef.current = nextComposerSettings;
    setComposerSettings(nextComposerSettings);

    toast.success("已将这条消息的内容和图片填回输入框");
  }

  function handleDeleteMessage(messageId: string) {
    const nextMessages = removeMessageGroup(agent.messages, messageId);
    agent.loadMessages(nextMessages);
    toast.success("已删除消息");
  }

  function handleDeleteThread(threadId: string) {
    const result = deleteThread(threadId);

    if (result.deletedThread) {
      toast.success("已删除会话", {
        action: {
          label: "撤销",
          onClick: () => {
            restoreThread({
              activate: result.deletedActiveThread,
              insertIndex: result.insertIndex,
              thread: result.deletedThread!,
            });

            if (result.deletedActiveThread) {
              setInput("");
              agent.loadMessages(result.deletedThread?.messages ?? []);
            }
          },
        },
      });
    }

    if (!result.deletedActiveThread) {
      return;
    }

    setInput("");
    agent.loadMessages(result.nextThread?.messages ?? []);
  }

  function handleArchiveThread(threadId: string) {
    const result = archiveThread(threadId);

    if (!result.archivedActiveThread) {
      return;
    }

    setInput("");
    agent.loadMessages(result.nextThread?.messages ?? []);
  }

  function handleRegenerateMessage(messageId: string) {
    const previousUserMessage = findPreviousUserMessage(
      agent.messages,
      messageId,
    );

    if (!previousUserMessage) {
      toast.error("未找到可重新生成的用户消息");
      return;
    }

    const nextMessages = trimMessagesForRegeneration(
      agent.messages,
      previousUserMessage.id,
    );

    agent.loadMessages(nextMessages);
    setInput("");
    const storedComposerSettings = getComposerSettingsFromMessage(
      previousUserMessage,
      composerModelOptions,
      runtimeSettingsRef.current,
    );
    const mediaToolComposerSettings = getComposerSettingsFromMediaToolTurn(
      agent.messages,
      previousUserMessage.id,
      composerModelOptions,
      runtimeSettingsRef.current,
    );
    const messageComposerSettings = mergeComposerSettingsForRegeneration(
      storedComposerSettings ?? composerSettingsRef.current,
      mediaToolComposerSettings,
      composerModelOptions,
    );

    void agent.sendMessage(previousUserMessage.content, {
      metadata: {
        ...runtime.metadata,
        composer: messageComposerSettings,
      },
    });
  }

  return (
    <ChatShell
      currentThreadId={activeThreadId}
      locale={activeLocale}
      models={runtime.models}
      onActiveModelChange={runtime.setSelectedModel}
      onLocaleChange={setActiveLocale}
      onModelChange={runtime.setSelectedModel}
      onModelsChange={runtime.addChannelModels}
      onNewChat={handleNewChat}
      onLogout={onLogout}
      onRuntimeConnectionClear={runtime.clearConnection}
      onRuntimeConnectionChange={runtime.setConnection}
      archivedThreads={threads.filter((thread) => thread.archived)}
      onArchiveThread={handleArchiveThread}
      onDeleteThread={handleDeleteThread}
      onRenameThread={renameThread}
      onReorderThread={reorderThread}
      onSelectThread={handleSelectThread}
      onTestRuntimeConnection={runtime.fetchModels}
      onToggleThreadPinned={toggleThreadPinned}
      onUnarchiveThread={unarchiveThread}
      recentThreads={threads.filter((thread) => !thread.archived)}
      runtimeConnection={runtime.connection}
      runtimeItems={runtimeItems}
      selectedModel={runtime.selectedModel}
      topbarActions={shellActions}
      user={user}
    >
      <div className="relative min-h-0 flex-1 bg-background">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,color-mix(in_oklch,var(--primary),transparent_88%),transparent_34rem),linear-gradient(180deg,color-mix(in_oklch,var(--accent),transparent_88%),transparent_22rem)]" />
        <div
          className={cn(
            "relative mx-auto h-[calc(100svh-3.5rem)] w-full max-w-6xl px-4 py-4",
            hasToolMessages && "pb-4",
          )}
        >
          <ChatContainer className="h-full">
            {agent.messages.length === 0 ? (
              <PromptStarter
                append={append}
                description={copy.promptStarterDescription}
                label={copy.promptSuggestionsLabel}
                suggestions={suggestions}
              />
            ) : (
              <ChatMessages messages={agent.messages}>
                <MessageList
                  messages={agent.messages}
                  onApprove={agent.approveToolCall}
                  onDeleteMessage={handleDeleteMessage}
                  onDeny={agent.denyToolCall}
                  onEditMessage={handleEditMessage}
                  onRegenerateMessage={handleRegenerateMessage}
                  onUseAsReferenceImage={handleUseAsReferenceImage}
                  pendingApprovalIds={agent.pendingApprovalIds}
                  isThinking={isAgentBusy}
                />
              </ChatMessages>
            )}
            <AgentComposer
              allowInputWhileGenerating={canEditComposerWhileBusy}
              disabled={isAgentBusy && !canEditComposerWhileBusy}
              imageModelOptions={composerModelOptions.imageModelOptions}
              isGenerating={isAgentBusy}
              onChange={setInput}
              onSettingsChange={handleComposerSettingsChange}
              onSubmit={handleSubmit}
              placeholder={copy.inputPlaceholder}
              settings={composerSettings}
              transcribeAudio={async () => ""}
              value={input}
              videoModelOptions={composerModelOptions.videoModelOptions}
            />
          </ChatContainer>
        </div>

        {agent.error ? (
          <p className="absolute bottom-28 left-1/2 z-10 w-full max-w-6xl -translate-x-1/2 px-4 text-sm text-destructive">
            {agent.error.message}
          </p>
        ) : null}

        <DebugPanel agent={agent} />
      </div>
    </ChatShell>
  );
}

function dedupeReferenceImages(
  referenceImages: AgentComposerReferenceImage[],
) {
  const seen = new Set<string>();

  return referenceImages.filter((referenceImage) => {
    const url = referenceImage.url?.trim();

    if (!url || seen.has(url)) {
      return false;
    }

    seen.add(url);
    return true;
  });
}

function getComposerSettingsFromMessage(
  message: AgentMessage,
  composerModelOptions: ReturnType<typeof resolveComposerModelOptions>,
  runtimeSettings: RuntimeSettings,
) {
  const composer =
    message.metadata &&
    typeof message.metadata === "object" &&
    "composer" in message.metadata &&
    message.metadata.composer &&
    typeof message.metadata.composer === "object"
      ? (message.metadata.composer as Partial<AgentComposerSettings>)
      : null;

  if (!composer) {
    return null;
  }

  const defaults = createDefaultComposerSettings(
    composerModelOptions,
    runtimeSettings,
  );

  return normalizeComposerSettings(
    {
      ...defaults,
      ...composer,
      imageRatio:
        composer.imageRatio ??
        (composer.mode === "image" ? composer.ratio : undefined) ??
        defaults.imageRatio,
      imageResolution:
        composer.imageResolution ??
        (composer.mode === "image" ? composer.resolution : undefined) ??
        defaults.imageResolution,
      videoRatio:
        composer.videoRatio ??
        (composer.mode === "video" ? composer.ratio : undefined) ??
        defaults.videoRatio,
      videoResolution:
        composer.videoResolution ??
        (composer.mode === "video" ? composer.resolution : undefined) ??
        defaults.videoResolution,
      videoDuration:
        composer.videoDuration ?? composer.duration ?? defaults.videoDuration,
      referenceImage: undefined,
      referenceImages: Array.isArray(composer.referenceImages)
        ? composer.referenceImages
        : [],
    },
    composerModelOptions,
  );
}

function mergeComposerSettingsForRegeneration(
  baseSettings: AgentComposerSettings,
  overrideSettings: AgentComposerSettings | null,
  composerModelOptions: ReturnType<typeof resolveComposerModelOptions>,
) {
  if (!overrideSettings) {
    return baseSettings;
  }

  return normalizeComposerSettings(
    {
      ...baseSettings,
      ...overrideSettings,
      referenceImage: undefined,
      referenceImages: overrideSettings.referenceImages.length
        ? overrideSettings.referenceImages
        : baseSettings.referenceImages,
    },
    composerModelOptions,
  );
}

function getComposerSettingsFromMediaToolTurn(
  messages: AgentMessage[],
  userMessageId: string,
  composerModelOptions: ReturnType<typeof resolveComposerModelOptions>,
  runtimeSettings: RuntimeSettings,
) {
  const userIndex = messages.findIndex((message) => message.id === userMessageId);

  if (userIndex < 0) {
    return null;
  }

  const nextUserIndex = messages.findIndex(
    (message, index) => index > userIndex && message.role === "user",
  );
  const turnMessages = messages.slice(
    userIndex + 1,
    nextUserIndex >= 0 ? nextUserIndex : undefined,
  );
  const mediaToolCall = turnMessages
    .map((message) => message.toolCall)
    .findLast(
      (toolCall) =>
        toolCall?.name === "image_generation" ||
        toolCall?.name === "video_generation",
    );

  if (!mediaToolCall || !isRecord(mediaToolCall.args)) {
    return null;
  }

  const args = mediaToolCall.args;
  const referenceImages = Array.isArray(args.referenceImages)
    ? args.referenceImages.filter(isReferenceImage)
    : [];
  const defaultSettings = createDefaultComposerSettings(
    composerModelOptions,
    runtimeSettings,
  );
  const isVideo = mediaToolCall.name === "video_generation";
  const ratio =
    getStringValue(args, "ratio") ??
    (isVideo ? defaultSettings.videoRatio : defaultSettings.imageRatio);
  const resolution =
    getStringValue(args, "resolution") ??
    (isVideo
      ? defaultSettings.videoResolution
      : defaultSettings.imageResolution);
  const duration =
    getStringValue(args, "duration") ?? defaultSettings.videoDuration;

  return normalizeComposerSettings(
    {
      ...defaultSettings,
      mode: isVideo ? "video" : "image",
      imageModel: isVideo
        ? defaultSettings.imageModel
        : getStringValue(args, "model") ?? defaultSettings.imageModel,
      videoModel: isVideo
        ? getStringValue(args, "model") ?? defaultSettings.videoModel
        : defaultSettings.videoModel,
      ratio,
      resolution,
      imageRatio: isVideo ? defaultSettings.imageRatio : ratio,
      imageResolution: isVideo ? defaultSettings.imageResolution : resolution,
      imageCount: getNumberValue(args, "count") ?? defaultSettings.imageCount,
      imageQuality:
        getStringValue(args, "quality") ?? defaultSettings.imageQuality,
      videoRatio: isVideo ? ratio : defaultSettings.videoRatio,
      videoResolution: isVideo ? resolution : defaultSettings.videoResolution,
      videoDuration: duration,
      imageFormat: isVideo
        ? defaultSettings.imageFormat
        : getStringValue(args, "format") ?? "png",
      videoFormat: isVideo
        ? getStringValue(args, "format") ?? "mp4"
        : defaultSettings.videoFormat,
      style: getStringValue(args, "style") ?? "auto",
      duration,
      template: "none",
      templatePrompt: undefined,
      referenceImage: undefined,
      referenceImages,
    },
    composerModelOptions,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getStringValue(source: Record<string, unknown>, key: string) {
  const value = source[key];

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumberValue(source: Record<string, unknown>, key: string) {
  const value = source[key];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isReferenceImage(
  value: unknown,
): value is AgentComposerReferenceImage {
  return isRecord(value) && typeof value.url === "string" && value.url.trim().length > 0;
}

function findPreviousUserMessage(messages: AgentMessage[], messageId: string) {
  const targetIndex = messages.findIndex((message) => message.id === messageId);

  if (targetIndex < 0) {
    return null;
  }

  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index];
    }
  }

  return null;
}

function trimMessagesForRegeneration(
  messages: AgentMessage[],
  userMessageId: string,
) {
  const userIndex = messages.findIndex((message) => message.id === userMessageId);

  if (userIndex < 0) {
    return messages;
  }

  return messages.slice(0, userIndex);
}

function removeMessageGroup(messages: AgentMessage[], messageId: string) {
  const targetIndex = messages.findIndex((message) => message.id === messageId);

  if (targetIndex < 0) {
    return messages;
  }

  const targetMessage = messages[targetIndex];

  if (targetMessage?.role === "user") {
    const nextUserIndex = messages.findIndex(
      (message, index) => index > targetIndex && message.role === "user",
    );
    const endIndex = nextUserIndex >= 0 ? nextUserIndex : messages.length;

    return [...messages.slice(0, targetIndex), ...messages.slice(endIndex)];
  }

  let startIndex = targetIndex;
  while (startIndex > 0 && messages[startIndex - 1]?.role === "tool") {
    startIndex -= 1;
  }

  let endIndex = targetIndex + 1;
  while (endIndex < messages.length && messages[endIndex]?.role === "tool") {
    endIndex += 1;
  }

  return [...messages.slice(0, startIndex), ...messages.slice(endIndex)];
}
