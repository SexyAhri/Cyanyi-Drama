import { describe, expect, it } from "vitest";

import { getShellCopy } from "./chat-shell-i18n";
import {
  filterShellThreads,
  findShellThread,
  getShellThreadTitle,
} from "./chat-shell-utils";
import type { ShellThread } from "./chat-shell-types";

const threads: ShellThread[] = [
  {
    id: "thread_tools",
    title: "Tool approval flow",
    messages: [
      {
        id: "message_tools",
        role: "assistant",
        content: "Approval cards pause execution before a risky action.",
      },
    ],
  },
  { id: "thread_weather", title: "Weather lookup demo" },
  {
    id: "thread_docs",
    title: "Template docs cleanup",
    messages: [
      {
        id: "message_docs",
        role: "user",
        content: "Find the migration checklist.",
      },
    ],
  },
];

describe("chat shell utilities", () => {
  it("filters threads by title without mutating empty searches", () => {
    expect(filterShellThreads(threads, "")).toEqual(threads);
    expect(filterShellThreads(threads, "weather")).toEqual([threads[1]]);
    expect(filterShellThreads(threads, "migration checklist")).toEqual([
      threads[2],
    ]);
    expect(filterShellThreads(threads, "missing")).toEqual([]);
  });

  it("resolves active thread titles with a fallback", () => {
    expect(
      getShellThreadTitle({
        activeThreadId: "thread_docs",
        fallbackTitle: "New chat",
        threads,
      }),
    ).toBe("Template docs cleanup");

    expect(
      getShellThreadTitle({
        activeThreadId: null,
        fallbackTitle: "New chat",
        threads,
      }),
    ).toBe("New chat");
  });

  it("finds selected threads by id", () => {
    expect(findShellThread(threads, "thread_weather")).toEqual(threads[1]);
    expect(findShellThread(threads, "missing")).toBeNull();
    expect(findShellThread(threads, null)).toBeNull();
  });

  it("returns localized shell copy", () => {
    expect(getShellCopy("en").newChat).toBe("New chat");
    expect(getShellCopy("zh-CN").newChat).toBe("新建会话");
    expect(getShellCopy("zh-CN").switchModel).toBe("切换模型");
  });
});
