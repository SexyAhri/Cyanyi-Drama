"use client";

import { useEffect, useMemo, useState } from "react";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { ShellCopy } from "./chat-shell-i18n";
import type { ShellSettings } from "./shell-settings";
import type { ModelOption } from "./chat-shell-types";
import {
  PROJECT_ART_STYLES,
  type ProjectArtStyleId,
} from "@/lib/projects/art-style";

type PreferencesSettingsPanelProps = {
  copy: ShellCopy;
  models: ModelOption[];
  onChange: (settings: ShellSettings) => void;
  settings: ShellSettings;
  showProjectVisualWorld?: boolean;
};

type ModelType = "llm" | "image" | "video" | "audio" | "lipsync";
type SelectOption = { label: string; value: string };

const modelFields: Array<{
  field: keyof Pick<
    ShellSettings,
    | "analysisModel"
    | "characterModel"
    | "locationModel"
    | "storyboardModel"
    | "editModel"
    | "videoModel"
    | "audioModel"
    | "lipSyncModel"
  >;
  label: keyof ShellCopy;
  type: ModelType;
}> = [
  { field: "analysisModel", label: "settingsAnalysisModel", type: "llm" },
  { field: "videoModel", label: "settingsVideoModel", type: "video" },
  { field: "characterModel", label: "settingsCharacterModel", type: "image" },
  { field: "locationModel", label: "settingsLocationModel", type: "image" },
  { field: "storyboardModel", label: "settingsStoryboardModel", type: "image" },
  { field: "editModel", label: "settingsEditModel", type: "image" },
  { field: "audioModel", label: "settingsAudioModel", type: "audio" },
  { field: "lipSyncModel", label: "settingsLipSyncModel", type: "lipsync" },
];

const ratioOptions: SelectOption[] = [
  "16:9",
  "9:16",
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "5:4",
  "4:5",
  "21:9",
].map((value) => ({ label: value, value }));

const artStyleLabels: Record<ProjectArtStyleId, keyof ShellCopy> = {
  "chinese-comic": "settingsArtStyleChineseComic",
  "chinese-ink": "settingsArtStyleChineseInk",
  "american-comic": "settingsArtStyleAmericanComic",
  "japanese-anime": "settingsArtStyleJapaneseAnime",
  "stylized-3d": "settingsArtStyleStylized3d",
  realistic: "settingsArtStyleRealistic",
};

const artStyleOptions = PROJECT_ART_STYLES.map(({ id }) => ({
  label: artStyleLabels[id],
  value: id,
}));

const ttsRateOptions: Array<{ label: keyof ShellCopy; value: string }> = [
  { label: "settingsTtsRateNormal", value: "+0%" },
  { label: "settingsTtsRateSlightlyFast", value: "+20%" },
  { label: "settingsTtsRateFast", value: "+50%" },
  { label: "settingsTtsRateVeryFast", value: "+100%" },
];

