import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PropsWithChildren, ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/popover", async () => {
  const React = await import("react");
  const Root = ({ children }: PropsWithChildren) => createElement("div", null, children);
  const Container = ({ children, className }: PropsWithChildren<{ className?: string }>) => createElement("div", { className }, children);
  const Trigger = ({ children, render }: PropsWithChildren<{ render: ReactElement }>) => React.cloneElement(render, undefined, children);

  return {
    Popover: Root,
    PopoverContent: Container,
    PopoverTitle: ({ children }: PropsWithChildren) => createElement("h2", null, children),
    PopoverTrigger: Trigger,
  };
});

import { ExecutionNotificationItem, ExecutionNotificationMenu } from "./execution-notification-menu";

afterEach(() => vi.restoreAllMocks());

describe("ExecutionNotificationMenu", () => {
  it.each([
    ["zh-CN", "执行通知", "通知设置"],
    ["en", "Execution notifications", "Preferences"],
  ] as const)("renders the %s inbox as a bounded, opaque panel with separate settings", (locale, title, preferences) => {
    const html = renderToStaticMarkup(
      createElement(ExecutionNotificationMenu, { locale }),
    );

    expect(html).toContain(title);
    expect(html).toContain(preferences);
    expect(html).toContain("max-h-96 overflow-y-auto overscroll-contain");
    expect(html).toContain("w-[min(26rem,calc(100vw-1.5rem))]");
    expect(html).toContain("bg-[var(--canvas)]");
    expect(html).toContain("--available-height");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    expect(html).not.toContain('role="menuitem"');
    expect(html).toContain('role="status"');
  });
});

const item = {
  id: "notification-1",
  kind: "completed" as const,
  titleZh: "工作流已完成",
  titleEn: "Workflow completed",
  bodyZh: "工作流 original-episode-generation 已完成。",
  bodyEn: "Workflow original-episode-generation completed.",
  href: "/projects/project-1?run=run-1",
  readAt: null,
  createdAt: "2026-10-14T02:00:00.000Z",
};

describe("ExecutionNotificationItem", () => {
  it.each([
    ["zh-CN", "原创后续集续写", "1 小时前", "未读"],
    ["en", "Original episode continuation", "1h ago", "Unread"],
  ] as const)("keeps %s notification text compact and localizes existing workflow names", (locale, workflow, time, unread) => {
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-10-14T03:00:00.000Z").getTime());
    const html = renderToStaticMarkup(createElement(ExecutionNotificationItem, { item, locale, onRead: () => {} }));
    expect(html).toContain(workflow);
    expect(html).not.toContain("original-episode-generation");
    expect(html).toContain(time);
    expect(html).toContain(unread);
    expect(html).toContain("px-2.5 py-2");
    expect(html).toContain("flex size-6 shrink-0");
    expect(html).toContain("block truncate text-[11px]");
    expect(html).toContain('href="/projects/project-1?run=run-1"');
    expect(html).toContain("focus-visible:ring-2");
    expect(html).not.toContain("mt-1.5 block");
    expect(html).not.toContain("<button");
  });

  it.each([
    ["completed", "text-status-success"],
    ["partial_failure", "text-destructive"],
    ["action_required", "text-status-warning"],
  ] as const)("distinguishes %s without fading read notification text", (kind, color) => {
    const html = renderToStaticMarkup(createElement(ExecutionNotificationItem, { item: { ...item, kind, readAt: item.createdAt }, locale: "zh-CN", onRead: () => {} }));
    expect(html).toContain(color);
    expect(html).not.toContain("未读");
    expect(html).not.toContain("opacity-75");
  });

  it("bounds long titles and descriptions without truncating the accessible link text", () => {
    const longItem = { ...item, titleZh: "已完成".repeat(30), bodyZh: "这是较长的执行结果描述".repeat(30) };
    const html = renderToStaticMarkup(createElement(ExecutionNotificationItem, { item: longItem, locale: "zh-CN", onRead: () => {} }));
    expect(html).toContain(longItem.titleZh);
    expect(html).toContain(longItem.bodyZh);
    expect(html).toContain("min-w-0 flex-1 truncate");
    expect(html).toContain("shrink-0 whitespace-nowrap");
  });
});
