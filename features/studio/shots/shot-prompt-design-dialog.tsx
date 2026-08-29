"use client";

import { LoaderCircle, Save, Sparkles } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { designStudioPanelPrompt } from "../api";
import { ModelSelect } from "../components/model-select";
import type {
  StudioLocale,
  StudioModelOption,
  StudioStoryboardPanel,
} from "../types";
import type { ShotMediaKind } from "./shot-view-model";

export type PromptDesignVideoMode = "reference" | "first-last";

const text = {
  "zh-CN": {
    imageTitle: "关键帧提示词设计",
    videoTitle: "视频提示词设计",
    analysisModel: "AI 设计模型",
    designImage: "AI 设计关键帧",
    designVideo: "AI 设计视频",
    designing: "正在设计",
    promptTab: "生成提示词",
    notesTab: "设计重点",
    safeguardsTab: "连续性",
    imagePrompt: "镜头关键帧提示词",
    videoPrompt: "镜头视频提示词",
    save: "保存设计",
    saved: "提示词设计已保存",
    loaded: "AI 设计稿已载入",
    emptyNotes: "尚未生成设计重点",
    emptySafeguards: "尚未生成连续性约束",
    noModels: "没有可用的文本分析模型",
    cancel: "取消",
    actionFailed: "操作失败",
  },
  en: {
    imageTitle: "Keyframe prompt design",
    videoTitle: "Video prompt design",
    analysisModel: "AI design model",
    designImage: "Design keyframe",
    designVideo: "Design video",
    designing: "Designing",
    promptTab: "Generation prompt",
    notesTab: "Design decisions",
    safeguardsTab: "Continuity",
    imagePrompt: "Shot keyframe prompt",
    videoPrompt: "Shot video prompt",
    save: "Save design",
    saved: "Prompt design saved",
    loaded: "AI design loaded",
    emptyNotes: "No design decisions generated yet",
    emptySafeguards: "No continuity safeguards generated yet",
    noModels: "No text analysis model is available",
    cancel: "Cancel",
    actionFailed: "Action failed",
  },
} as const;

