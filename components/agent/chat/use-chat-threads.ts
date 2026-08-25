"use client";

import { useCallback, useEffect, useState } from "react";

import type { AgentMessage } from "@/lib/agent/types";
import {
  loadPersistedChatState,
  savePersistedChatState,
} from "@/lib/persistence/chat-state-db";

import type { ShellThread } from "../shell";

type UseChatThreadsOptions = {
  initialThreads: ShellThread[];
  newThreadTitle: string;
};

export function useChatThreads({
  initialThreads,
  newThreadTitle,
}: UseChatThreadsOptions) {
  const [threads, setThreads] = useState<ShellThread[]>(() =>
    sortThreads(initialThreads),
  );
  const [activeThreadId, setActiveThreadIdState] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function restoreThreads() {
      try {
        const persistedState = await loadPersistedChatState();

        if (cancelled || !persistedState) {
          return;
        }

        setThreads(sortThreads(persistedState.threads));
        setActiveThreadIdState(
          persistedState.threads.some(
            (thread) => thread.id === persistedState.activeThreadId,
          )
            ? persistedState.activeThreadId
            : null,
        );
      } catch (error) {
        console.error("Failed to restore persisted chat threads.", error);
      } finally {
        if (!cancelled) {
          setIsHydrated(true);
        }
      }
    }

    void restoreThreads();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void savePersistedChatState({
      activeThreadId,
      threads: threads.map((thread) => ({
        archived: thread.archived,
        id: thread.id,
        messages: thread.messages ?? [],
        pinned: thread.pinned,
        title: thread.title,
        updatedAt: thread.updatedAt,
      })),
    }).catch((error) => {
      console.error("Failed to persist chat threads.", error);
    });
  }, [activeThreadId, isHydrated, threads]);

  const setActiveThreadId = useCallback((threadId: string | null) => {
    setActiveThreadIdState(threadId);
  }, []);

  const createThread = useCallback(
    (messages: AgentMessage[] = []) => {
      const thread: ShellThread = {
        archived: false,
        id: crypto.randomUUID(),
        messages,
        pinned: false,
        title: getThreadTitle(messages, newThreadTitle),
        updatedAt: new Date().toISOString(),
      };

      setThreads((current) => insertThreadByPinnedState(thread, current));
      setActiveThreadIdState(thread.id);

      return thread;
    },
    [newThreadTitle],
  );

  const updateActiveThread = useCallback(
    (messages: AgentMessage[]) => {
      if (messages.length === 0) {
        return;
      }

      if (!activeThreadId) {
        const thread: ShellThread = {
          archived: false,
          id: crypto.randomUUID(),
          messages,
          pinned: false,
          title: getThreadTitle(messages, newThreadTitle),
          updatedAt: new Date().toISOString(),
        };

        setThreads((current) => insertThreadByPinnedState(thread, current));
        setActiveThreadIdState(thread.id);
        return;
      }

      setThreads((current) =>
        current.map((thread) =>
          thread.id === activeThreadId
            ? {
                ...thread,
                messages,
                title: getThreadTitle(messages, newThreadTitle),
                updatedAt: new Date().toISOString(),
              }
            : thread,
        ),
      );
    },
    [activeThreadId, newThreadTitle],
  );

  const deleteThread = useCallback(
    (threadId: string) => {
      const threadIndex = threads.findIndex((thread) => thread.id === threadId);

      if (threadIndex < 0) {
        return {
          deletedActiveThread: false,
          nextThread: null,
        };
      }

      const deletedThread = threads[threadIndex];
      const nextThreads = threads.filter((thread) => thread.id !== threadId);
      const deletedActiveThread = activeThreadId === threadId;
      const nextThread =
        nextThreads.find((thread) => !thread.archived) ??
        nextThreads[threadIndex] ??
        nextThreads[threadIndex - 1] ??
        null;

      setThreads(nextThreads);

      if (deletedActiveThread) {
        setActiveThreadIdState(nextThread?.id ?? null);
      }

      return {
        deletedActiveThread,
        deletedThread,
        insertIndex: threadIndex,
        nextThread,
      };
    },
    [activeThreadId, threads],
  );

  const reorderThread = useCallback(
    (draggedThreadId: string, targetThreadId: string) => {
      if (draggedThreadId === targetThreadId) {
        return;
      }

      setThreads((current) => {
        const draggedThread = current.find(
          (thread) => thread.id === draggedThreadId,
        );
        const targetThread = current.find(
          (thread) => thread.id === targetThreadId,
        );

        if (!draggedThread || !targetThread) {
          return current;
        }

        const withoutDraggedThread = current.filter(
          (thread) => thread.id !== draggedThreadId,
        );
        const targetIndex = withoutDraggedThread.findIndex(
          (thread) => thread.id === targetThreadId,
        );

        if (targetIndex < 0) {
          return current;
        }

        return [
          ...withoutDraggedThread.slice(0, targetIndex),
          {
            ...draggedThread,
            pinned: targetThread.pinned,
          },
          ...withoutDraggedThread.slice(targetIndex),
        ];
      });
    },
    [],
  );

  const toggleThreadPinned = useCallback((threadId: string) => {
    setThreads((current) => {
      const thread = current.find((item) => item.id === threadId);

      if (!thread) {
        return current;
      }

      const nextThread = {
        ...thread,
        archived: false,
        pinned: !thread.pinned,
      };
      const remainingThreads = current.filter((item) => item.id !== threadId);

      return insertThreadByPinnedState(nextThread, remainingThreads);
    });
  }, []);

  const archiveThread = useCallback(
    (threadId: string) => {
      const threadIndex = threads.findIndex((thread) => thread.id === threadId);

      if (threadIndex < 0) {
        return {
          archivedActiveThread: false,
          nextThread: null,
        };
      }

      const archivedActiveThread = activeThreadId === threadId;
      const nextThread =
        threads.find((thread) => thread.id !== threadId && !thread.archived) ??
        null;

      setThreads((current) =>
        current.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                archived: true,
                pinned: false,
              }
            : thread,
        ),
      );

      if (archivedActiveThread) {
        setActiveThreadIdState(nextThread?.id ?? null);
      }

      return {
        archivedActiveThread,
        nextThread,
      };
    },
    [activeThreadId, threads],
  );

  const renameThread = useCallback((threadId: string, title: string) => {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      return;
    }

    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              title:
                trimmedTitle.length > 42
                  ? `${trimmedTitle.slice(0, 39)}...`
                  : trimmedTitle,
            }
          : thread,
      ),
    );
  }, []);

  const restoreThread = useCallback(
    ({
      activate = false,
      insertIndex,
      thread,
    }: {
      activate?: boolean;
      insertIndex: number;
      thread: ShellThread;
    }) => {
      setThreads((current) => {
        if (current.some((item) => item.id === thread.id)) {
          return current;
        }

        const boundedIndex = Math.min(Math.max(insertIndex, 0), current.length);

        return [
          ...current.slice(0, boundedIndex),
          thread,
          ...current.slice(boundedIndex),
        ];
      });

      if (activate) {
        setActiveThreadIdState(thread.id);
      }
    },
    [],
  );

  const unarchiveThread = useCallback((threadId: string) => {
    setThreads((current) => {
      const thread = current.find((item) => item.id === threadId);

      if (!thread) {
        return current;
      }

      const nextThread = {
        ...thread,
        archived: false,
      };
      const remainingThreads = current.filter((item) => item.id !== threadId);

      return insertThreadByPinnedState(nextThread, remainingThreads);
    });
  }, []);

  return {
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
  };
}

function getThreadTitle(messages: AgentMessage[], fallbackTitle: string) {
  const firstTextMessage = messages.find((message) => message.content.trim());
  const title = firstTextMessage?.content.trim() ?? fallbackTitle;

  return title.length > 42 ? `${title.slice(0, 39)}...` : title;
}

function insertThreadByPinnedState(
  thread: ShellThread,
  currentThreads: ShellThread[],
) {
  if (thread.pinned) {
    return [thread, ...currentThreads];
  }

  const firstUnpinnedIndex = currentThreads.findIndex(
    (currentThread) => !currentThread.pinned && !currentThread.archived,
  );

  if (firstUnpinnedIndex < 0) {
    return [...currentThreads, thread];
  }

  return [
    ...currentThreads.slice(0, firstUnpinnedIndex),
    thread,
    ...currentThreads.slice(firstUnpinnedIndex),
  ];
}

function sortThreads(threads: ShellThread[]) {
  return [...threads].sort((left, right) => {
    if (left.archived && !right.archived) {
      return 1;
    }

    if (!left.archived && right.archived) {
      return -1;
    }

    if (left.pinned && !right.pinned) {
      return -1;
    }

    if (!left.pinned && right.pinned) {
      return 1;
    }

    return 0;
  });
}