export function PreferencesSettingsPanel({
  copy,
  models,
  onChange,
  settings,
  showProjectVisualWorld = false,
}: PreferencesSettingsPanelProps) {
  const [visualEraCustomDraft, setVisualEraCustomDraft] = useState(
    settings.visualEraCustom,
  );

  useEffect(() => {
    setVisualEraCustomDraft(settings.visualEraCustom);
  }, [settings.visualEraCustom]);

  function update(patch: Partial<ShellSettings>) {
    onChange({ ...settings, ...patch });
  }

  return (
    <div className="grid gap-6">
      <SettingsSection
        description={copy.settingsWorkflowModelsDescription}
        title={copy.settingsWorkflowModels}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {modelFields.map(({ field, label, type }) => (
            <ModelField
              key={field}
              label={copy[label] as string}
              models={getModelsForType(models, type)}
              onChange={(value) => update({ [field]: value })}
              value={settings[field]}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        description={copy.settingsCreativeDefaultsDescription}
        title={copy.settingsCreativeDefaults}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SelectField
            label={copy.settingsVideoRatio}
            onChange={(value) => update({ videoRatio: value })}
            options={ratioOptions}
            value={settings.videoRatio}
          />
          <SelectField
            label={copy.settingsArtStyle}
            onChange={(value) => update({ artStyle: value })}
            options={artStyleOptions.map(({ label, value }) => ({
              label: copy[label] as string,
              value,
            }))}
            value={settings.artStyle}
          />
          {showProjectVisualWorld ? (
            <SelectField
              label={copy.settingsVisualEra}
              onChange={(value) =>
                update({
                  visualEra: value as ShellSettings["visualEra"],
                })
              }
              options={[
                { label: copy.settingsVisualEraSource, value: "source" },
                {
                  label: copy.settingsVisualEraPremodern,
                  value: "premodern",
                },
                {
                  label: copy.settingsVisualEraContemporary,
                  value: "contemporary",
                },
                { label: copy.settingsVisualEraCustom, value: "custom" },
              ]}
              value={settings.visualEra}
            />
          ) : null}
          <SelectField
            label={copy.settingsTtsRate}
            onChange={(value) => update({ ttsRate: value })}
            options={ttsRateOptions.map(({ label, value }) => ({
              label: copy[label] as string,
              value,
            }))}
            value={settings.ttsRate}
          />
          {showProjectVisualWorld ? (
            <div className="grid min-w-0 gap-1.5">
              <Label className="truncate text-xs" htmlFor="episode-target-duration">
                {copy.settingsEpisodeTargetDuration}
              </Label>
              <Input
                aria-describedby="episode-target-duration-hint"
                className="h-9"
                id="episode-target-duration"
                max={90}
                min={60}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isInteger(value) && value >= 60 && value <= 90)
                    update({ episodeTargetDurationSeconds: value });
                }}
                step={5}
                type="number"
                value={settings.episodeTargetDurationSeconds}
              />
              <p
                className="text-xs leading-5 text-muted-foreground"
                id="episode-target-duration-hint"
              >
                {copy.settingsEpisodeTargetDurationHint}
              </p>
            </div>
          ) : null}
        </div>
        {showProjectVisualWorld && settings.visualEra === "custom" ? (
          <div className="grid gap-1.5">
            <Label className="text-xs" htmlFor="project-visual-era-custom">
              {copy.settingsVisualEraCustomPrompt}
            </Label>
            <Textarea
              id="project-visual-era-custom"
              maxLength={2_000}
              onChange={(event) =>
                setVisualEraCustomDraft(event.target.value)
              }
              onBlur={() => {
                if (visualEraCustomDraft !== settings.visualEraCustom)
                  update({ visualEraCustom: visualEraCustomDraft });
              }}
              placeholder={copy.settingsVisualEraCustomPlaceholder}
              value={visualEraCustomDraft}
            />
          </div>
        ) : null}
      </SettingsSection>
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
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function ModelField({
  label,
  models,
  onChange,
  value,
}: {
  label: string;
  models: ModelOption[];
  onChange: (value: string) => void;
  value: string;
}) {
  const options = useMemo(() => {
    return models;
  }, [models]);
  const selectedModel = options.find((model) => model.id === value);
  const selectedValue = selectedModel ? selectedModel.id : "";

  return (
    <div className="grid min-w-0 gap-1.5">
      <Label className="truncate text-xs" title={label}>
        {label}
      </Label>
      <Select onValueChange={(next) => next && onChange(next)} value={selectedValue}>
        <SelectTrigger className="h-9 w-full text-sm">
          <SelectValue>
            {selectedModel ? getModelDisplayName(selectedModel) : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.length > 0 ? (
            options.map((model) => (
              <SelectItem key={model.id || "empty-model"} value={model.id}>
                {getModelDisplayName(model)}
              </SelectItem>
            ))
          ) : (
            <SelectItem disabled value="__no-models__">
              No models
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

function getModelDisplayName(model: ModelOption) {
  const modelId = model.modelId?.trim();
  if (modelId) {
    const separator = modelId.lastIndexOf("::");
    return separator >= 0 ? modelId.slice(separator + 2) : modelId;
  }

  const name = model.name.trim();
  const channelSeparator = name.indexOf(" · ");
  const withoutChannelName =
    channelSeparator >= 0 ? name.slice(0, channelSeparator) : name;
  const idSeparator = withoutChannelName.lastIndexOf("::");

  return idSeparator >= 0
    ? withoutChannelName.slice(idSeparator + 2)
    : withoutChannelName;
}

function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  value: string;
}) {
  const selectedOption = options.find((option) => option.value === value);
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label className="truncate text-xs" title={label}>
        {label}
      </Label>
      <Select onValueChange={(next) => next && onChange(next)} value={value}>
        <SelectTrigger className="h-9 w-full text-sm">
          <SelectValue>{selectedOption?.label}</SelectValue>
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

function getModelsForType(models: ModelOption[], type: ModelType) {
  return models.filter((model) => inferModelType(model) === type);
}

function inferModelType(model: ModelOption): ModelType {
  const declaredModalities = model.capabilities?.modalities ?? [];
  const mediaType = declaredModalities.find((modality) => modality !== "text");
  if (mediaType === "image" || mediaType === "video" || mediaType === "audio" || mediaType === "lipsync") {
    return mediaType;
  }

  const id = `${model.id} ${model.modelId ?? ""} ${model.name}`.toLowerCase();
  if (/(lipsync|lip[-_ ]?sync|retalk)/.test(id)) return "lipsync";
  if (/(tts|text[-_ ]?to[-_ ]?speech|speech|voice|audio|index)/.test(id)) return "audio";
  if (/(video|seedance|veo|kling|runway|luma|hailuo|pixverse|wan|sora)/.test(id)) return "video";
  if (/(image|gpt-image|nano[-_ ]?banana|seedream|flux|imagen|banana|dall[-_ ]?e|stable[-_ ]?diffusion|recraft|ideogram)/.test(id)) return "image";
  if (model.type === "image" || model.type === "video" || model.type === "audio" || model.type === "lipsync") {
    return model.type;
  }
  return "llm";
}
