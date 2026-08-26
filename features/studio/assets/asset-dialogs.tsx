"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Plus, ScanSearch, Sparkles } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  extractStudioAssets,
  generateStudioAsset,
  generateStudioAssetBatch,
  upsertStudioAssetEntity,
} from "../api";
import { ModelSelect } from "../components/model-select";
import { getStudioCopy } from "../i18n";
import type { StudioLocale, StudioModelOption } from "../types";
import type { StudioAssetEntity, StudioAssetKind } from "./asset-view-model";

export function AssetEntityDialog({
  kind,
  locale,
  onCompleted,
  projectId,
}: {
  kind: StudioAssetKind;
  locale: StudioLocale;
  onCompleted: () => Promise<unknown> | void;
  projectId: string;
}) {
  const copy = getStudioCopy(locale);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setIsSubmitting(true);
    try {
      await upsertStudioAssetEntity(projectId, {
        kind,
        name: name.trim(),
        summary: description.trim() || undefined,
      });
      toast.success(copy.assetCreated);
      setOpen(false);
      setName("");
      setDescription("");
      await onCompleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" />
        {copy.addAsset}
      </DialogTrigger>
      <DialogContent className="rounded-lg sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.addAsset}</DialogTitle>
          <DialogDescription className="sr-only">
            {assetKindLabel(locale, kind)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.assetName}
            <Input
              autoFocus
              disabled={isSubmitting}
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.assetDescription}
            <Textarea
              className="h-28 resize-y overflow-y-auto field-sizing-fixed"
              disabled={isSubmitting}
              maxLength={2_000}
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </label>
        </div>
        <DialogFooter className="rounded-b-lg">
          <Button
            disabled={isSubmitting}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            {copy.cancel}
          </Button>
          <Button
            disabled={isSubmitting || !name.trim()}
            onClick={() => void submit()}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {copy.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GenerateAssetDialog({
  locale,
  models,
  onCompleted,
  projectId,
  targets,
  trigger,
}: {
  locale: StudioLocale;
  models: StudioModelOption[];
  onCompleted: () => Promise<unknown> | void;
  projectId: string;
  targets: StudioAssetEntity[];
  trigger: React.ReactElement;
}) {
  const copy = getStudioCopy(locale);
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!models.some((model) => model.id === modelId)) {
      setModelId(models[0]?.id ?? "");
    }
  }, [modelId, models]);

  async function submit() {
    const model = models.find((item) => item.id === modelId);
    if (!model || !prompt.trim() || !targets.length) return;
    setIsSubmitting(true);
    try {
      if (targets.length === 1) {
        const [target] = targets;
        await generateStudioAsset(projectId, {
          targetType: target.kind,
          targetId: target.id,
          channelId: model.channelId,
          model: model.modelId,
          prompt: prompt.trim(),
        });
        toast.success(copy.assetGenerated);
      } else {
        const result = await generateStudioAssetBatch(projectId, {
          channelId: model.channelId,
          model: model.modelId,
          prompt: prompt.trim(),
          items: targets.map((target) => ({
            targetType: target.kind,
            targetId: target.id,
            prompt: [prompt.trim(), target.name, target.description?.trim()]
              .filter(Boolean)
              .join("\n"),
          })),
        });
        toast.success(copy.batchGenerated.replace("{count}", String(result.count)));
      }
      setOpen(false);
      setPrompt("");
      await onCompleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={trigger} />
      <DialogContent className="rounded-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.generateImage}</DialogTitle>
          <DialogDescription>
            {targets.map((target) => target.name).join("、")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.imageModel}
            <ModelSelect
              disabled={isSubmitting}
              models={models}
              onChange={setModelId}
              placeholder={copy.imageModel}
              value={modelId}
            />
            {!models.length ? (
              <span className="text-xs font-normal text-destructive">
                {copy.noImageModels}
              </span>
            ) : null}
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.generatePrompt}
            <Textarea
              className="h-36 resize-y overflow-y-auto field-sizing-fixed"
              disabled={isSubmitting}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={copy.generatePromptPlaceholder}
              value={prompt}
            />
          </label>
        </div>
        <DialogFooter className="rounded-b-lg">
          <Button
            disabled={isSubmitting}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            {copy.cancel}
          </Button>
          <Button
            disabled={isSubmitting || !modelId || !prompt.trim()}
            onClick={() => void submit()}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {isSubmitting ? copy.generating : copy.generateImage}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExtractAssetsDialog({
  assetIds,
  locale,
  models,
  onCompleted,
  projectId,
  trigger,
}: {
  assetIds: string[];
  locale: StudioLocale;
  models: StudioModelOption[];
  onCompleted: () => Promise<unknown> | void;
  projectId: string;
  trigger: React.ReactElement;
}) {
  const copy = getStudioCopy(locale);
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!models.some((model) => model.id === modelId)) {
      setModelId(models[0]?.id ?? "");
    }
  }, [modelId, models]);

  async function submit() {
    const model = models.find((item) => item.id === modelId);
    if (!model || !assetIds.length) return;
    setIsSubmitting(true);
    try {
      await extractStudioAssets(projectId, {
        assetIds,
        channelId: model.channelId,
        model: model.modelId,
        locale: locale === "en" ? "en" : "zh",
      });
      toast.success(copy.extractionComplete);
      setOpen(false);
      await onCompleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={trigger} />
      <DialogContent className="rounded-lg sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.extractAssets}</DialogTitle>
          <DialogDescription>
            {copy.selectedCount} · {assetIds.length}
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-sm font-medium">
          {copy.analysisModel}
          <ModelSelect
            disabled={isSubmitting}
            models={models}
            onChange={setModelId}
            placeholder={copy.analysisModel}
            value={modelId}
          />
          {!models.length ? (
            <span className="text-xs font-normal text-destructive">
              {copy.noAnalysisModels}
            </span>
          ) : null}
        </label>
        <DialogFooter className="rounded-b-lg">
          <Button
            disabled={isSubmitting}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            {copy.cancel}
          </Button>
          <Button
            disabled={isSubmitting || !modelId || !assetIds.length}
            onClick={() => void submit()}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ScanSearch className="size-4" />
            )}
            {isSubmitting ? copy.extracting : copy.extractAssets}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function assetKindLabel(locale: StudioLocale, kind: StudioAssetKind) {
  const copy = getStudioCopy(locale);
  if (kind === "character") return copy.characterAssets;
  if (kind === "location") return copy.locationAssets;
  return copy.propAssets;
}
