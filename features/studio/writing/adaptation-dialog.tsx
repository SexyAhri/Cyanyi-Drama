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
  hasProductionScript = false,
  originalContinuation = false,
  defaultModelId,
  disabled,
  locale,
  models,
  onStart,
}: {
  hasProductionScript?: boolean;
  originalContinuation?: boolean;
  defaultModelId: string;
  disabled?: boolean;
  locale: StudioLocale;
  models: StudioModelOption[];
  onStart: (input: AdaptationRequest) => void;
}) {
  const copy = getStudioCopy(locale);
  const actionLabel = originalContinuation ? (locale === "en" ? "Write this original episode" : "续写本集正文") : hasProductionScript ? (locale === "en" ? "Rewrite screenplay (optional)" : "改写剧本（可选）") : copy.createAdaptation;
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
        {actionLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{actionLabel}</DialogTitle>
          <DialogDescription>{originalContinuation ? (locale === "en" ? "Use the adopted series plan, this episode's outline, and the previous ending. Empty episodes receive script and production drafts; existing work stays as a separate version." : "沿用已采用的全剧规划、本集大纲和前集结尾。空集会接入正文与制作草稿；已有正文时保存为候选版本。") : hasProductionScript ? (locale === "en" ? "Create another script version. Existing production remains active until you adopt the new version." : "生成一个新的剧本版本。确认采用新版本后才会替换当前制作稿，已有剧本可以直接继续制作。") : copy.adaptationDialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {!originalContinuation ? <Tabs
            onValueChange={(value) => setMode(value as AdaptationMode)}
            value={mode}
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="faithful">{copy.adaptationFaithful}</TabsTrigger>
              <TabsTrigger value="polish">{copy.adaptationPolish}</TabsTrigger>
              <TabsTrigger value="drama">{copy.adaptationDrama}</TabsTrigger>
              <TabsTrigger value="custom">{copy.adaptationCustom}</TabsTrigger>
            </TabsList>
          </Tabs> : null}
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
            {actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
