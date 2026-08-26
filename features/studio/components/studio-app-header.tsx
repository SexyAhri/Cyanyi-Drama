"use client";

import { Bot, Clapperboard, Languages } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { getStudioCopy } from "../i18n";
import type { StudioLocale } from "../types";

export function StudioAppHeader({
  locale,
  onLocaleChange,
}: {
  locale: StudioLocale;
  onLocaleChange: () => void;
}) {
  const copy = getStudioCopy(locale);

  return (
    <header className="flex h-14 shrink-0 items-center border-b bg-background/95 px-4 backdrop-blur-sm sm:px-6">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-5">
        <Link
          className="flex min-w-0 items-center gap-2 text-sm font-semibold"
          href="/projects"
        >
          <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-background">
            <Clapperboard className="size-4" />
          </span>
          <span className="hidden sm:inline">{copy.appName}</span>
        </Link>

        <nav aria-label={copy.primaryNavigation} className="flex items-center gap-1">
          <Link
            className={buttonVariants({ variant: "secondary" })}
            href="/projects"
          >
            {copy.projects}
          </Link>
          <Link
            className={buttonVariants({ variant: "ghost" })}
            href="/chat"
          >
            <Bot className="size-4" />
            <span className="hidden sm:inline">{copy.agent}</span>
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle label={copy.theme} />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={copy.language}
                  onClick={onLocaleChange}
                  size="icon"
                  type="button"
                  variant="ghost"
                />
              }
            >
              <Languages className="size-4" />
            </TooltipTrigger>
            <TooltipContent>{copy.language}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}
