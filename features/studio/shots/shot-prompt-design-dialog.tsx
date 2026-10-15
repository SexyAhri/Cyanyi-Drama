"use client";

import { LoaderCircle, Save, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import type { StoryboardPromptDesignDetails } from "@/lib/novel/domain-types";

import { designStudioPanelPrompt, reviewStudioPanelVideo } from "../api";
import type { VideoVisualReviewResult } from "@/lib/media/visual-review-contract";
import { ModelSelect } from "../components/model-select";
import { useStudioConfirmation } from "../components/use-studio-confirmation";
import type {
  StudioLocale,
  StudioModelOption,
  StudioStoryboardPanel,
} from "../types";
import type { ShotMediaKind } from "./shot-view-model";
import { PromptList, ShotSpatialAudit, ShotVideoDiagnosis } from "./shot-analysis-results";

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
    noModels: "没有可用的分析模型",
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
    noModels: "No analysis model is available",
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
    details: StoryboardPromptDesignDetails | null;
    mode: PromptDesignVideoMode;
    prompt: string;
  }) => Promise<unknown> | void;
  panel: StudioStoryboardPanel;
  projectId: string;
  trigger: React.ReactElement;
}) {
  const copy = text[locale];
  const { confirm, confirmationDialog } = useStudioConfirmation(locale);
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isDesigning, setIsDesigning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [review, setReview] = useState<VideoVisualReviewResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [tab, setTab] = useState("prompt");
  const initialDraft = useRef("");
  const pendingRequest = useRef<AbortController | null>(null);
  useEffect(() => () => pendingRequest.current?.abort(), []);
  const [details, setDetails] =
    useState<StoryboardPromptDesignDetails | null>(null);
  const storedPrompt =
    kind === "image"
      ? panel.imagePrompt
      : mode === "first-last"
        ? panel.firstLastFramePrompt
        : panel.videoPrompt;
  const storedDetails =
    kind === "image"
      ? panel.imagePromptDesign
      : mode === "first-last"
        ? panel.firstLastFramePromptDesign
        : panel.videoPromptDesign;

  useEffect(() => {
    if (!analysisModels.some((model) => model.id === modelId))
      setModelId(analysisModels[0]?.id ?? "");
  }, [analysisModels, modelId]);

  async function handleOpenChange(nextOpen: boolean) {
    if (isSaving) return;
    if (!nextOpen && (isDesigning || isReviewing)) {
      if (!await confirm({
        title: locale === "en" ? "Leave the task running in background?" : "让任务继续在后台运行？",
        description: locale === "en" ? "Closing stops waiting here, not the submitted model task or its charges. Unsaved edits are discarded. Check the task center for results." : "关闭只停止此处等待，不取消已提交的模型任务或费用；未保存修改将丢弃。结果请在任务中心查看。",
        confirmLabel: locale === "en" ? "Close and check later" : "关闭，稍后查看",
      })) return;
      pendingRequest.current?.abort(); setOpen(false); return;
    }
    if (!nextOpen && initialDraft.current !== JSON.stringify({ prompt, details }) && !await confirm({
      title: locale === "en" ? "Discard unsaved design?" : "放弃未保存的设计？",
      description: locale === "en" ? "Your prompt edits have not been saved. Diagnostic results remain in workflow history." : "提示词修改尚未保存。诊断结果仍保存在执行历史中。",
      confirmLabel: locale === "en" ? "Discard changes" : "放弃修改",
    })) return;
    if (nextOpen) {
      const nextPrompt = storedPrompt ?? panel.description ?? "";
      setPrompt(nextPrompt);
      setDetails(storedDetails ?? null);
      initialDraft.current = JSON.stringify({ prompt: nextPrompt, details: storedDetails ?? null });
      setFailure(null);
      setTab("prompt");
    }
    setOpen(nextOpen);
  }

  async function design() {
    if (prompt.trim() && !await confirm({
      title: locale === "en" ? "Redesign the existing prompt?" : "重新设计已有提示词？",
      description: locale === "en" ? "This uses the selected model’s tokens or credits. Review and save the new prompt to apply it." : "将消耗所选模型的 Token/额度。新结果需要核对并保存后才会生效。",
      confirmLabel: locale === "en" ? "Redesign prompt" : "确认并重新设计",
    })) return;
    const model = analysisModels.find((item) => item.id === modelId);
    if (!model) return;
    setIsDesigning(true);
    setFailure(null);
    const controller = new AbortController(); pendingRequest.current = controller;
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
        controller.signal,
      );
      setPrompt(result.design.prompt);
      setDetails({
        designNotes: result.design.designNotes,
        continuitySafeguards: result.design.continuitySafeguards,
        ...(result.design.spatialAudit ? { spatialAudit: result.design.spatialAudit } : {}),
      });
      toast.success(copy.loaded);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : copy.actionFailed;
      setFailure(message);
      toast.error(message);
    } finally {
      setIsDesigning(false);
    }
  }

  async function diagnoseVideo() {
    const model = analysisModels.find((item) => item.id === modelId);
    if (!model || !panel.videoAssetId || !await confirm({
      title: locale === "en" ? "Diagnose the adopted video?" : "诊断当前采用的视频？",
      description: locale === "en" ? "This sends sampled frames to the effective vision Agent and uses tokens/credits. It does not generate video or audio, or replace any media." : "将抽取静帧并发送给实际视觉 Agent，消耗 Token/额度。不会生成视频、配音或替换素材。",
      confirmLabel: locale === "en" ? "Run frame diagnosis" : "确认抽帧诊断",
    })) return;
    setIsReviewing(true); setFailure(null); setTab("diagnosis");
    const controller = new AbortController(); pendingRequest.current = controller;
    try {
      setReview(await reviewStudioPanelVideo(projectId, episodeId, panel.id, {
        channelId: model.channelId, model: model.modelId, locale: locale === "en" ? "en" : "zh",
      }, controller.signal));
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : copy.actionFailed;
      setFailure(message); toast.error(message);
    } finally { setIsReviewing(false); }
  }

  async function save() {
    if (!prompt.trim()) return;
    setIsSaving(true);
    try {
      await onSave({ details, mode, prompt: prompt.trim() });
      toast.success(copy.saved);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSaving(false);
    }
  }

  const busy = isDesigning || isSaving || isReviewing;
  return (
    <Dialog onOpenChange={(value) => void handleOpenChange(value)} open={open}>
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
                : prompt.trim()
                  ? (locale === "en" ? "Redesign (optional)" : "重新设计（可选）")
                  : kind === "image"
                  ? copy.designImage
                  : copy.designVideo}
            </Button>
            {kind === "video" ? <div className="space-y-2 sm:col-span-2">
              <p className="text-xs leading-5 text-muted-foreground">{locale === "en" ? "Adopted keyframes are inspected when available. The effective Agent must support images; global Agent model settings take precedence. Performance is pruned to 2–4 signals without changing dialogue." : "有采用关键帧时读取实际图片审计；实际 Agent 必须支持视觉，全局 Agent 模型设置优先。表演精选 2–4 个信号，保留原台词。"}</p>
              <Button disabled={busy || !modelId || !panel.videoAssetId} onClick={() => void diagnoseVideo()} type="button" variant="outline">
                {isReviewing ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {locale === "en" ? "Diagnose adopted video" : "抽帧诊断已采用视频"}
              </Button>
              {!panel.videoAssetId ? <p className="text-xs text-muted-foreground">{locale === "en" ? "Adopt a video to enable diagnosis." : "先采用视频后可诊断。"}</p> : null}
            </div> : null}
          </div>
          {failure ? <p className="mt-3 wrap-break-word text-sm text-destructive" role="alert">{failure}</p> : null}

          <Tabs
            className="gap-0 pt-2"
            onValueChange={setTab}
            value={tab}
          >
            <TabsList
              className="sticky top-0 z-10 w-full justify-start overflow-x-auto border-b bg-background pt-2"
              variant="line"
            >
              <TabsTrigger className="flex-none px-3" value="prompt">
                {copy.promptTab}
              </TabsTrigger>
              {kind === "video" ? <>
                <TabsTrigger className="flex-none px-3" value="spatial">{locale === "en" ? "Space" : "空间审计"}</TabsTrigger>
                <TabsTrigger className="flex-none px-3" value="diagnosis">{locale === "en" ? "Diagnosis" : "成片诊断"}</TabsTrigger>
              </> : null}
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
            <TabsContent className="space-y-3 py-4" value="spatial">
              <ShotSpatialAudit audit={details?.spatialAudit} locale={locale} />
            </TabsContent>
            <TabsContent className="space-y-4 py-4" value="diagnosis">
              <ShotVideoDiagnosis review={review} pending={isReviewing} locale={locale} busy={busy} promptLength={prompt.length}
                currentVideoAssetId={panel.videoAssetId} onAppend={(suggestion) => {
                  setPrompt((value) => `${value}\n\n${locale === "en" ? "Local repair direction (preserve dialogue and outcomes): " : "局部修复方向（保留原台词和剧情结果）："}${suggestion}`);
                  setTab("prompt");
                }} />
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="m-0 rounded-none border-t bg-background px-5 py-3">
          <Button
            disabled={isSaving}
            onClick={() => void handleOpenChange(false)}
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
      {confirmationDialog}
    </Dialog>
  );
}
