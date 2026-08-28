"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_RUNTIME_SETTINGS,
  type RuntimeSettings,
} from "@/lib/settings/runtime-contract";

import type { ShellCopy } from "./chat-shell-i18n";

export function RuntimeSettingsPanel({ copy }: { copy: ShellCopy }) {
  const [settings, setSettings] = useState(DEFAULT_RUNTIME_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void loadSettings()
      .then((next) => {
        if (active) setSettings(next);
      })
      .catch((error) => {
        if (active)
          toast.error(
            error instanceof Error ? error.message : copy.settingsRuntimeLoadError,
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [copy.settingsRuntimeLoadError]);

  function update<K extends keyof RuntimeSettings>(
    field: K,
    value: RuntimeSettings[K],
  ) {
    setSettings((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await saveSettings(settings);
      setSettings(saved);
      toast.success(copy.settingsRuntimeSaveSuccess);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : copy.settingsRuntimeSaveError,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-7">
      <SettingsSection
        description={copy.settingsRuntimeRequestsDescription}
        title={copy.settingsRuntimeRequests}
      >
        <div className="grid items-start gap-4 sm:grid-cols-3">
          <NumberField
            disabled={loading || saving}
            hint={copy.settingsStructuredTimeoutHint}
            label={copy.settingsStructuredTimeout}
            max={3_600}
            min={10}
            onChange={(value) => update("structuredRequestTimeoutSeconds", value)}
            value={settings.structuredRequestTimeoutSeconds}
          />
          <SelectField
            disabled={loading || saving}
            label={copy.settingsStructuredStreaming}
            onChange={(value) =>
              update("structuredOutputStreaming", value === "stream")
            }
            options={[
              { label: copy.settingsStreamingEnabled, value: "stream" },
              { label: copy.settingsStreamingDisabled, value: "non-stream" },
            ]}
            value={settings.structuredOutputStreaming ? "stream" : "non-stream"}
          />
          <NumberField
            disabled={loading || saving}
            hint={copy.settingsTransportAttemptsHint}
            label={copy.settingsTransportAttempts}
            max={10}
            min={1}
            onChange={(value) => update("structuredTransportMaxAttempts", value)}
            value={settings.structuredTransportMaxAttempts}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        description={copy.settingsWorkflowExecutionDescription}
        title={copy.settingsWorkflowExecution}
      >
        <div className="grid items-start gap-4 sm:grid-cols-3">
          <NumberField
            disabled={loading || saving}
            hint={copy.settingsWorkflowAttemptsHint}
            label={copy.settingsWorkflowAttempts}
            max={10}
            min={1}
            onChange={(value) => update("workflowStepMaxAttempts", value)}
            value={settings.workflowStepMaxAttempts}
          />
          <NumberField
            disabled={loading || saving}
            hint={copy.settingsWorkflowConcurrencyHint}
            label={copy.settingsWorkflowConcurrency}
            max={8}
            min={1}
            onChange={(value) => update("workflowConcurrency", value)}
            value={settings.workflowConcurrency}
          />
          <NumberField
            disabled={loading || saving}
            hint={copy.settingsClipMaxCharsHint}
            label={copy.settingsClipMaxChars}
            max={4_000}
            min={400}
            step={100}
            onChange={(value) => update("screenplayClipMaxChars", value)}
            value={settings.screenplayClipMaxChars}
          />
        </div>
      </SettingsSection>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
        <Button
          disabled={loading || saving}
          onClick={() => setSettings(DEFAULT_RUNTIME_SETTINGS)}
          type="button"
          variant="outline"
        >
          <RotateCcw />
          {copy.settingsRuntimeReset}
        </Button>
        <Button disabled={loading || saving} onClick={save} type="button">
          <Save />
          {saving ? copy.settingsRuntimeSaving : copy.settingsSave}
        </Button>
      </div>
    </div>
  );
}

function SettingsSection({
  children,
  description,
  title,
}: React.PropsWithChildren<{ description: string; title: string }>) {
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function NumberField({
  disabled,
  hint,
  label,
  max,
  min,
  onChange,
  step = 1,
  value,
}: {
  disabled: boolean;
  hint: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        className="h-9"
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isInteger(next)) onChange(next);
        }}
        step={step}
        type="number"
        value={value}
      />
      <p className="text-xs leading-5 text-muted-foreground">{hint}</p>
    </div>
  );
}

function SelectField({
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Select
        disabled={disabled}
        onValueChange={(next) => next && onChange(next)}
        value={value}
      >
        <SelectTrigger className="h-9 w-full text-sm data-[size=default]:h-9">
          <SelectValue>
            {options.find((option) => option.value === value)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

async function loadSettings() {
  const response = await fetch("/api/settings/runtime", { cache: "no-store" });
  const payload = (await response.json()) as {
    message?: string;
    settings?: RuntimeSettings;
  };
  if (!response.ok || !payload.settings)
    throw new Error(payload.message || "运行设置加载失败");
  return payload.settings;
}

async function saveSettings(settings: RuntimeSettings) {
  const response = await fetch("/api/settings/runtime", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  const payload = (await response.json()) as {
    message?: string;
    settings?: RuntimeSettings;
  };
  if (!response.ok || !payload.settings)
    throw new Error(payload.message || "运行设置保存失败");
  return payload.settings;
}
