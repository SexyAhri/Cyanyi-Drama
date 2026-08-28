"use client";

import { Settings } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { ShellCopy } from "./chat-shell-i18n";
import type {
  ChannelModelUpdate,
  ModelOption,
  RuntimeConnectionSettings,
} from "./chat-shell-types";
import { ChannelSettingsPanel } from "./channel-settings-panel";
import { PreferencesSettingsPanel } from "./preferences-settings-panel";
import { RuntimeSettingsPanel } from "./runtime-settings-panel";
import type { ShellSettings } from "./shell-settings";

type AgentSettingsDialogProps = {
  copy: ShellCopy;
  models: ModelOption[];
  onModelsChange?: (update: ChannelModelUpdate) => void;
  onOpenChange: (open: boolean) => void;
  onRuntimeConnectionClear: () => void;
  onRuntimeConnectionChange: (settings: RuntimeConnectionSettings) => void;
  onSettingsChange: (settings: ShellSettings) => void;
  onTestRuntimeConnection: () => void;
  open: boolean;
  runtimeConnection: RuntimeConnectionSettings;
  settings: ShellSettings;
};

export function AgentSettingsDialog({
  copy,
  models,
  onModelsChange,
  onOpenChange,
  onRuntimeConnectionClear,
  onRuntimeConnectionChange,
  onSettingsChange,
  onTestRuntimeConnection,
  open,
  runtimeConnection,
  settings,
}: AgentSettingsDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[92vh] overflow-x-hidden overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
              <Settings />
            </div>
            <DialogTitle>{copy.settings}</DialogTitle>
          </div>
          <DialogDescription>{copy.settingsDescription}</DialogDescription>
        </DialogHeader>

        <Tabs className="min-w-0 w-full" defaultValue="channels">
          <TabsList
            className="min-w-0 max-w-full justify-start gap-5 overflow-x-auto border-b px-0 pb-0"
            variant="line"
          >
            <TabsTrigger className="flex-none px-0 pb-3" value="channels">
              {copy.settingsChannels}
            </TabsTrigger>
            <TabsTrigger className="flex-none px-0 pb-3" value="preferences">
              {copy.settingsPreferences}
            </TabsTrigger>
            <TabsTrigger className="flex-none px-0 pb-3" value="runtime">
              {copy.settingsRuntime}
            </TabsTrigger>
            <TabsTrigger
              className="flex-none px-0 pb-3"
              value="prompt-sources"
            >
              {copy.settingsPromptSources}
            </TabsTrigger>
            <TabsTrigger className="flex-none px-0 pb-3" value="webdav">
              {copy.settingsWebdav}
            </TabsTrigger>
          </TabsList>

          <TabsContent className="mt-4 grid gap-3" value="channels">
            <ChannelSettingsPanel
              copy={copy}
              models={models}
              onFinish={() => onOpenChange(false)}
              onModelsChange={onModelsChange}
              onRefreshModels={onTestRuntimeConnection}
              onRuntimeConnectionChange={onRuntimeConnectionChange}
              onRuntimeConnectionClear={onRuntimeConnectionClear}
              runtimeConnection={runtimeConnection}
            />
          </TabsContent>

          <TabsContent className="mt-4 grid gap-3" value="preferences">
            <PreferencesSettingsPanel
              copy={copy}
              models={models}
              onChange={onSettingsChange}
              settings={settings}
            />
          </TabsContent>

          <TabsContent className="mt-4" value="runtime">
            <RuntimeSettingsPanel copy={copy} />
          </TabsContent>

          <TabsContent className="mt-4" value="prompt-sources">
            <SettingsPlaceholder
              description={copy.settingsPromptSourcesDescription}
              message={copy.settingsComingSoon}
            />
          </TabsContent>

          <TabsContent className="mt-4" value="webdav">
            <SettingsPlaceholder
              description={copy.settingsWebdavDescription}
              message={copy.settingsComingSoon}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SettingsPlaceholder({
  description,
  message,
}: {
  description: string;
  message: string;
}) {
  return (
    <div className="grid min-h-48 place-content-center gap-2 rounded-lg border border-dashed p-6 text-center">
      <p className="font-medium">{message}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
