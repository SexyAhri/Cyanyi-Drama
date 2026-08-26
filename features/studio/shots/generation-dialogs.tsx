"use client";

import { Images, LoaderCircle, Sparkles, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

import {
  generateStudioPanelBatch,
  generateStudioPanelImage,
  generateStudioPanelVideo,
} from "../api";
import { ModelSelect } from "../components/model-select";
import { getStudioCopy } from "../i18n";
import type {
  StudioLocale,
  StudioModelOption,
  StudioStoryboardPanel,
} from "../types";
import {
  nextStoryboardPanel,
  type ShotMediaKind,
} from "./shot-view-model";

type VideoMode = "reference" | "first-last";

export function PanelGenerationDialog({
  kind,
  locale,
  models,
  onCompleted,
  panel,
  panels,
  projectId,
  episodeId,
  trigger,
}: {
  kind: ShotMediaKind;
  locale: StudioLocale;
  models: StudioModelOption[];
  onCompleted: () => Promise<unknown> | void;
  panel: StudioStoryboardPanel;
  panels: StudioStoryboardPanel[];
  projectId: string;
  episodeId: string;
  trigger: React.ReactElement;
}) {
  const copy = getStudioCopy(locale);
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState<VideoMode>("reference");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nextPanel = nextStoryboardPanel(panel, panels);
  const canUseFirstLast = Boolean(
    panel.imageAssetId && nextPanel?.imageAssetId,
  );

  useEffect(() => {
    if (!models.some((model) => model.id === modelId)) {
      setModelId(models[0]?.id ?? "");
    }
  }, [modelId, models]);

  useEffect(() => {
    if (!canUseFirstLast && mode === "first-last") setMode("reference");
  }, [canUseFirstLast, mode]);

  async function submit() {
    const model = models.find((item) => item.id === modelId);
    if (!model) return;
    setIsSubmitting(true);
    try {
      if (kind === "image") {
        await generateStudioPanelImage(projectId, episodeId, panel.id, {
          channelId: model.channelId,
          model: model.modelId,
        });
      } else {
        await generateStudioPanelVideo(projectId, episodeId, panel.id, {
          channelId: model.channelId,
          model: model.modelId,
          mode,
          lastFramePanelId:
            mode === "first-last" ? nextPanel?.id : undefined,
        });
      }
      toast.success(copy.taskSubmitted);
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
          <DialogTitle>
            {kind === "image" ? copy.generateImage : copy.generateVideo}
          </DialogTitle>
          <DialogDescription>
            {copy.panel} {String(panel.panelIndex + 1).padStart(2, "0")} · {panel.shotType || copy.panelDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">
            {kind === "image" ? copy.imageModel : copy.videoModel}
            <ModelSelect
              disabled={isSubmitting}
              models={models}
              onChange={setModelId}
              placeholder={kind === "image" ? copy.imageModel : copy.videoModel}
              value={modelId}
            />
          </label>
          {!models.length ? (
            <p className="text-xs leading-5 text-destructive">
              {kind === "image" ? copy.noImageModels : copy.noVideoModels}
            </p>
          ) : null}
          {kind === "video" ? (
            <ModeControl
              canUseFirstLast={canUseFirstLast}
              locale={locale}
              mode={mode}
              onChange={setMode}
            />
          ) : null}
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
            disabled={isSubmitting || !modelId}
            onClick={() => void submit()}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : kind === "image" ? (
              <Sparkles className="size-4" />
            ) : (
              <Video className="size-4" />
            )}
            {kind === "image" ? copy.generateImage : copy.generateVideo}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BatchGenerationDialog({
  allPanels,
  episodeId,
  kind,
  locale,
  models,
  onCompleted,
  panels,
  projectId,
  trigger,
}: {
  allPanels: StudioStoryboardPanel[];
  episodeId: string;
  kind: ShotMediaKind;
  locale: StudioLocale;
  models: StudioModelOption[];
  onCompleted: () => Promise<unknown> | void;
  panels: StudioStoryboardPanel[];
  projectId: string;
  trigger: React.ReactElement;
}) {
  const copy = getStudioCopy(locale);
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState<VideoMode>("reference");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firstLastPanels = useMemo(
    () =>
      panels.filter(
        (panel) =>
          panel.imageAssetId &&
          nextStoryboardPanel(panel, allPanels)?.imageAssetId,
      ),
    [allPanels, panels],
  );
  const targets =
    kind === "video" && mode === "first-last" ? firstLastPanels : panels;

  useEffect(() => {
    if (!models.some((model) => model.id === modelId)) {
      setModelId(models[0]?.id ?? "");
    }
  }, [modelId, models]);

  useEffect(() => {
    if (!firstLastPanels.length && mode === "first-last") {
      setMode("reference");
    }
  }, [firstLastPanels.length, mode]);

  async function submit() {
    const model = models.find((item) => item.id === modelId);
    if (!model || !targets.length) return;
    setIsSubmitting(true);
    try {
      const result = await generateStudioPanelBatch(projectId, episodeId, {
        channelId: model.channelId,
        model: model.modelId,
        kind,
        mode,
        items: targets.map((panel) => ({
          panelId: panel.id,
          mode: kind === "video" ? mode : undefined,
          lastFramePanelId:
            kind === "video" && mode === "first-last"
              ? nextStoryboardPanel(panel, allPanels)?.id
              : undefined,
        })),
      });
      toast.success(copy.batchGenerated.replace("{count}", String(result.count)));
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
          <DialogTitle>
            {kind === "image"
              ? copy.generateSelectedImages
              : copy.generateSelectedVideos}
          </DialogTitle>
          <DialogDescription>
            {copy.selectedCount} · {targets.length}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">
            {kind === "image" ? copy.imageModel : copy.videoModel}
            <ModelSelect
              disabled={isSubmitting}
              models={models}
              onChange={setModelId}
              placeholder={kind === "image" ? copy.imageModel : copy.videoModel}
              value={modelId}
            />
          </label>
          {!models.length ? (
            <p className="text-xs leading-5 text-destructive">
              {kind === "image" ? copy.noImageModels : copy.noVideoModels}
            </p>
          ) : null}
          {kind === "video" ? (
            <ModeControl
              canUseFirstLast={firstLastPanels.length > 0}
              locale={locale}
              mode={mode}
              onChange={setMode}
            />
          ) : null}
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
            disabled={isSubmitting || !modelId || !targets.length}
            onClick={() => void submit()}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : kind === "image" ? (
              <Images className="size-4" />
            ) : (
              <Video className="size-4" />
            )}
            {kind === "image"
              ? copy.generateSelectedImages
              : copy.generateSelectedVideos}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeControl({
  canUseFirstLast,
  locale,
  mode,
  onChange,
}: {
  canUseFirstLast: boolean;
  locale: StudioLocale;
  mode: VideoMode;
  onChange: (mode: VideoMode) => void;
}) {
  const copy = getStudioCopy(locale);
  return (
    <fieldset className="grid gap-1.5">
      <legend className="text-sm font-medium">{copy.mediaMode}</legend>
      <div className="inline-flex w-fit rounded-md border p-0.5">
        <Button
          aria-pressed={mode === "reference"}
          onClick={() => onChange("reference")}
          size="sm"
          type="button"
          variant={mode === "reference" ? "secondary" : "ghost"}
        >
          {copy.referenceMode}
        </Button>
        <Button
          aria-pressed={mode === "first-last"}
          disabled={!canUseFirstLast}
          onClick={() => onChange("first-last")}
          size="sm"
          type="button"
          variant={mode === "first-last" ? "secondary" : "ghost"}
        >
          {copy.firstLastMode}
        </Button>
      </div>
    </fieldset>
  );
}
