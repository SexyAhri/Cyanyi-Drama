"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, WandSparkles } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { EpisodeSourceVersionRecord } from "@/lib/projects/types";

import { adaptStudioEpisode } from "../api";
import { ModelSelect } from "../components/model-select";
import { getStudioCopy } from "../i18n";
import type { StudioLocale, StudioModelOption } from "../types";

type AdaptationMode = "faithful" | "polish" | "drama" | "custom";

export function AdaptationDialog({
  defaultModelId,
  disabled,
  episodeId,
  locale,
  models,
  onCreated,
  projectId,
}: {
  defaultModelId: string;
  disabled?: boolean;
  episodeId: string;
  locale: StudioLocale;
  models: StudioModelOption[];
  onCreated: (source: EpisodeSourceVersionRecord) => Promise<unknown> | void;
  projectId: string;
}) {
  const copy = getStudioCopy(locale);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AdaptationMode>("polish");
  const [modelId, setModelId] = useState(defaultModelId);
  const [instructions, setInstructions] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!models.some((model) => model.id === modelId))
      setModelId(
        models.some((model) => model.id === defaultModelId)
          ? defaultModelId
          : (models[0]?.id ?? ""),
      );
  }, [defaultModelId, modelId, models]);

  async function handleSubmit() {
    const model = models.find((item) => item.id === modelId);
    if (!model || (mode === "custom" && !instructions.trim())) return;
    setIsSubmitting(true);
    try {
      const result = await adaptStudioEpisode(projectId, episodeId, {
        channelId: model.channelId,
        model: model.modelId,
        mode,
        instructions: instructions.trim() || undefined,
        locale: locale === "en" ? "en" : "zh",
      });
      await onCreated(result.source);
      toast.success(copy.adaptationCreated);
      setOpen(false);
      setInstructions("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button disabled={disabled} size="sm" type="button" variant="outline" />
        }
      >
        <WandSparkles className="size-4" />
        {copy.createAdaptation}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.createAdaptation}</DialogTitle>
          <DialogDescription>{copy.adaptationDialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <Tabs
            onValueChange={(value) => setMode(value as AdaptationMode)}
            value={mode}
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="faithful">{copy.adaptationFaithful}</TabsTrigger>
              <TabsTrigger value="polish">{copy.adaptationPolish}</TabsTrigger>
              <TabsTrigger value="drama">{copy.adaptationDrama}</TabsTrigger>
              <TabsTrigger value="custom">{copy.adaptationCustom}</TabsTrigger>
            </TabsList>
          </Tabs>
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.analysisModel}
            <ModelSelect
              disabled={isSubmitting}
              models={models}
              onChange={setModelId}
              placeholder={copy.analysisModel}
              value={modelId}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.adaptationInstructions}
            <Textarea
              className="min-h-28 resize-y field-sizing-fixed"
              disabled={isSubmitting}
              maxLength={4_000}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={copy.adaptationInstructionsPlaceholder}
              value={instructions}
            />
          </label>
        </div>
        <DialogFooter>
          <Button
            disabled={isSubmitting}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            {copy.cancel}
          </Button>
          <Button
            disabled={
              isSubmitting ||
              !modelId ||
              (mode === "custom" && !instructions.trim())
            }
            onClick={() => void handleSubmit()}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <WandSparkles className="size-4" />
            )}
            {isSubmitting ? copy.adapting : copy.createAdaptation}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
