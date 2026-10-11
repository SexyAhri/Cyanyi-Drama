"use client";
import { isAssetVisualProfileComplete } from "@/lib/assets/visual-profile";

import { LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { generateStudioAssetVisualProfilesBatch } from "../api";
import { ModelSelect } from "../components/model-select";
import { getStudioCopy } from "../i18n";
import type { StudioLocale, StudioModelOption } from "../types";
import type { StudioAssetEntity } from "./asset-view-model";

export function BatchVisualDesignDialog({
  entities,
  locale,
  models,
  onCompleted,
  projectId,
  trigger,
}: {
  entities: StudioAssetEntity[];
  locale: StudioLocale;
  models: StudioModelOption[];
  onCompleted: () => Promise<unknown> | void;
  projectId: string;
  trigger: React.ReactElement;
}) {
  const copy = getStudioCopy(locale);
  const [open, setOpen] = useState(false);
  const [includeExisting, setIncludeExisting] = useState(false);
  const targets = includeExisting ? entities : entities.filter(entity => !isAssetVisualProfileComplete(entity.visualProfile));
  const [modelId, setModelId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!models.some((model) => model.id === modelId))
      setModelId(models[0]?.id ?? "");
  }, [modelId, models]);

  async function submit() {
    const model = models.find((item) => item.id === modelId);
    if (!model || !targets.length) return;
    setIsSubmitting(true);
    try {
      const result = await generateStudioAssetVisualProfilesBatch(projectId, {
        completeMissing: !includeExisting,
        channelId: model.channelId,
        model: model.modelId,
        locale: locale === "en" ? "en" : "zh",
        items: targets.map((entity) => ({
          targetType: entity.kind,
          targetId: entity.id,
        })),
      });
      toast.success(
        copy.batchVisualDesignSubmitted.replace(
          "{count}",
          String(result.count),
        ),
      );
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
          <DialogTitle>{copy.batchVisualDesign}</DialogTitle>
          <DialogDescription>
            {copy.batchVisualDesignDescription.replace(
              "{count}",
              String(entities.length),
            )}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {locale === "en" ? `Design ${targets.length} missing profiles; reuse existing profiles by default.` : `本次设计 ${targets.length} 个资产，默认复用已有设定和图片提示词。`}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={includeExisting} disabled={isSubmitting} onCheckedChange={setIncludeExisting} />
          {locale === "en" ? "Redesign existing profiles as well" : "同时重新设计已有资产（可选）"}
        </label>
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
            disabled={isSubmitting || !modelId || !targets.length}
            onClick={() => void submit()}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {isSubmitting ? copy.generating : copy.batchVisualDesign}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
