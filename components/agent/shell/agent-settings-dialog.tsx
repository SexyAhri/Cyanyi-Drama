"use client";

import { useEffect, useState } from "react";
import {
  ProductionConfigurationPanel,
  type ProductionPanelStatus,
} from "@/features/production-configuration/panel";
import { productionCopy } from "@/features/production-configuration/copy";
import { confirmConfigurationDiscard } from "@/features/production-configuration/confirmation";
import { useStudioConfirmation } from "@/features/studio/components/use-studio-confirmation";
import type { ConfigurationScope } from "@/lib/production-configuration/contract";
import {
  AudioLines,
  Activity,
  Bot,
  Network,
  RotateCcw,
  Save,
  Settings,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";

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
import { PreferencesSettingsPanel } from "./preferences-settings-panel";
import {
  RUNTIME_SETTINGS_FORM_ID,
  RuntimeSettingsPanel,
  type RuntimeSettingsPanelStatus,
} from "./runtime-settings-panel";
import type { ShellSettings } from "./shell-settings";
import { UsageRecordsPanel } from "@/components/usage/usage-records-panel";

export type SettingsTab =
  | "preferences"
  | "runtime"
  | "account"
  | "usage"
  | "agents"
  | "sound";

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
  productionScope?: ConfigurationScope;
  initialTab?: SettingsTab;
  onActiveTabChange?: (tab: SettingsTab) => void;
};

export function AgentSettingsDialog({
  copy,
  models,
  onOpenChange,
  onSettingsChange,
  open,
  settings,
  user,
  showProjectVisualWorld = false,
  productionScope,
  initialTab = "preferences",
  onActiveTabChange,
}: AgentSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [runtimeStatus, setRuntimeStatus] =
    useState<RuntimeSettingsPanelStatus>({ loading: true, saving: false });
  const [accountStatus, setAccountStatus] =
    useState<AccountSettingsPanelStatus>({ loading: true, submitting: false });
  const runtimeBusy = runtimeStatus.loading || runtimeStatus.saving;
  const [productionStatus, setProductionStatus] =
    useState<ProductionPanelStatus>({ dirty: false, busy: false });
  const configurationCopy = productionCopy[copy.locale];
  const { confirm, confirmationDialog } = useStudioConfirmation(copy.locale);
  const configurationActive = activeTab === "agents" || activeTab === "sound";
  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [initialTab, open]);
  async function canLeaveConfiguration() {
    if (!configurationActive) return true;
    return confirmConfigurationDiscard(productionStatus, confirm, configurationCopy);
  }
  async function changeOpen(next: boolean) {
    if (!next && !(await canLeaveConfiguration())) return;
    if (!next) setProductionStatus({ dirty: false, busy: false });
    onOpenChange(next);
  }

  return (
    <Dialog onOpenChange={(next) => void changeOpen(next)} open={open}>
      <DialogContent className="h-[min(54rem,calc(100dvh-2rem))] w-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:w-[calc(100%-3rem)] sm:max-w-[90rem]">
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
          orientation="vertical"
          className="grid min-h-0 w-full min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-3 sm:grid-cols-[10.5rem_minmax(0,1fr)] sm:gap-5"
          onValueChange={async (value) => {
            if (value === activeTab || !(await canLeaveConfiguration())) return;
            setProductionStatus({ dirty: false, busy: false });
            setActiveTab(value as SettingsTab);
            onActiveTabChange?.(value as SettingsTab);
          }}
          value={activeTab}
        >
          <TabsList
            className="h-full min-h-0 w-full items-stretch justify-start gap-1 self-stretch overflow-y-auto rounded-xl border bg-muted/20 p-1.5 data-[orientation=vertical]:h-full sm:p-2"
            aria-label={copy.settings}
          >
            {(
              [
                {
                  value: "preferences",
                  label: copy.settingsPreferences,
                  Icon: SlidersHorizontal,
                },
                {
                  value: "runtime",
                  label: copy.settingsRuntime,
                  Icon: Network,
                },
                {
                  value: "account",
                  label: copy.settingsAccount,
                  Icon: UserRound,
                },
                {
                  value: "usage",
                  label: copy.settingsUsage,
                  Icon: Activity,
                },
                {
                  value: "agents",
                  label: configurationCopy.agentManagementMenu,
                  Icon: Bot,
                },
                {
                  value: "sound",
                  label: configurationCopy.mode,
                  Icon: AudioLines,
                },
              ] as const
            ).map(({ value, label, Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                aria-label={label}
                title={label}
                className="h-auto min-h-11 flex-none gap-2.5 px-2 py-2.5 text-left whitespace-normal data-active:bg-primary/10 data-active:text-primary data-[orientation=vertical]:justify-center sm:data-[orientation=vertical]:justify-start dark:data-active:bg-primary/10"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="hidden sm:block">{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div
            className={`min-h-0 min-w-0 overflow-x-hidden ${activeTab === "agents" || activeTab === "usage" ? "overflow-y-hidden" : "overflow-y-auto"}`}
          >
            <TabsContent className="mt-0 h-full min-h-0" value="agents">
              <ProductionConfigurationPanel
                key="agents"
                section="agents"
                locale={copy.locale}
                models={models}
                scope={productionScope}
                onStatusChange={setProductionStatus}
              />
            </TabsContent>
            <TabsContent className="mt-0" value="sound">
              <ProductionConfigurationPanel
                key="sound"
                section="sound"
                locale={copy.locale}
                models={models}
                scope={productionScope}
                onStatusChange={setProductionStatus}
              />
            </TabsContent>
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
            <TabsContent className="mt-0 flex h-full min-h-0 flex-col overflow-hidden" value="usage">
              <UsageRecordsPanel locale={copy.locale} />
            </TabsContent>
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
          ) : activeTab === "account" && accountStatus.submitting ? (
            <Button disabled type="button">
              {copy.settingsAccountRedirecting}
            </Button>
          ) : (
            <Button
              onClick={() => void changeOpen(false)}
              disabled={configurationActive && productionStatus.busy}
              type="button"
            >
              {copy.settingsFinish}
            </Button>
          )}
        </DialogFooter>
        {confirmationDialog}
      </DialogContent>
    </Dialog>
  );
}
