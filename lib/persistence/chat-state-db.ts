"use client";

import type { ShellThread } from "@/components/agent/shell";

const DATABASE_NAME = "agent-ui";
const DATABASE_VERSION = 1;
const STORE_NAME = "app-state";
const CHAT_STATE_KEY = "chat-state";

type PersistedThread = Pick<
  ShellThread,
  "archived" | "id" | "messages" | "pinned" | "title" | "updatedAt"
>;

export type PersistedChatState = {
  activeThreadId: string | null;
  threads: PersistedThread[];
};

export async function loadPersistedChatState() {
  const database = await openDatabase();

  return new Promise<PersistedChatState | null>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(CHAT_STATE_KEY);

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to load chat state."));
    };

    request.onsuccess = () => {
      const value = request.result;

      if (!isPersistedChatState(value)) {
        resolve(null);
        return;
      }

      resolve({
        activeThreadId: value.activeThreadId,
        threads: value.threads.map((thread) => ({
          id: thread.id,
          archived: thread.archived,
          messages: thread.messages ?? [],
          pinned: thread.pinned,
          title: thread.title,
          updatedAt: thread.updatedAt,
        })),
      });
    };
  });
}

export async function savePersistedChatState(state: PersistedChatState) {
  const database = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Failed to save chat state."));
    };

    store.put(
      {
        activeThreadId: state.activeThreadId,
        threads: state.threads.map((thread) => ({
          id: thread.id,
          archived: thread.archived,
          messages: thread.messages ?? [],
          pinned: thread.pinned,
          title: thread.title,
          updatedAt: thread.updatedAt,
        })),
      } satisfies PersistedChatState,
      CHAT_STATE_KEY,
    );
  });
}

export async function clearPersistedChatState() {
  const database = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("Failed to clear chat state."));
    };

    store.delete(CHAT_STATE_KEY);
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Failed to open chat database."));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function isPersistedChatState(value: unknown): value is PersistedChatState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PersistedChatState>;

  if (
    candidate.activeThreadId !== null &&
    typeof candidate.activeThreadId !== "string"
  ) {
    return false;
  }

  if (!Array.isArray(candidate.threads)) {
    return false;
  }

  return candidate.threads.every(isPersistedThread);
}

function isPersistedThread(value: unknown): value is PersistedThread {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PersistedThread>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    (candidate.archived === undefined ||
      typeof candidate.archived === "boolean") &&
    (candidate.messages === undefined || Array.isArray(candidate.messages)) &&
    (candidate.pinned === undefined || typeof candidate.pinned === "boolean") &&
    (candidate.updatedAt === undefined ||
      typeof candidate.updatedAt === "string")
  );
}
