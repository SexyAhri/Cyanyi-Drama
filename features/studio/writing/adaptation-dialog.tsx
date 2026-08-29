"use client";

import { useEffect, useState } from "react";
import { WandSparkles } from "lucide-react";

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
import { ModelSelect } from "../components/model-select";
import { getStudioCopy } from "../i18n";
import type { StudioLocale, StudioModelOption } from "../types";

type AdaptationMode = "faithful" | "polish" | "drama" | "custom";

export type AdaptationRequest = {
  channelId: string;
  model: string;
  mode: AdaptationMode;
  instructions?: string;
  locale: "en" | "zh";
};

export function AdaptationDialog({
  defaultModelId,
  disabled,
  locale,
  models,
  onStart,
}: {
  defaultModelId: string;
  disabled?: boolean;
  locale: StudioLocale;
  models: StudioModelOption[];
  onStart: (input: AdaptationRequest) => void;
}) {
  const copy = getStudioCopy(locale);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AdaptationMode>("polish");
  const [modelId, setModelId] = useState(defaultModelId);
  const [instructions, setInstructions] = useState("");

  useEffect(() => {
    if (!models.some((model) => model.id === modelId))
      setModelId(
        models.some((model) => model.id === defaultModelId)
          ? defaultModelId
          : (models[0]?.id ?? ""),
      );
  }, [defaultModelId, modelId, models]);

  function handleSubmit() {
    const model = models.find((item) => item.id === modelId);
    if (!model || (mode === "custom" && !instructions.trim())) return;
    onStart({
      channelId: model.channelId,
      model: model.modelId,
      mode,
      instructions: instructions.trim() || undefined,
      locale: locale === "en" ? "en" : "zh",
    });
    setOpen(false);
    setInstructions("");
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
              maxLength={4_000}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={copy.adaptationInstructionsPlaceholder}
              value={instructions}
            />
          </label>
        </div>
        <DialogFooter>
          <Button
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            {copy.cancel}
          </Button>
          <Button
            disabled={
              !modelId || (mode === "custom" && !instructions.trim())
            }
            onClick={handleSubmit}
            type="button"
          >
            <WandSparkles className="size-4" />
            {copy.createAdaptation}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
