"use client";

import { LoaderCircle, Pencil, Save } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  SuggestedInput,
  type SuggestedInputOption,
} from "@/components/ui/suggested-input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { getStudioCopy } from "../i18n";
import type { StudioLocale, StudioStoryboardPanel } from "../types";
import {
  parseActingDirections,
  parsePhotographyRules,
  serializeActingDirections,
  serializePhotographyRules,
} from "./previs-view-model";
import { getPanelEditorGuidance } from "./panel-editor-guidance";

export function PanelEditorDialog({
  locale,
  onSave,
  panel,
}: {
  locale: StudioLocale;
  onSave: (panel: StudioStoryboardPanel) => Promise<unknown> | void;
  panel: StudioStoryboardPanel;
}) {
  const copy = getStudioCopy(locale);
  const guidance = getPanelEditorGuidance(locale);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => toDraft(panel));
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(toDraft(panel));
  }, [open, panel]);

  async function save() {
    setIsSaving(true);
    try {
      await onSave({
        ...panel,
        description: nullable(draft.description),
        shotType: nullable(draft.shotType),
        cameraMove: nullable(draft.cameraMove),
        locationName: nullable(draft.locationName),
        characters: parseList(draft.characters),
        props: parseList(draft.props),
        imagePrompt: nullable(draft.imagePrompt),
        videoPrompt: nullable(draft.videoPrompt),
        durationSeconds: numberOrNull(draft.durationSeconds),
        subtitleText: nullable(draft.subtitleText),
        linkedToNextPanel: draft.linkedToNextPanel,
        photographyRules: serializePhotographyRules({
          camera: draft.cameraAngle,
          cameraPosition: draft.cameraPosition,
          focalLength: draft.focalLength,
          lighting: draft.lighting,
          composition: draft.composition,
          depthOfField: draft.depthOfField,
          colorTone: draft.colorTone,
        }),
        actingNotes: serializeActingDirections(
          panel.characters,
          draft.actingDirections,
        ),
      });
      setOpen(false);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Pencil className="size-4" />
        {copy.edit}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden rounded-lg sm:max-h-[min(92dvh,52rem)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {copy.editPanel} · {String(panel.panelIndex + 1).padStart(2, "0")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {copy.panelDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-1">
          <Accordion defaultValue={["basics"]} multiple>
            <AccordionItem value="basics">
              <AccordionTrigger className="py-2">
                <SectionTitle {...guidance.sections.basics} />
              </AccordionTrigger>
              <AccordionContent className="grid gap-3 px-1 sm:grid-cols-2">
                <Field className="sm:col-span-2" label={copy.panelDescription}>
                  <Textarea
                    className="h-20 resize-y overflow-y-auto field-sizing-fixed"
                    disabled={isSaving}
                    maxLength={4_000}
                    onChange={(event) =>
                      setDraft({ ...draft, description: event.target.value })
                    }
                    value={draft.description}
                  />
                </Field>
                <SuggestionField
                  disabled={isSaving}
                  label={copy.shotType}
                  onChange={(shotType) => setDraft({ ...draft, shotType })}
                  options={guidance.suggestions.shotType}
                  placeholder={guidance.placeholders.shotType}
                  suggestionsLabel={guidance.suggestionsLabel}
                  value={draft.shotType}
                />
                <SuggestionField
                  disabled={isSaving}
                  label={copy.cameraMove}
                  onChange={(cameraMove) => setDraft({ ...draft, cameraMove })}
                  options={guidance.suggestions.cameraMove}
                  placeholder={guidance.placeholders.cameraMove}
                  suggestionsLabel={guidance.suggestionsLabel}
                  value={draft.cameraMove}
                />
                <Field label={copy.location}>
                  <Input
                    disabled={isSaving}
                    maxLength={160}
                    onChange={(event) =>
                      setDraft({ ...draft, locationName: event.target.value })
                    }
                    placeholder={guidance.placeholders.location}
                    value={draft.locationName}
                  />
                </Field>
                <Field label={`${copy.duration} (${copy.seconds})`}>
                  <Input
                    disabled={isSaving}
                    inputMode="decimal"
                    min="0.1"
                    onChange={(event) =>
                      setDraft({ ...draft, durationSeconds: event.target.value })
                    }
                    placeholder={guidance.placeholders.duration}
                    step="0.1"
                    type="number"
                    value={draft.durationSeconds}
                  />
                </Field>
                <Field label={copy.cast}>
                  <Input
                    disabled={isSaving}
                    maxLength={1_000}
                    onChange={(event) =>
                      setDraft({ ...draft, characters: event.target.value })
                    }
                    placeholder={guidance.placeholders.cast}
                    value={draft.characters}
                  />
                </Field>
                <Field label={copy.propAssets}>
                  <Input
                    disabled={isSaving}
                    maxLength={1_000}
                    onChange={(event) =>
                      setDraft({ ...draft, props: event.target.value })
                    }
                    placeholder={guidance.placeholders.props}
                    value={draft.props}
                  />
                </Field>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="photography">
              <AccordionTrigger className="py-2">
                <SectionTitle {...guidance.sections.photography} />
              </AccordionTrigger>
              <AccordionContent className="grid gap-3 px-1 sm:grid-cols-2">
                {(
                  [
                    ["cameraAngle", copy.cameraAngle],
                    ["cameraPosition", copy.cameraPosition],
                    ["focalLength", copy.focalLength],
                    ["lighting", copy.lighting],
                    ["composition", copy.composition],
                    ["depthOfField", copy.depthOfField],
                    ["colorTone", copy.colorTone],
                  ] as const
                ).map(([key, label]) => (
                  <SuggestionField
                    className={key === "colorTone" ? "sm:col-span-2" : undefined}
                    disabled={isSaving}
                    key={key}
                    label={label}
                    onChange={(value) => setDraft({ ...draft, [key]: value })}
                    options={guidance.suggestions[key]}
                    placeholder={guidance.placeholders[key]}
                    suggestionsLabel={guidance.suggestionsLabel}
                    value={draft[key]}
                  />
                ))}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="performance">
              <AccordionTrigger className="py-2">
                <SectionTitle {...guidance.sections.performance} />
              </AccordionTrigger>
              <AccordionContent className="space-y-4 px-1">
                {panel.characters.map((character) => (
                  <div className="grid gap-3 sm:grid-cols-3" key={character}>
                    <p className="text-sm font-semibold sm:col-span-3">
                      {character}
                    </p>
                    {(["emotion", "action", "expression"] as const).map(
                      (key) => (
                        <SuggestionField
                          disabled={isSaving}
                          key={key}
                          label={copy[key]}
                          onChange={(value) =>
                            setDraft({
                              ...draft,
                              actingDirections: {
                                ...draft.actingDirections,
                                [character]: {
                                  ...draft.actingDirections[character],
                                  [key]: value,
                                },
                              },
                            })
                          }
                          options={guidance.suggestions[key]}
                          placeholder={guidance.placeholders[key]}
                          suggestionsLabel={guidance.suggestionsLabel}
                          value={draft.actingDirections[character]?.[key] ?? ""}
                        />
                      ),
                    )}
                  </div>
                ))}
                <Field label={copy.subtitle}>
                  <Textarea
                    className="h-20 resize-y overflow-y-auto field-sizing-fixed"
                    disabled={isSaving}
                    maxLength={2_000}
                    onChange={(event) =>
                      setDraft({ ...draft, subtitleText: event.target.value })
                    }
                    value={draft.subtitleText}
                  />
                </Field>
                <label className="flex items-center justify-between gap-4 border-y py-3 text-sm font-medium">
                  {copy.linkedShot}
                  <Switch
                    checked={draft.linkedToNextPanel}
                    disabled={isSaving}
                    onCheckedChange={(checked) =>
                      setDraft({ ...draft, linkedToNextPanel: checked })
                    }
                  />
                </label>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="prompts">
              <AccordionTrigger className="py-2">
                <SectionTitle {...guidance.sections.prompts} />
              </AccordionTrigger>
              <AccordionContent className="grid gap-3 px-1">
                <Field label={copy.imagePrompt}>
                  <Textarea
                    className="h-24 resize-y overflow-y-auto field-sizing-fixed"
                    disabled={isSaving}
                    maxLength={4_000}
                    onChange={(event) =>
                      setDraft({ ...draft, imagePrompt: event.target.value })
                    }
                    value={draft.imagePrompt}
                  />
                </Field>
                <Field label={copy.videoPrompt}>
                  <Textarea
                    className="h-24 resize-y overflow-y-auto field-sizing-fixed"
                    disabled={isSaving}
                    maxLength={4_000}
                    onChange={(event) =>
                      setDraft({ ...draft, videoPrompt: event.target.value })
                    }
                    value={draft.videoPrompt}
                  />
                </Field>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
        <DialogFooter className="rounded-b-lg p-3">
          <Button
            disabled={isSaving}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            {copy.cancel}
          </Button>
          <Button disabled={isSaving} onClick={() => void save()} type="button">
            {isSaving ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {isSaving ? copy.saving : copy.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label className={`grid gap-1.5 text-sm font-medium ${className ?? ""}`}>
      {label}
      {children}
    </label>
  );
}

function SectionTitle({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <span className="min-w-0">
      <span className="block font-semibold">{title}</span>
      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
        {description}
      </span>
    </span>
  );
}

function SuggestionField({
  className,
  disabled,
  label,
  onChange,
  options,
  placeholder,
  suggestionsLabel,
  value,
}: {
  className?: string;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  options: SuggestedInputOption[];
  placeholder: string;
  suggestionsLabel: string;
  value: string;
}) {
  return (
    <Field className={className} label={label}>
      <SuggestedInput
        ariaLabel={label}
        disabled={disabled}
        maxLength={500}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        suggestionsLabel={`${label} · ${suggestionsLabel}`}
        value={value}
      />
    </Field>
  );
}

function toDraft(panel: StudioStoryboardPanel) {
  const photography = parsePhotographyRules(panel.photographyRules);
  const acting = new Map(
    parseActingDirections(panel.actingNotes).map((item) => [item.name, item]),
  );
  return {
    description: panel.description ?? "",
    shotType: panel.shotType ?? "",
    cameraMove: panel.cameraMove ?? "",
    locationName: panel.locationName ?? "",
    characters: panel.characters.join(", "),
    props: panel.props.join(", "),
    imagePrompt: panel.imagePrompt ?? "",
    videoPrompt: panel.videoPrompt ?? "",
    durationSeconds: panel.durationSeconds?.toString() ?? "",
    subtitleText: panel.subtitleText ?? "",
    linkedToNextPanel: panel.linkedToNextPanel ?? false,
    cameraAngle: photography.camera,
    cameraPosition: photography.cameraPosition,
    focalLength: photography.focalLength,
    lighting: photography.lighting,
    composition: photography.composition,
    depthOfField: photography.depthOfField,
    colorTone: photography.colorTone,
    actingDirections: Object.fromEntries(
      panel.characters.map((name) => {
        const value = acting.get(name);
        return [
          name,
          {
            emotion: value?.emotion ?? "",
            action: value?.action ?? "",
            expression: value?.expression ?? "",
          },
        ];
      }),
    ),
  };
}

function nullable(value: string) {
  return value.trim() || null;
}

function numberOrNull(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseList(value: string) {
  return [...new Set(value.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean))];
}
