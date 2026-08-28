"use client";

import { useState } from "react";
import {
  ArrowLeft,
  BellDot,
  Bot,
  Clapperboard,
  Languages,
  LayoutDashboard,
  ListTree,
  LoaderCircle,
  RefreshCw,
  Settings,
} from "lucide-react";
import Link from "next/link";

import {
  AgentSettingsDialog,
  createDefaultShellSettings,
  getShellCopy,
  type ShellSettings,
} from "@/components/agent/shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { useRuntimeConnection } from "@/hooks/use-runtime-connection";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { getStudioCopy } from "../i18n";
import type { StudioLocale } from "../types";

export function WorkspaceTopbar({
  episodeName,
  isRefreshing,
  locale,
  onLocaleChange,
  onOpenActivity,
  onOpenEpisodes,
  onOpenProduction,
  onRefresh,
  projectName,
}: {
  episodeName?: string;
  isRefreshing: boolean;
  locale: StudioLocale;
  onLocaleChange: () => void;
  onOpenActivity: () => void;
  onOpenEpisodes: () => void;
  onOpenProduction: () => void;
  onRefresh: () => void;
  projectName: string;
}) {
  const copy = getStudioCopy(locale);
  const shellCopy = getShellCopy(locale);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const runtime = useRuntimeConnection([]);
  const [settings, setSettings] = useState<ShellSettings>(() =>
    createDefaultShellSettings(""),
  );

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-2 sm:px-3">
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              aria-label={copy.backToProjects}
              className={buttonVariants({ size: "icon", variant: "ghost" })}
              href="/projects"
            />
          }
        >
          <ArrowLeft className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{copy.backToProjects}</TooltipContent>
      </Tooltip>

      <span className="hidden size-7 items-center justify-center rounded-md bg-foreground text-background sm:flex">
        <Clapperboard className="size-4" />
      </span>

      <Button
        aria-label={copy.openEpisodes}
        className="lg:hidden"
        onClick={onOpenEpisodes}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ListTree className="size-4" />
      </Button>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate font-semibold">{projectName}</span>
          {episodeName ? (
            <>
              <span className="text-border">/</span>
              <span className="hidden truncate text-muted-foreground sm:inline">
                {episodeName}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={copy.settings}
                onClick={() => setSettingsOpen(true)}
                size="icon"
                type="button"
                variant="ghost"
              />
            }
          >
            <Settings className="size-4" />
          </TooltipTrigger>
          <TooltipContent>{copy.settings}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                aria-label={copy.backToChat}
                className={buttonVariants({ size: "icon", variant: "ghost" })}
                href="/chat"
              />
            }
          >
            <Bot className="size-4" />
          </TooltipTrigger>
          <TooltipContent>{copy.backToChat}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={copy.productionControl}
                onClick={onOpenProduction}
                size="icon"
                type="button"
                variant="ghost"
              />
            }
          >
            <LayoutDashboard className="size-4" />
          </TooltipTrigger>
          <TooltipContent>{copy.productionControl}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={copy.refresh}
                disabled={isRefreshing}
                onClick={onRefresh}
                size="icon"
                type="button"
                variant="ghost"
              />
            }
          >
            {isRefreshing ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </TooltipTrigger>
          <TooltipContent>{copy.refresh}</TooltipContent>
        </Tooltip>
        <Button
          aria-label={copy.openActivity}
          className="xl:hidden"
          onClick={onOpenActivity}
          size="icon"
          type="button"
          variant="ghost"
        >
          <BellDot className="size-4" />
        </Button>
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
      </header>

      <AgentSettingsDialog
        copy={shellCopy}
        models={runtime.models}
        onModelsChange={runtime.addChannelModels}
        onOpenChange={setSettingsOpen}
        onRuntimeConnectionChange={runtime.setConnection}
        onRuntimeConnectionClear={runtime.clearConnection}
        onSettingsChange={setSettings}
        onTestRuntimeConnection={runtime.fetchModels}
        open={settingsOpen}
        runtimeConnection={runtime.connection}
        settings={settings}
      />
    </>
  );
}
