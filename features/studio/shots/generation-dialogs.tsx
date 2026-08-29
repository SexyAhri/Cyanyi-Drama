"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Images,
  LoaderCircle,
  Sparkles,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { MediaTask } from "@/lib/media/task-contract";
import type { StoryboardPromptPreview } from "@/lib/media/project-asset-tasks";

import {
  generateStudioPanelBatch,
  generateStudioPanelImage,
  generateStudioPanelVideo,
  previewStudioPanelPrompt,
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

const promptCopy = {
  "zh-CN": {
    override: "镜头覆盖提示词",
    finalPrompt: "最终提交提示词",
    compiling: "正在按项目画风和资产参考编译",
    previewFailed: "提示词预览载入失败",
    source: "来源",
    safety: "敏感描述替换",
    blocked: "生成前需要处理",
    skipCompleted: "跳过已有成功结果",
    ready: "可提交",
    skipped: "跳过",
    active: "进行中",
    incomplete: "缺少条件",
  },
  en: {
    override: "Shot prompt override",
    finalPrompt: "Final provider prompt",
    compiling: "Compiling project style and asset references",
    previewFailed: "Unable to load prompt preview",
    source: "Sources",
    safety: "Safety rewrites",
    blocked: "Resolve before generation",
    skipCompleted: "Skip completed results",
    ready: "Ready",
    skipped: "Skipped",
    active: "Active",
    incomplete: "Incomplete",
  },
} as const;

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
  const promptText = promptCopy[locale];
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState<VideoMode>("reference");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<StoryboardPromptPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
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

  useEffect(() => {
    if (!open) return;
    setPrompt(
      (kind === "image"
        ? panel.imagePrompt
        : mode === "first-last"
          ? panel.firstLastFramePrompt
          : panel.videoPrompt) ??
        panel.description ??
        "",
    );
  }, [kind, mode, open, panel]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError("");
      try {
        const result = await previewStudioPanelPrompt(
          projectId,
          episodeId,
          panel.id,
          {
            kind,
            mode,
            prompt,
            lastFramePanelId:
              mode === "first-last" ? nextPanel?.id : undefined,
          },
          controller.signal,
        );
        setPreview(result.preview);
      } catch (error) {
        if (!controller.signal.aborted) {
          setPreview(null);
          setPreviewError(
            error instanceof Error ? error.message : promptText.previewFailed,
          );
        }
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [episodeId, kind, mode, nextPanel?.id, open, panel.id, projectId, prompt, promptText.previewFailed]);

  async function submit() {
    const model = models.find((item) => item.id === modelId);
    if (!model) return;
    setIsSubmitting(true);
    try {
      if (kind === "image") {
        await generateStudioPanelImage(projectId, episodeId, panel.id, {
          channelId: model.channelId,
          model: model.modelId,
          prompt: prompt.trim() || undefined,
        });
      } else {
        await generateStudioPanelVideo(projectId, episodeId, panel.id, {
          channelId: model.channelId,
          model: model.modelId,
          mode,
          prompt: prompt.trim() || undefined,
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
      <DialogContent className="max-h-[min(90dvh,52rem)] overflow-y-auto rounded-lg sm:max-w-2xl">
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
          <label className="grid gap-1.5 text-sm font-medium">
            {promptText.override}
            <Textarea
              disabled={isSubmitting}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              value={prompt}
            />
          </label>
          <PromptPreview
            error={previewError}
            loading={previewLoading}
            locale={locale}
            preview={preview}
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
            disabled={
              isSubmitting ||
              previewLoading ||
              !modelId ||
              Boolean(preview?.issues.some((issue) => issue.blocking))
            }
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
  tasks,
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
  tasks: MediaTask[];
  trigger: React.ReactElement;
}) {
  const copy = getStudioCopy(locale);
  const promptText = promptCopy[locale];
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState("");
  const [mode, setMode] = useState<VideoMode>("reference");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [skipCompleted, setSkipCompleted] = useState(true);
  const [preflight, setPreflight] = useState<
    Record<string, StoryboardPromptPreview | null>
  >({});
  const [preflightLoading, setPreflightLoading] = useState(false);
  const firstLastPanels = useMemo(
    () =>
      panels.filter(
        (panel) =>
          panel.imageAssetId &&
          nextStoryboardPanel(panel, allPanels)?.imageAssetId,
      ),
    [allPanels, panels],
  );
  const modeTargets =
    kind === "video" && mode === "first-last" ? firstLastPanels : panels;
  const activePanelIds = new Set(
    tasks
      .filter(
        (task) =>
          task.kind === kind &&
          task.targetType === "storyboard_panel" &&
          ["queued", "running"].includes(task.status),
      )
      .map((task) => task.targetId),
  );
  const completedPanelIds = new Set(
    panels.flatMap((panel) => {
      const assetId = kind === "image" ? panel.imageAssetId : panel.videoAssetId;
      return assetId ? [panel.id] : [];
    }),
  );
  const readyTargets = modeTargets.filter(
    (panel) =>
      !activePanelIds.has(panel.id) &&
      !(skipCompleted && completedPanelIds.has(panel.id)) &&
      preflight[panel.id] &&
      !preflight[panel.id]?.issues.some((issue) => issue.blocking),
  );
  const skippedCount = modeTargets.filter(
    (panel) => skipCompleted && completedPanelIds.has(panel.id),
  ).length;
  const activeCount = modeTargets.filter((panel) =>
    activePanelIds.has(panel.id),
  ).length;
  const blockedCount = modeTargets.filter(
    (panel) =>
      !activePanelIds.has(panel.id) &&
      !(skipCompleted && completedPanelIds.has(panel.id)) &&
      preflight[panel.id]?.issues.some((issue) => issue.blocking),
  ).length;

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

  useEffect(() => {
    if (!open || !modeTargets.length) return;
    const controller = new AbortController();
    setPreflightLoading(true);
    void Promise.all(
      modeTargets.map(async (panel) => {
        try {
          const result = await previewStudioPanelPrompt(
            projectId,
            episodeId,
            panel.id,
            {
              kind,
              mode,
              lastFramePanelId:
                mode === "first-last"
                  ? nextStoryboardPanel(panel, allPanels)?.id
                  : undefined,
            },
            controller.signal,
          );
          return [panel.id, result.preview] as const;
        } catch {
          return [panel.id, null] as const;
        }
      }),
    ).then((entries) => {
      if (!controller.signal.aborted) {
        setPreflight(Object.fromEntries(entries));
        setPreflightLoading(false);
      }
    });
    return () => controller.abort();
  }, [allPanels, episodeId, kind, mode, modeTargets, open, projectId]);

  async function submit() {
    const model = models.find((item) => item.id === modelId);
    if (!model || !readyTargets.length) return;
    setIsSubmitting(true);
    try {
      const result = await generateStudioPanelBatch(projectId, episodeId, {
        channelId: model.channelId,
        model: model.modelId,
        kind,
        mode,
        items: readyTargets.map((panel) => ({
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
            {copy.selectedCount} · {modeTargets.length}
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
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={skipCompleted}
              onCheckedChange={setSkipCompleted}
            />
            {promptText.skipCompleted}
          </label>
          <div className="grid grid-cols-2 gap-2 border-y py-3 text-xs sm:grid-cols-4">
            <BatchCount label={promptText.ready} value={readyTargets.length} />
            <BatchCount label={promptText.skipped} value={skippedCount} />
            <BatchCount label={promptText.active} value={activeCount} />
            <BatchCount label={promptText.incomplete} value={blockedCount} />
          </div>
          {blockedCount ? (
            <div className="max-h-36 overflow-y-auto border-b pb-3">
              {modeTargets.flatMap((panel) =>
                (preflight[panel.id]?.issues ?? [])
                  .filter((issue) => issue.blocking)
                  .map((issue) => (
                    <p className="py-1 text-xs text-destructive" key={`${panel.id}-${issue.code}`}>
                      {copy.panel} {String(panel.panelIndex + 1).padStart(2, "0")} · {issue.message}
                    </p>
                  )),
              )}
            </div>
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
            disabled={
              isSubmitting || preflightLoading || !modelId || !readyTargets.length
            }
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

function PromptPreview({
  error,
  loading,
  locale,
  preview,
}: {
  error: string;
  loading: boolean;
  locale: StudioLocale;
  preview: StoryboardPromptPreview | null;
}) {
  const text = promptCopy[locale];
  return (
    <details className="border-y py-3" open>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
        <Eye className="size-4" />
        {text.finalPrompt}
        {loading ? <LoaderCircle className="ml-auto size-4 animate-spin" /> : null}
      </summary>
      {loading ? (
        <p className="mt-3 text-xs text-muted-foreground">{text.compiling}</p>
      ) : error ? (
        <p className="mt-3 text-xs text-destructive">{error}</p>
      ) : preview ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {preview.sources.map((source) => (
              <Badge key={source.key} title={source.value} variant="outline">
                {source.label} · {source.value}
              </Badge>
            ))}
          </div>
          {preview.issues.length ? (
            <div className="space-y-1 border-y py-2">
              {preview.issues.map((issue) => (
                <p
                  className={issue.blocking ? "flex gap-2 text-xs text-destructive" : "flex gap-2 text-xs text-muted-foreground"}
                  key={issue.code}
                >
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {issue.message}
                </p>
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-xs text-status-success">
              <CheckCircle2 className="size-3.5" />
              {text.ready}
            </p>
          )}
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-muted/35 p-3 text-xs leading-5">
            {preview.finalPrompt}
          </pre>
          {preview.safetyRewrites.length ? (
            <div className="text-xs">
              <p className="font-medium">{text.safety}</p>
              {preview.safetyRewrites.map((rewrite, index) => (
                <p className="mt-1 text-muted-foreground" key={`${rewrite.category}-${index}`}>
                  {rewrite.original} → {rewrite.replacement}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function BatchCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span className="block font-mono text-base font-semibold">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
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
