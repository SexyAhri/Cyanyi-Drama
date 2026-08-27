"use client";

import { Layers3, LoaderCircle, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
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
import type { VfxTaskStage } from "@/lib/production/vfx-contract";

import { generateStudioVfxTask } from "../api";
import { ModelSelect } from "../components/model-select";
import { getStudioCopy } from "../i18n";
import type { StudioLocale, StudioModelOption } from "../types";
import { getProductionCopy } from "../production/copy";
import type { VfxShotVersion } from "./vfx-view-model";

export function VfxTaskDialog({
  episodeId,
  imageModels,
  locale,
  onCompleted,
  projectId,
  stage,
  version,
  videoModels,
}: {
  episodeId: string;
  imageModels: StudioModelOption[];
  locale: StudioLocale;
  onCompleted: () => Promise<unknown> | void;
  projectId: string;
  stage: VfxTaskStage;
  version: VfxShotVersion;
  videoModels: StudioModelOption[];
}) {
  const copy = getProductionCopy(locale);
  const studioCopy = getStudioCopy(locale);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"image" | "video">("video");
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState(() => defaultPrompt(version, stage));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const models =
    stage === "composite" || kind === "video" ? videoModels : imageModels;
  const selected = useMemo(
    () => models.find((model) => model.id === modelId) ?? models[0],
    [modelId, models],
  );

  async function submit() {
    if (!selected || !prompt.trim()) return;
    setIsSubmitting(true);
    try {
      await generateStudioVfxTask(
        projectId,
        episodeId,
        version.deliverable.id,
        {
          stage,
          kind: stage === "composite" ? "video" : kind,
          channelId: selected.channelId,
          model: selected.modelId,
          prompt: prompt.trim(),
        },
      );
      toast.success(studioCopy.taskSubmitted);
      setOpen(false);
      await onCompleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setPrompt(defaultPrompt(version, stage));
          setModelId("");
        }
      }}
      open={open}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        {stage === "element" ? (
          <Sparkles className="size-4" />
        ) : (
          <Layers3 className="size-4" />
        )}
        {stage === "element" ? copy.queueElement : copy.queueComposite}
      </DialogTrigger>
      <DialogContent className="rounded-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {stage === "element" ? copy.queueElement : copy.queueComposite}
          </DialogTitle>
          <DialogDescription>
            {version.deliverable.title} · v{version.deliverable.version}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {stage === "element" ? (
            <Tabs
              onValueChange={(value) => {
                setKind(value as "image" | "video");
                setModelId("");
              }}
              value={kind}
            >
              <TabsList className="w-full">
                <TabsTrigger className="flex-1" value="image">
                  {studioCopy.images}
                </TabsTrigger>
                <TabsTrigger className="flex-1" value="video">
                  {studioCopy.videos}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
          <ModelSelect
            ariaLabel={
              kind === "image" ? studioCopy.imageModel : studioCopy.videoModel
            }
            className="w-full"
            disabled={isSubmitting}
            models={models}
            onChange={setModelId}
            placeholder={
              kind === "image" ? studioCopy.imageModel : studioCopy.videoModel
            }
            value={selected?.id ?? ""}
          />
          <Textarea
            aria-label={copy.vfxSummary}
            className="h-36 resize-y overflow-y-auto field-sizing-fixed"
            disabled={isSubmitting}
            maxLength={8_000}
            onChange={(event) => setPrompt(event.target.value)}
            value={prompt}
          />
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
            disabled={isSubmitting || !selected || !prompt.trim()}
            onClick={() => void submit()}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultPrompt(version: VfxShotVersion, stage: VfxTaskStage) {
  const shotPackage = version.package;
  if (!shotPackage) return "";
  return [
    shotPackage.summary,
    ...(stage === "element"
      ? shotPackage.elements.requirements
      : shotPackage.compositeNotes),
    `Working color space: ${shotPackage.colorSpace}`,
  ]
    .filter(Boolean)
    .join("\n");
}
