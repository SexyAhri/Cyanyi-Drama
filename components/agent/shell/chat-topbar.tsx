"use client";

import { Pencil, Settings } from "lucide-react";

import { ProductNavigation } from "@/components/navigation/product-navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";

import type { ShellCopy } from "./chat-shell-i18n";
import type { AgentLocale } from "./chat-shell-types";

type ChatTopbarProps = {
  appVersion?: string;
  copy: ShellCopy;
  currentThreadTitle: string;
  isAdmin: boolean;
  locale: AgentLocale;
  onNewChat: () => void;
  onOpenSettings: () => void;
  topbarActions?: React.ReactNode;
};

export function ChatTopbar({
  appVersion,
  copy,
  currentThreadTitle,
  isAdmin,
  locale,
  onNewChat,
  onOpenSettings,
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
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {topbarActions ? (
          <div className="flex min-w-0 items-center gap-2">{topbarActions}</div>
        ) : null}
        <ProductNavigation isAdmin={isAdmin} locale={locale} />
        {appVersion ? (
          <Badge
            className="hidden h-6 rounded-md text-[11px] text-muted-foreground xl:inline-flex"
            title={`${copy.projectVersion}: ${appVersion}`}
            variant="outline"
          >
            <span className="hidden lg:inline">{copy.projectVersion}</span>
            <span className="font-mono">v{appVersion}</span>
          </Badge>
        ) : null}
        <Button
          aria-label={copy.openSettings}
          onClick={onOpenSettings}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Settings />
        </Button>
        <ThemeToggle label={copy.switchTheme} />
      </div>
    </header>
  );
}
