"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BellDot,
  Bot,
  Clapperboard,
  Languages,
  ListTree,
  LoaderCircle,
  RefreshCw,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import {
  AgentSettingsDialog,
  createDefaultShellSettings,
  getShellCopy,
  type ShellSettings,
} from "@/components/agent/shell";
import { AuthAccountMenu } from "@/components/auth/account-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import { useRuntimeConnection } from "@/hooks/use-runtime-connection";
import type { ProjectConfig } from "@/lib/projects/types";
import type { AuthUser } from "@/lib/server/auth";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { getStudioCopy } from "../i18n";
import { updateStudioProjectConfig } from "../api";
import type { StudioLocale } from "../types";

export function WorkspaceTopbar({
  episodeName,
  isRefreshing,
  locale,
  onLocaleChange,
  onOpenActivity,
  onOpenEpisodes,
  onProjectConfigChange,
  onRefresh,
  projectConfig,
  projectId,
  projectName,
  user,
}: {
  episodeName?: string;
  isRefreshing: boolean;
  locale: StudioLocale;
  onLocaleChange: () => void;
  onOpenActivity: () => void;
  onOpenEpisodes: () => void;
  onProjectConfigChange: () => Promise<unknown> | void;
  onRefresh: () => void;
  projectConfig: ProjectConfig;
  projectId: string;
  projectName: string;
  user: AuthUser;
}) {
  const copy = getStudioCopy(locale);
  const shellCopy = getShellCopy(locale);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const runtime = useRuntimeConnection([]);
  const [settings, setSettings] = useState<ShellSettings>(() =>
    createDefaultShellSettings(""),
  );

  useEffect(() => {
    const selectedModel = (modelId: string | null) =>
      runtime.models.find(
        (model) => model.modelId === modelId || model.id === modelId,
      )?.id ?? "";
    setSettings((current) => ({
      ...current,
      analysisModel: selectedModel(projectConfig.analysisModel),
      characterModel: selectedModel(projectConfig.characterModel),
      locationModel: selectedModel(projectConfig.locationModel),
      storyboardModel: selectedModel(projectConfig.storyboardModel),
      editModel: selectedModel(projectConfig.editModel),
      videoModel: selectedModel(projectConfig.videoModel),
      audioModel: selectedModel(projectConfig.audioModel),
      videoRatio: projectConfig.videoRatio,
      artStyle: projectConfig.artStyle,
      visualEra: projectConfig.visualEra,
      visualEraCustom: projectConfig.visualEraCustom ?? "",
      ttsRate: projectConfig.ttsRate,
    }));
  }, [projectConfig, runtime.models]);

  function handleSettingsChange(next: ShellSettings) {
    const previous = settings;
    const modelId = (value: string) =>
      runtime.models.find((model) => model.id === value)?.modelId ?? value;
    const patch: Parameters<typeof updateStudioProjectConfig>[1] = {};
    if (next.analysisModel !== previous.analysisModel)
      patch.analysisModel = modelId(next.analysisModel) || null;
    if (next.characterModel !== previous.characterModel)
      patch.characterModel = modelId(next.characterModel) || null;
    if (next.locationModel !== previous.locationModel)
      patch.locationModel = modelId(next.locationModel) || null;
    if (next.storyboardModel !== previous.storyboardModel)
      patch.storyboardModel = modelId(next.storyboardModel) || null;
    if (next.editModel !== previous.editModel)
      patch.editModel = modelId(next.editModel) || null;
    if (next.videoModel !== previous.videoModel)
      patch.videoModel = modelId(next.videoModel) || null;
    if (next.audioModel !== previous.audioModel)
      patch.audioModel = modelId(next.audioModel) || null;
    if (next.videoRatio !== previous.videoRatio)
      patch.videoRatio = next.videoRatio;
    if (next.artStyle !== previous.artStyle) patch.artStyle = next.artStyle;
    if (next.visualEra !== previous.visualEra)
      patch.visualEra = next.visualEra;
    if (next.visualEraCustom !== previous.visualEraCustom)
      patch.visualEraCustom = next.visualEraCustom.trim() || null;
    if (next.ttsRate !== previous.ttsRate) patch.ttsRate = next.ttsRate;
    setSettings(next);
    if (!Object.keys(patch).length) return;
    void updateStudioProjectConfig(projectId, patch)
      .then(async () => {
        toast.success(copy.projectSettingsSaved);
        await onProjectConfigChange();
      })
      .catch((error) => {
        setSettings(previous);
        toast.error(error instanceof Error ? error.message : copy.actionFailed);
      });
  }

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
        <AuthAccountMenu compact locale={locale} user={user} />
      </div>
      </header>

      <AgentSettingsDialog
        copy={shellCopy}
        models={runtime.models}
        onModelsChange={runtime.addChannelModels}
        onOpenChange={setSettingsOpen}
        onRuntimeConnectionChange={runtime.setConnection}
        onRuntimeConnectionClear={runtime.clearConnection}
        onSettingsChange={handleSettingsChange}
        onTestRuntimeConnection={runtime.fetchModels}
        open={settingsOpen}
        runtimeConnection={runtime.connection}
        settings={settings}
        showProjectVisualWorld
      />
    </>
  );
}
