import { createElement, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { productionCopy } from "@/features/production-configuration/copy";

const handlers = vi.hoisted(() => ({
  changeOpen: null as null | ((open: boolean) => void),
  accept: null as null | (() => void),
}));

vi.mock("@/components/ui/alert-dialog", () => {
  const Container = ({ children, className }: PropsWithChildren<{ className?: string }>) => createElement("div", { className }, children);
  return {
    AlertDialog: ({ children, open, onOpenChange }: PropsWithChildren<{ open: boolean; onOpenChange: (open: boolean) => void }>) => {
      handlers.changeOpen = onOpenChange;
      return createElement("div", { role: "alertdialog", "data-open": open }, children);
    },
    AlertDialogContent: Container,
    AlertDialogDescription: Container,
    AlertDialogFooter: Container,
    AlertDialogHeader: Container,
    AlertDialogTitle: ({ children }: PropsWithChildren) => createElement("h2", null, children),
    AlertDialogCancel: ({ children }: PropsWithChildren) => createElement("button", { type: "button" }, children),
    AlertDialogAction: ({ children, variant, onClick }: PropsWithChildren<{ variant: string; onClick: () => void }>) => {
      handlers.accept = onClick;
      return createElement("button", { type: "button", "data-variant": variant }, children);
    },
  };
});

import { StudioConfirmationDialog } from "./use-studio-confirmation";

beforeEach(() => { handlers.changeOpen = null; handlers.accept = null; });

describe("StudioConfirmationDialog", () => {
  it.each(["zh-CN", "en"] as const)("renders themed discard confirmation with explicit %s actions", (locale) => {
    const copy = productionCopy[locale];
    const onResolve = vi.fn();
    const html = renderToStaticMarkup(createElement(StudioConfirmationDialog, {
      locale, onResolve,
      request: { title: copy.discardTitle, description: copy.discard, confirmLabel: copy.discardChanges, cancelLabel: copy.keepEditing, destructive: true },
    }));
    expect(html).toContain(copy.discardTitle);
    expect(html).toContain(copy.keepEditing);
    expect(html).toContain(copy.discardChanges);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('data-variant="destructive"');
    expect(html).toContain("bg-[var(--canvas)]");
    expect(html).toContain("overflow-y-auto");
    expect(onResolve).not.toHaveBeenCalled();
    handlers.changeOpen!(false);
    expect(onResolve).toHaveBeenCalledWith(false);
    handlers.accept!();
    expect(onResolve).toHaveBeenLastCalledWith(true);
  });

  it.each([
    ["zh-CN", "取消", "确认并继续"],
    ["en", "Cancel", "Confirm and continue"],
  ] as const)("preserves %s defaults for existing studio actions", (locale, cancel, confirm) => {
    const html = renderToStaticMarkup(createElement(StudioConfirmationDialog, {
      locale, onResolve: () => {}, request: { title: "Action", description: "Details" },
    }));
    expect(html).toContain(cancel);
    expect(html).toContain(confirm);
    expect(html).toContain('data-variant="default"');
  });
});