export function ShotPromptDesignDialog({
  analysisModels,
  episodeId,
  kind,
  locale,
  mode,
  onSave,
  panel,
  projectId,
  trigger,
}: {
  analysisModels: StudioModelOption[];
  episodeId: string;
  kind: ShotMediaKind;
  locale: StudioLocale;
  mode: PromptDesignVideoMode;
  onSave: (input: {
    mode: PromptDesignVideoMode;
    prompt: string;
  }) => Promise<unknown> | void;
  panel: StudioStoryboardPanel;
  projectId: string;
  trigger: React.ReactElement;
}) {
  const copy = text[locale];
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isDesigning, setIsDesigning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [tab, setTab] = useState<"prompt" | "notes" | "continuity">("prompt");
  const [details, setDetails] = useState<{
    designNotes: string[];
    continuitySafeguards: string[];
  } | null>(null);
  const storedPrompt =
    kind === "image"
      ? panel.imagePrompt
      : mode === "first-last"
        ? panel.firstLastFramePrompt
        : panel.videoPrompt;

  useEffect(() => {
    if (!analysisModels.some((model) => model.id === modelId))
      setModelId(analysisModels[0]?.id ?? "");
  }, [analysisModels, modelId]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setPrompt(storedPrompt ?? panel.description ?? "");
      setDetails(null);
      setTab("prompt");
    }
    setOpen(nextOpen);
  }

  async function design() {
    const model = analysisModels.find((item) => item.id === modelId);
    if (!model) return;
    setIsDesigning(true);
    try {
      const result = await designStudioPanelPrompt(
        projectId,
        episodeId,
        panel.id,
        {
          channelId: model.channelId,
          model: model.modelId,
          kind,
          mode,
          currentPrompt: prompt.trim() || undefined,
          locale: locale === "en" ? "en" : "zh",
        },
      );
      setPrompt(result.design.prompt);
      setDetails({
        designNotes: result.design.designNotes,
        continuitySafeguards: result.design.continuitySafeguards,
      });
      toast.success(copy.loaded);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsDesigning(false);
    }
  }

  async function save() {
    if (!prompt.trim()) return;
    setIsSaving(true);
    try {
      await onSave({ mode, prompt: prompt.trim() });
      toast.success(copy.saved);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSaving(false);
    }
  }

  const busy = isDesigning || isSaving;
  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger render={trigger} />
      <DialogContent className="h-[calc(100dvh-1rem)] max-h-216 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-lg p-0 sm:h-[min(92dvh,54rem)] sm:max-w-4xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>
            {kind === "image" ? copy.imageTitle : copy.videoTitle}
          </DialogTitle>
          <DialogDescription className="line-clamp-2">
            {String(panel.panelIndex + 1).padStart(2, "0")} ·{" "}
            {panel.shotType ?? "-"}
            {panel.description ? ` · ${panel.description}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="grid gap-3 border-b pb-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="grid min-w-0 gap-1.5 text-sm font-medium">
              {copy.analysisModel}
              <ModelSelect
                disabled={busy}
                models={analysisModels}
                onChange={setModelId}
                placeholder={copy.analysisModel}
                value={modelId}
              />
              {!analysisModels.length ? (
                <span className="text-xs font-normal text-destructive">
                  {copy.noModels}
                </span>
              ) : null}
            </label>
            <Button
              disabled={busy || !modelId}
              onClick={() => void design()}
              type="button"
              variant="outline"
            >
              {isDesigning ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {isDesigning
                ? copy.designing
                : kind === "image"
                  ? copy.designImage
                  : copy.designVideo}
            </Button>
          </div>

          <Tabs
            className="gap-0 pt-2"
            onValueChange={(value) =>
              setTab(value as "prompt" | "notes" | "continuity")
            }
            value={tab}
          >
            <TabsList
              className="sticky top-0 z-10 w-full justify-start border-b bg-background pt-2"
              variant="line"
            >
              <TabsTrigger className="flex-none px-3" value="prompt">
                {copy.promptTab}
              </TabsTrigger>
              <TabsTrigger className="flex-none px-3" value="notes">
                {copy.notesTab}
              </TabsTrigger>
              <TabsTrigger className="flex-none px-3" value="continuity">
                {copy.safeguardsTab}
              </TabsTrigger>
            </TabsList>

            <TabsContent className="py-4" value="prompt">
              <label className="grid gap-1.5 text-sm font-medium">
                {kind === "image" ? copy.imagePrompt : copy.videoPrompt}
                <Textarea
                  className="h-96 min-h-56 resize-none overflow-y-auto field-sizing-fixed"
                  disabled={busy}
                  maxLength={12_000}
                  onChange={(event) => setPrompt(event.target.value)}
                  value={prompt}
                />
              </label>
            </TabsContent>

            <TabsContent className="py-4" value="notes">
              <PromptList
                empty={copy.emptyNotes}
                values={details?.designNotes ?? []}
              />
            </TabsContent>

            <TabsContent className="py-4" value="continuity">
              <PromptList
                empty={copy.emptySafeguards}
                values={details?.continuitySafeguards ?? []}
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
            disabled={busy || !prompt.trim()}
            onClick={() => void save()}
            type="button"
          >
            {isSaving ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {copy.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PromptList({ empty, values }: { empty: string; values: string[] }) {
  if (!values.length)
    return <p className="py-8 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="divide-y border-y">
      {values.map((value, index) => (
        <li
          className="grid gap-2 py-3 sm:grid-cols-[2rem_minmax(0,1fr)]"
          key={`${index}-${value}`}
        >
          <span className="font-mono text-xs text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="wrap-break-word text-sm leading-6">{value}</span>
        </li>
      ))}
    </ol>
  );
}
