"use client";

import { useEffect, useState } from "react";
import { BookOpenText, LoaderCircle, Scissors } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { splitStudioNovel } from "../api";
import { ModelSelect } from "../components/model-select";
import { getStudioCopy } from "../i18n";
import type { StudioLocale, StudioModelOption } from "../types";

type SplitMode = "auto" | "markers" | "ai";

export function SplitNovelDialog({
  locale,
  models,
  onCompleted,
  projectId,
}: {
  locale: StudioLocale;
  models: StudioModelOption[];
  onCompleted: () => Promise<unknown> | void;
  projectId: string;
}) {
  const copy = getStudioCopy(locale);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [mode, setMode] = useState<SplitMode>("auto");
  const [modelId, setModelId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!models.some((model) => model.id === modelId)) {
      setModelId(models[0]?.id ?? "");
    }
  }, [modelId, models]);

  async function handleSubmit() {
    const model = models.find((item) => item.id === modelId);
    if (content.length < 100 || !confirmed || (mode === "ai" && !model)) return;
    setIsSubmitting(true);
    try {
      const result = await splitStudioNovel(projectId, {
        content,
        mode,
        channelId: mode === "ai" ? model?.channelId : undefined,
        model: mode === "ai" ? model?.modelId : undefined,
        locale: locale === "en" ? "en" : "zh",
        persist: true,
      });
      const count = result.persisted?.length ?? result.episodes.length;
      toast.success(copy.splitSuccess.replace("{count}", String(count)));
      setOpen(false);
      setContent("");
      setConfirmed(false);
      await onCompleted();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : copy.actionFailed,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button aria-label={copy.splitNovel} size="icon-sm" variant="ghost" />
        }
      >
        <Scissors className="size-4" />
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg sm:max-h-[min(90dvh,780px)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpenText className="size-4" />
            {copy.splitNovel}
          </DialogTitle>
          <DialogDescription>{copy.splitNovelDescription}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <label className="grid gap-1.5 text-sm font-medium">
            {copy.splitMode}
            <Select
              disabled={isSubmitting}
              onValueChange={(next) => next && setMode(next as SplitMode)}
              value={mode}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{copy.splitAuto}</SelectItem>
                <SelectItem value="markers">{copy.splitMarkers}</SelectItem>
                <SelectItem value="ai">{copy.splitAi}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {mode === "ai" ? (
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
          ) : null}
          <label className="grid gap-1.5 text-sm font-medium">
            <span className="flex items-center justify-between gap-3">
              {copy.splitContent}
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {content.length.toLocaleString()} / 2,000,000
              </span>
            </span>
            <Textarea
              className="h-72 min-h-48 max-h-[45dvh] resize-y overflow-y-auto field-sizing-fixed"
              disabled={isSubmitting}
              maxLength={2_000_000}
              onChange={(event) => setContent(event.target.value)}
              placeholder={copy.splitContentPlaceholder}
              value={content}
            />
          </label>
          <label className="flex cursor-pointer items-start gap-3 text-sm leading-5">
            <Checkbox
              checked={confirmed}
              disabled={isSubmitting}
              onCheckedChange={setConfirmed}
            />
            <span>{copy.splitConfirm}</span>
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
            disabled={
              isSubmitting ||
              !confirmed ||
              content.length < 100 ||
              (mode === "ai" && !modelId)
            }
            onClick={() => void handleSubmit()}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Scissors className="size-4" />
            )}
            {isSubmitting ? copy.splitting : copy.splitAndCreate}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
