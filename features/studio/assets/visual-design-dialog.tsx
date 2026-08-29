"use client";

import { LoaderCircle, LockKeyhole, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AssetVisualProfileSpec } from "@/lib/assets/visual-profile";
import { getProjectArtStyleLabel } from "@/lib/projects/art-style";

import {
  generateStudioAssetVisualProfile,
  saveStudioAssetVisualProfile,
} from "../api";
import { ModelSelect } from "../components/model-select";
import { getStudioCopy } from "../i18n";
import type { StudioLocale, StudioModelOption } from "../types";
import type { StudioAssetEntity } from "./asset-view-model";

export function VisualDesignDialog({
  artStyle,
  entity,
  locale,
  models,
  onCompleted,
  projectId,
  trigger,
}: {
  artStyle: string;
  entity: StudioAssetEntity;
  locale: StudioLocale;
  models: StudioModelOption[];
  onCompleted: () => Promise<unknown> | void;
  projectId: string;
  trigger: React.ReactElement;
}) {
  const copy = getStudioCopy(locale);
  const artStyleLabel = getProjectArtStyleLabel(artStyle, locale);
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  const [spec, setSpec] = useState<AssetVisualProfileSpec>(() => emptySpec());
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [section, setSection] = useState<
    "appearance" | "rules" | "inference"
  >("appearance");

  useEffect(() => {
    if (!models.some((model) => model.id === modelId))
      setModelId(models[0]?.id ?? "");
  }, [modelId, models]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setSpec(entity.visualProfile?.spec ?? emptySpec());
      setSection("appearance");
    }
    setOpen(nextOpen);
  }

  async function generate() {
    const model = models.find((item) => item.id === modelId);
    if (!model) return;
    setIsGenerating(true);
    try {
      const result = await generateStudioAssetVisualProfile(projectId, {
        targetType: entity.kind,
        targetId: entity.id,
        channelId: model.channelId,
        model: model.modelId,
        locale: locale === "en" ? "en" : "zh",
      });
      setSpec(result.profile.spec);
      toast.success(copy.visualDesignGenerated);
      await onCompleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsGenerating(false);
    }
  }

  async function save() {
    if (!isComplete(spec)) return;
    setIsSaving(true);
    try {
      await saveStudioAssetVisualProfile(projectId, {
        targetType: entity.kind,
        targetId: entity.id,
        spec: normalizeSpec(spec),
      });
      toast.success(copy.visualDesignSaved);
      setOpen(false);
      await onCompleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSaving(false);
    }
  }

  const busy = isGenerating || isSaving;
  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger render={trigger} />
      <DialogContent className="h-[calc(100dvh-1rem)] max-h-[54rem] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-lg p-0 sm:h-[min(92dvh,54rem)] sm:max-w-4xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>
            {copy.visualDesign} · {entity.name}
          </DialogTitle>
          <DialogDescription className="line-clamp-2">
            {entity.description ?? copy.noStoryFacts}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="flex items-start gap-3 border-b pb-4">
            <LockKeyhole className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {copy.projectArtStyle} · {artStyleLabel}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {copy.projectArtStyleLocked}
              </p>
            </div>
          </div>
          <div className="grid gap-3 border-b py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid gap-1.5 text-sm font-medium">
              {copy.analysisModel}
              <ModelSelect
                disabled={busy}
                models={models}
                onChange={setModelId}
                placeholder={copy.analysisModel}
                value={modelId}
              />
            </label>
            <Button
              disabled={busy || !modelId}
              onClick={() => void generate()}
              type="button"
              variant="outline"
            >
              {isGenerating ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {entity.visualProfile
                ? copy.regenerateVisualDesign
                : copy.generateVisualDesign}
            </Button>
          </div>

          <Tabs
            className="gap-0 pt-2"
            onValueChange={(value) =>
              setSection(value as "appearance" | "rules" | "inference")
            }
            value={section}
          >
            <TabsList
              className="sticky top-0 z-10 w-full justify-start border-b bg-background pt-2"
              variant="line"
            >
              <TabsTrigger className="flex-none px-3" value="appearance">
                {copy.visualAppearance}
              </TabsTrigger>
              <TabsTrigger className="flex-none px-3" value="rules">
                {copy.visualGenerationRules}
              </TabsTrigger>
              <TabsTrigger className="flex-none px-3" value="inference">
                {copy.visualInferenceRecord}
              </TabsTrigger>
            </TabsList>

            <TabsContent
              className="grid gap-4 py-4"
              value="appearance"
            >
              <SpecField
                disabled={busy}
                label={copy.visualIdentity}
                onChange={(value) =>
                  setSpec({ ...spec, visualIdentity: value })
                }
                value={spec.visualIdentity}
              />
              <SpecField
                disabled={busy}
                label={copy.shapeAndStructure}
                onChange={(value) =>
                  setSpec({ ...spec, shapeAndStructure: value })
                }
                value={spec.shapeAndStructure}
              />
              <SpecField
                disabled={busy}
                label={copy.surfaceAndStyling}
                onChange={(value) =>
                  setSpec({ ...spec, surfaceAndStyling: value })
                }
                value={spec.surfaceAndStyling}
              />
              <SpecField
                disabled={busy}
                label={copy.colorPalette}
                onChange={(value) => setSpec({ ...spec, colorPalette: value })}
                value={spec.colorPalette}
              />
            </TabsContent>

            <TabsContent
              className="grid gap-4 py-4"
              value="rules"
            >
              <SpecField
                disabled={busy}
                label={copy.lightingAndPresentation}
                onChange={(value) =>
                  setSpec({ ...spec, lightingAndPresentation: value })
                }
                value={spec.lightingAndPresentation}
              />
              <ListField
                disabled={busy}
                label={copy.signatureDetails}
                onChange={(value) =>
                  setSpec({ ...spec, signatureDetails: value })
                }
                value={spec.signatureDetails}
              />
              <ListField
                disabled={busy}
                label={copy.consistencyRules}
                onChange={(value) =>
                  setSpec({ ...spec, consistencyRules: value })
                }
                value={spec.consistencyRules}
              />
              <SpecField
                disabled={busy}
                label={copy.negativePrompt}
                onChange={(value) =>
                  setSpec({ ...spec, negativePrompt: value })
                }
                value={spec.negativePrompt}
              />
            </TabsContent>

            <TabsContent className="py-4" value="inference">
              <ListField
                disabled={busy}
                label={copy.inferenceNotes}
                onChange={(value) =>
                  setSpec({ ...spec, inferenceNotes: value })
                }
                textareaClassName="h-64"
                value={spec.inferenceNotes}
              />
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="m-0 rounded-none border-t bg-background px-5 py-3">
          <Button
            disabled={busy}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            {copy.cancel}
          </Button>
          <Button
            disabled={busy || !isComplete(spec)}
            onClick={() => void save()}
            type="button"
          >
            {isSaving ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {copy.saveVisualDesign}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SpecField({
  className,
  disabled,
  label,
  onChange,
  textareaClassName,
  value,
}: {
  className?: string;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  textareaClassName?: string;
  value: string;
}) {
  return (
    <label className={`grid gap-1.5 text-sm font-medium ${className ?? ""}`}>
      {label}
      <Textarea
        className={`h-36 min-h-28 resize-none field-sizing-fixed ${textareaClassName ?? ""}`}
        disabled={disabled}
        maxLength={2_000}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function ListField({
  className,
  disabled,
  label,
  onChange,
  textareaClassName,
  value,
}: {
  className?: string;
  disabled: boolean;
  label: string;
  onChange: (value: string[]) => void;
  textareaClassName?: string;
  value: string[];
}) {
  return (
    <SpecField
      className={className}
      disabled={disabled}
      label={label}
      onChange={(text) => onChange(lines(text))}
      textareaClassName={textareaClassName}
      value={value.join("\n")}
    />
  );
}

function emptySpec(): AssetVisualProfileSpec {
  return {
    visualIdentity: "",
    shapeAndStructure: "",
    surfaceAndStyling: "",
    colorPalette: "",
    lightingAndPresentation: "",
    signatureDetails: [],
    consistencyRules: [],
    negativePrompt: "",
    inferenceNotes: [],
  };
}

function lines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSpec(spec: AssetVisualProfileSpec) {
  return {
    visualIdentity: spec.visualIdentity.trim(),
    shapeAndStructure: spec.shapeAndStructure.trim(),
    surfaceAndStyling: spec.surfaceAndStyling.trim(),
    colorPalette: spec.colorPalette.trim(),
    lightingAndPresentation: spec.lightingAndPresentation.trim(),
    signatureDetails: spec.signatureDetails.map((item) => item.trim()).filter(Boolean),
    consistencyRules: spec.consistencyRules.map((item) => item.trim()).filter(Boolean),
    negativePrompt: spec.negativePrompt.trim(),
    inferenceNotes: spec.inferenceNotes.map((item) => item.trim()).filter(Boolean),
  };
}

function isComplete(spec: AssetVisualProfileSpec) {
  const normalized = normalizeSpec(spec);
  return (
    Boolean(
      normalized.visualIdentity &&
        normalized.shapeAndStructure &&
        normalized.surfaceAndStyling &&
        normalized.colorPalette &&
        normalized.lightingAndPresentation &&
        normalized.negativePrompt,
    ) &&
    normalized.signatureDetails.length > 0 &&
    normalized.consistencyRules.length >= 2
  );
}
