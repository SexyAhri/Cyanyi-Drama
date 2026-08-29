"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Save, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { ShellCopy } from "./chat-shell-i18n";
import type {
  ChannelModelUpdate,
  ModelOption,
  RuntimeConnectionSettings,
  ShellUser,
} from "./chat-shell-types";
import {
  ACCOUNT_SETTINGS_FORM_ID,
  AccountSettingsPanel,
  type AccountSettingsPanelStatus,
} from "./account-settings-panel";
import {
  ADMIN_SETTINGS_FORM_ID,
  AdminSettingsPanel,
  type AdminSettingsPanelStatus,
} from "./admin-settings-panel";
import { ChannelSettingsPanel } from "./channel-settings-panel";
import { PreferencesSettingsPanel } from "./preferences-settings-panel";
import {
  RUNTIME_SETTINGS_FORM_ID,
  RuntimeSettingsPanel,
  type RuntimeSettingsPanelStatus,
} from "./runtime-settings-panel";
import type { ShellSettings } from "./shell-settings";

type SettingsTab = "preferences" | "runtime" | "account" | "channels" | "admin";

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
  user?: ShellUser | null;
  showProjectVisualWorld?: boolean;
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
  user,
  showProjectVisualWorld = false,
}: AgentSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("preferences");
  const [runtimeStatus, setRuntimeStatus] =
    useState<RuntimeSettingsPanelStatus>({ loading: true, saving: false });
  const [accountStatus, setAccountStatus] =
    useState<AccountSettingsPanelStatus>({ loading: true, submitting: false });
  const [adminStatus, setAdminStatus] = useState<AdminSettingsPanelStatus>({
    loading: true,
    saving: false,
  });
  const isAdmin = user?.role === "ADMIN";
  const runtimeBusy = runtimeStatus.loading || runtimeStatus.saving;
  const adminBusy = adminStatus.loading || adminStatus.saving;

  useEffect(() => {
    if (!isAdmin && (activeTab === "channels" || activeTab === "admin")) {
      setActiveTab("preferences");
    }
  }, [activeTab, isAdmin]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[92vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4">
              <Settings />
            </div>
            <DialogTitle>{copy.settings}</DialogTitle>
          </div>
          <DialogDescription>{copy.settingsDescription}</DialogDescription>
        </DialogHeader>

        <Tabs
          className="flex min-h-0 w-full min-w-0 flex-col"
          onValueChange={(value) => setActiveTab(value as SettingsTab)}
          value={activeTab}
        >
          <TabsList
            className="min-w-0 max-w-full shrink-0 justify-start gap-5 overflow-x-auto border-b px-0 pb-0"
            variant="line"
          >
            <TabsTrigger className="flex-none px-0 pb-3" value="preferences">
              {copy.settingsPreferences}
            </TabsTrigger>
            <TabsTrigger className="flex-none px-0 pb-3" value="runtime">
              {copy.settingsRuntime}
            </TabsTrigger>
            <TabsTrigger className="flex-none px-0 pb-3" value="account">
              {copy.settingsAccount}
            </TabsTrigger>
            {isAdmin ? (
              <>
                <TabsTrigger className="flex-none px-0 pb-3" value="channels">
                  {copy.settingsChannels}
                </TabsTrigger>
                <TabsTrigger className="flex-none px-0 pb-3" value="admin">
                  {copy.settingsAdmin}
                </TabsTrigger>
              </>
            ) : null}
          </TabsList>

          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-4">
            <TabsContent className="mt-0 grid gap-3" value="preferences">
              <PreferencesSettingsPanel
                copy={copy}
                models={models}
                onChange={onSettingsChange}
                settings={settings}
                showProjectVisualWorld={showProjectVisualWorld}
              />
            </TabsContent>

            <TabsContent className="mt-0" value="runtime">
              <RuntimeSettingsPanel
                copy={copy}
                formId={RUNTIME_SETTINGS_FORM_ID}
                onStatusChange={setRuntimeStatus}
              />
            </TabsContent>

            <TabsContent className="mt-0" value="account">
              <AccountSettingsPanel
                formId={ACCOUNT_SETTINGS_FORM_ID}
                onStatusChange={setAccountStatus}
                user={user}
              />
            </TabsContent>

            {isAdmin ? (
              <>
                <TabsContent className="mt-0 grid gap-3" value="channels">
                  <ChannelSettingsPanel
                    copy={copy}
                    models={models}
                    onModelsChange={onModelsChange}
                    onRefreshModels={onTestRuntimeConnection}
                    onRuntimeConnectionChange={onRuntimeConnectionChange}
                    onRuntimeConnectionClear={onRuntimeConnectionClear}
                    runtimeConnection={runtimeConnection}
                  />
                </TabsContent>

                <TabsContent className="mt-0" value="admin">
                  <AdminSettingsPanel
                    formId={ADMIN_SETTINGS_FORM_ID}
                    onStatusChange={setAdminStatus}
                  />
                </TabsContent>
              </>
            ) : null}
          </div>
        </Tabs>

        <DialogFooter>
          {activeTab === "runtime" ? (
            <>
              <Button
                disabled={runtimeBusy}
                form={RUNTIME_SETTINGS_FORM_ID}
                type="reset"
                variant="outline"
              >
                <RotateCcw />
                {copy.settingsRuntimeReset}
              </Button>
              <Button
                disabled={runtimeBusy}
                form={RUNTIME_SETTINGS_FORM_ID}
                type="submit"
              >
                <Save />
                {runtimeStatus.saving
                  ? copy.settingsRuntimeSaving
                  : copy.settingsSave}
              </Button>
            </>
          ) : activeTab === "admin" && isAdmin ? (
            <Button
              disabled={adminBusy}
              form={ADMIN_SETTINGS_FORM_ID}
              type="submit"
            >
              <Save />
              {adminStatus.saving
                ? copy.settingsRuntimeSaving
                : copy.settingsSave}
            </Button>
          ) : activeTab === "account" && accountStatus.submitting ? (
            <Button disabled type="button">
              {copy.settingsAccountRedirecting}
            </Button>
          ) : (
            <Button onClick={() => onOpenChange(false)} type="button">
              {copy.settingsFinish}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
