"use client";

import { Clapperboard, Pencil } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import type { ShellCopy } from "./chat-shell-i18n";

type ChatTopbarProps = {
  copy: ShellCopy;
  currentThreadTitle: string;
  onNewChat: () => void;
  topbarActions?: React.ReactNode;
};

export function ChatTopbar({
  copy,
  currentThreadTitle,
  onNewChat,
  topbarActions,
}: ChatTopbarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-card/80 px-3 shadow-sm shadow-primary/5 backdrop-blur supports-backdrop-filter:bg-card/70">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger />
        <Button
          aria-label={copy.newChat}
          onClick={onNewChat}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Pencil />
        </Button>
        <span className="hidden max-w-44 truncate text-sm font-medium sm:block">
          {currentThreadTitle}
        </span>
        {topbarActions ? (
          <div className="flex min-w-0 items-center gap-2">{topbarActions}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Link
          aria-label={copy.dramaStudio}
          className={cn(
            buttonVariants({ size: "icon-sm", variant: "ghost" }),
            "md:hidden",
          )}
          href="/projects"
        >
          <Clapperboard className="size-4" />
        </Link>
        <ThemeToggle label={copy.switchTheme} />
      </div>
    </header>
  );
}
