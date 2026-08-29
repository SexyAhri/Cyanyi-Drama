"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import {
  loadRuntimeSettings,
  saveRuntimeSettings,
} from "@/lib/settings/runtime-client";

import type { ShellCopy } from "./chat-shell-i18n";

export const RUNTIME_SETTINGS_FORM_ID = "agent-runtime-settings-form";

export type RuntimeSettingsPanelStatus = {
  loading: boolean;
  saving: boolean;
};

type RuntimeSettingsPanelProps = {
  copy: ShellCopy;
  formId: string;
  onStatusChange: (status: RuntimeSettingsPanelStatus) => void;
};

export function RuntimeSettingsPanel({
  copy,
  formId,
  onStatusChange,
}: RuntimeSettingsPanelProps) {
  const [settings, setSettings] = useState(DEFAULT_RUNTIME_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    onStatusChange({ loading, saving });
  }, [loading, onStatusChange, saving]);

  useEffect(() => {
    let active = true;
    void loadRuntimeSettings()
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
      const saved = await saveRuntimeSettings(settings);
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
    <form
      className="grid gap-7"
      id={formId}
      onReset={() => setSettings(DEFAULT_RUNTIME_SETTINGS)}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
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

      <SettingsSection
        description={copy.settingsImageGenerationDescription}
        title={copy.settingsImageGeneration}
      >
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            disabled={loading || saving}
            label={copy.settingsGenerationRatio}
            onChange={(value) => update("imageGenerationRatio", value as RuntimeSettings["imageGenerationRatio"])}
            options={RATIO_OPTIONS}
            value={settings.imageGenerationRatio}
          />
          <SelectField
            disabled={loading || saving}
            label={copy.settingsGenerationResolution}
            onChange={(value) => update("imageGenerationResolution", value as RuntimeSettings["imageGenerationResolution"])}
            options={IMAGE_RESOLUTION_OPTIONS}
            value={settings.imageGenerationResolution}
          />
          <NumberField
            disabled={loading || saving}
            hint={copy.settingsImageCountHint}
            label={copy.settingsImageCount}
            max={4}
            min={1}
            onChange={(value) => update("imageGenerationCount", value)}
            value={settings.imageGenerationCount}
          />
          <SelectField
            disabled={loading || saving}
            label={copy.settingsImageQuality}
            onChange={(value) => update("imageGenerationQuality", value as RuntimeSettings["imageGenerationQuality"])}
            options={[
              { label: copy.settingsImageQualityAuto, value: "auto" },
              { label: copy.settingsImageQualityHigh, value: "high" },
            ]}
            value={settings.imageGenerationQuality}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        description={copy.settingsVideoGenerationDescription}
        title={copy.settingsVideoGeneration}
      >
        <div className="grid items-start gap-4 sm:grid-cols-3">
          <SelectField
            disabled={loading || saving}
            label={copy.settingsGenerationRatio}
            onChange={(value) => update("videoGenerationRatio", value as RuntimeSettings["videoGenerationRatio"])}
            options={RATIO_OPTIONS}
            value={settings.videoGenerationRatio}
          />
          <SelectField
            disabled={loading || saving}
            label={copy.settingsGenerationResolution}
            onChange={(value) => update("videoGenerationResolution", value as RuntimeSettings["videoGenerationResolution"])}
            options={VIDEO_RESOLUTION_OPTIONS}
            value={settings.videoGenerationResolution}
          />
          <SelectField
            disabled={loading || saving}
            label={copy.settingsVideoDuration}
            onChange={(value) => update("videoGenerationDuration", value as RuntimeSettings["videoGenerationDuration"])}
            options={[
              { label: "5s", value: "5s" },
              { label: "10s", value: "10s" },
            ]}
            value={settings.videoGenerationDuration}
          />
        </div>
      </SettingsSection>

    </form>
  );
}

const RATIO_OPTIONS = [
  "1:1",
  "3:2",
  "2:3",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "21:9",
].map((value) => ({ label: value, value }));

const IMAGE_RESOLUTION_OPTIONS = ["1k", "2k", "4k"].map((value) => ({
  label: value.toUpperCase(),
  value,
}));

const VIDEO_RESOLUTION_OPTIONS = ["720p", "1080p", "2k", "4k"].map(
  (value) => ({
    label: value.endsWith("k") ? value.toUpperCase() : value,
    value,
  }),
);

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
