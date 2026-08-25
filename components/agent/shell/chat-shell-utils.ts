import type { ShellThread } from "./chat-shell-types";

export function filterShellThreads(
  threads: ShellThread[],
  searchQuery: string,
) {
  const query = searchQuery.trim().toLowerCase();

  if (!query) {
    return threads;
  }

  return threads.filter((thread) => {
    if (thread.title.toLowerCase().includes(query)) {
      return true;
    }

    return (thread.messages ?? []).some((message) =>
      message.content.toLowerCase().includes(query),
    );
  });
}

export function getShellThreadTitle({
  activeThreadId,
  fallbackTitle,
  threads,
}: {
  activeThreadId: string | null;
  fallbackTitle: string;
  threads: ShellThread[];
}) {
  return (
    threads.find((thread) => thread.id === activeThreadId)?.title ??
    fallbackTitle
  );
}

export function findShellThread(
  threads: ShellThread[],
  threadId: string | null,
) {
  if (!threadId) {
    return null;
  }

  return threads.find((thread) => thread.id === threadId) ?? null;
}
