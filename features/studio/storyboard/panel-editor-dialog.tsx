"use client";

import { LoaderCircle, Pencil, Save } from "lucide-react";
import { useEffect, useState } from "react";

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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { getStudioCopy } from "../i18n";
import type { StudioLocale, StudioStoryboardPanel } from "../types";

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
      <DialogContent className="max-h-[min(90dvh,52rem)] overflow-hidden rounded-lg sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {copy.editPanel} · {String(panel.panelIndex + 1).padStart(2, "0")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {copy.panelDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 overflow-y-auto px-1 py-0.5 sm:grid-cols-2">
          <Field className="sm:col-span-2" label={copy.panelDescription}>
            <Textarea
              className="h-28 resize-y overflow-y-auto field-sizing-fixed"
              disabled={isSaving}
              maxLength={4_000}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
              value={draft.description}
            />
          </Field>
          <Field label={copy.shotType}>
            <Input
              disabled={isSaving}
              maxLength={160}
              onChange={(event) =>
                setDraft({ ...draft, shotType: event.target.value })
              }
              value={draft.shotType}
            />
          </Field>
          <Field label={copy.cameraMove}>
            <Input
              disabled={isSaving}
              maxLength={500}
              onChange={(event) =>
                setDraft({ ...draft, cameraMove: event.target.value })
              }
              value={draft.cameraMove}
            />
          </Field>
          <Field label={copy.location}>
            <Input
              disabled={isSaving}
              maxLength={160}
              onChange={(event) =>
                setDraft({ ...draft, locationName: event.target.value })
              }
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
              value={draft.props}
            />
          </Field>
          <Field className="sm:col-span-2" label={copy.imagePrompt}>
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
          <Field className="sm:col-span-2" label={copy.videoPrompt}>
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
          <Field className="sm:col-span-2" label={copy.subtitle}>
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
          <label className="flex items-center justify-between gap-4 border-y py-3 text-sm font-medium sm:col-span-2">
            {copy.linkedShot}
            <Switch
              checked={draft.linkedToNextPanel}
              disabled={isSaving}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, linkedToNextPanel: checked })
              }
            />
          </label>
        </div>
        <DialogFooter className="rounded-b-lg">
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

function toDraft(panel: StudioStoryboardPanel) {
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
