"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BellDot,
  Languages,
  ListTree,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Settings,
  SunMoon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import {
  AgentSettingsDialog,
  createDefaultShellSettings,
  getShellCopy,
  type ShellSettings,
} from "@/components/agent/shell";
import { AuthAccountMenu } from "@/components/auth/account-menu";
import { ProductNavigation } from "@/components/navigation/product-navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  episodeId,
  panelId,
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
  episodeId?: string;
  panelId?: string;
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
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSettingsTab = parseSettingsTab(searchParams.get("settings"));
  const runtime = useRuntimeConnection([]);
  const [settings, setSettings] = useState<ShellSettings>(() =>
    createDefaultShellSettings(""),
  );

  useEffect(() => {
    setSettingsOpen(Boolean(requestedSettingsTab));
  }, [requestedSettingsTab]);

  function updateSettingsQuery(open: boolean, tab = "preferences") {
    setSettingsOpen(open);
    const params = new URLSearchParams(searchParams.toString());
    if (open) params.set("settings", tab);
    else params.delete("settings");
    router.replace(`${pathname}?${params}`, { scroll: false });
  }

  function changeSettingsOpen(open: boolean) {
    updateSettingsQuery(open, requestedSettingsTab ?? "preferences");
  }

  function changeSettingsTab(tab: "preferences" | "runtime" | "account" | "agents" | "sound") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("settings", tab);
    router.replace(`${pathname}?${params}`, { scroll: false });
  }

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
      episodeTargetDurationSeconds:
        projectConfig.episodeTargetDurationSeconds,
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
    if (
      next.episodeTargetDurationSeconds !==
      previous.episodeTargetDurationSeconds
    )
      patch.episodeTargetDurationSeconds =
        next.episodeTargetDurationSeconds;
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
          <div className="hidden md:block">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={copy.settings}
                    onClick={() => changeSettingsOpen(true)}
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
          </div>
          <div className="hidden md:block">
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
          </div>
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
          <div
            aria-hidden="true"
            className="mx-1 hidden h-5 w-px bg-border sm:block"
          />
          <ProductNavigation
            compact
            isAdmin={user.role === "ADMIN"}
            locale={locale}
          />
          <div className="hidden md:block">
            <ThemeToggle label={copy.theme} />
          </div>
          <div className="hidden md:block">
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
          <MobileWorkspaceActions
            isRefreshing={isRefreshing}
            locale={locale}
            onLocaleChange={onLocaleChange}
            onOpenSettings={() => changeSettingsOpen(true)}
            onRefresh={onRefresh}
          />
          <AuthAccountMenu compact locale={locale} user={user} />
        </div>
      </header>

      <AgentSettingsDialog
        copy={shellCopy}
        models={runtime.models}
        onModelsChange={runtime.addChannelModels}
        onOpenChange={changeSettingsOpen}
        onRuntimeConnectionChange={runtime.setConnection}
        onRuntimeConnectionClear={runtime.clearConnection}
        onSettingsChange={handleSettingsChange}
        onTestRuntimeConnection={runtime.fetchModels}
        open={settingsOpen}
        runtimeConnection={runtime.connection}
        settings={settings}
        showProjectVisualWorld
        productionScope={{ projectId, episodeId, panelId }}
        initialTab={requestedSettingsTab ?? "preferences"}
        onActiveTabChange={changeSettingsTab}
      />
    </>
  );
}

function parseSettingsTab(value: string | null): "preferences" | "runtime" | "account" | "agents" | "sound" | null {
  if (value === "production") return "agents";
  return value === "preferences" || value === "runtime" || value === "account" || value === "agents" || value === "sound"
    ? value
    : null;
}

function MobileWorkspaceActions({
  isRefreshing,
  locale,
  onLocaleChange,
  onOpenSettings,
  onRefresh,
}: {
  isRefreshing: boolean;
  locale: StudioLocale;
  onLocaleChange: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
}) {
  const copy = getStudioCopy(locale);
  const { resolvedTheme, setTheme } = useTheme();
  const moreActions = locale === "zh-CN" ? "更多操作" : "More actions";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={moreActions}
            className="md:hidden"
            size="icon-sm"
            title={moreActions}
            type="button"
            variant="ghost"
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onOpenSettings}>
          <Settings />
          {copy.settings}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isRefreshing} onClick={onRefresh}>
          {isRefreshing ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <RefreshCw />
          )}
          {copy.refresh}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            setTheme(resolvedTheme === "dark" ? "light" : "dark")
          }
        >
          <SunMoon />
          {copy.theme}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onLocaleChange}>
          <Languages />
          {copy.language}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
