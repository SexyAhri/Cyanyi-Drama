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
import { Input } from "@/components/ui/input";
import type { MediaTask } from "@/lib/media/task-contract";
import type { StoryboardPromptPreview } from "@/lib/media/project-asset-tasks";

import {
  generateStudioPanelBatch,
  generateStudioPanelImage,
  generateStudioPanelVideo,
  preflightStudioPanelBatch,
  previewStudioPanelPrompt,
} from "../api";
import { ModelSelect } from "../components/model-select";
import { getStudioCopy } from "../i18n";
import type {
  StudioLocale,
  StudioModelOption,
  StudioStoryboardPanel,
} from "../types";
import type { StudioMediaBudgetSummary } from "../api";
import { nextStoryboardPanel, type ShotMediaKind } from "./shot-view-model";

type VideoMode = "reference" | "first-last";

const promptCopy = {
  "zh-CN": {
    finalPrompt: "最终提交提示词",
    verbatimVideoPrompt: "实际提交的视频提示词",
    compiling: "正在编译项目画风和资产参考",
    checkingVideo: "正在核对视频提示词、参考图与提交参数",
    previewFailed: "提示词预览载入失败",
    source: "来源",
    safety: "敏感描述替换",
    blocked: "生成前需要处理",
    skipCompleted: "跳过已有成功结果",
    ready: "可提交",
    skipped: "跳过",
    active: "进行中",
    incomplete: "缺少条件",
    generationPlan: "生成拆分",
    modelLimit: "模型单次上限",
    segment: "片段",
    generationRequests: "实际生成请求",
    providerCostUnknown:
      "未接入渠道方报价，渠道费用未知；以下金额仅为平台配置的额度占用",
    quotaKnown: "本平台可用余额 / 本批预计冻结",
    quotaSufficient: "余额可用",
    quotaInsufficient: "余额不足，不能提交",
    quotaUnknown: "未配置计费价格，平台费用未知",
    providerQuotaUnknown: "渠道方余额无法预查；排队名额会在 worker 执行时获取",
    batchBudget: "本批最高额度（可选）",
    projectBudget:
      "项目预算：上限 {limit} · 已用 {actual} · 冻结 {reserved} · 剩余 {remaining}",
    batchBudgetResult:
      " · 本批额度：已用 {actual} / 冻结 {reserved} / 剩余 {remaining}",
    preflightFailed: "批量预检失败，请重试后再提交",
  },
  en: {
    finalPrompt: "Final provider prompt",
    verbatimVideoPrompt: "Video prompts sent to the model",
    compiling: "Compiling project style and asset references",
    checkingVideo: "Checking video prompt, references, and request parameters",
    previewFailed: "Unable to load prompt preview",
    source: "Sources",
    safety: "Safety rewrites",
    blocked: "Resolve before generation",
    skipCompleted: "Skip completed results",
    ready: "Ready",
    skipped: "Skipped",
    active: "Active",
    incomplete: "Incomplete",
    generationPlan: "Generation split",
    modelLimit: "Model limit per request",
    segment: "Segment",
    generationRequests: "Generation requests",
    providerCostUnknown:
      "Provider pricing is unavailable; provider cost is unknown. The amount below is only the configured platform credit hold.",
    quotaKnown: "Available credits / estimated batch hold",
    quotaSufficient: "Credits available",
    quotaInsufficient: "Insufficient credits; submission blocked",
    quotaUnknown: "No billing price configured; platform charge is unknown",
    providerQuotaUnknown:
      "Provider balance cannot be checked here; worker acquires capacity at execution",
    batchBudget: "Batch credit cap (optional)",
    projectBudget:
      "Project budget: cap {limit} · spent {actual} · held {reserved} · remaining {remaining}",
    batchBudgetResult:
      " · Batch credits: spent {actual} / held {reserved} / remaining {remaining}",
    preflightFailed: "Batch preflight failed. Retry before submitting.",
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
  const selectedModel = models.find((model) => model.id === modelId);
  const canUseFirstLast = Boolean(
    panel.imageAssetId &&
      nextPanel?.imageAssetId &&
      (selectedModel?.maxReferenceImages === undefined ||
        selectedModel.maxReferenceImages >= 2) &&
      (!panel.durationSeconds ||
        !selectedModel?.maxDurationSeconds ||
        panel.durationSeconds <= selectedModel.maxDurationSeconds),
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
    if (!open || kind !== "video" || !canUseFirstLast || !selectedModel) return;
    const supportsBothFrames = (selectedModel.maxReferenceImages ?? 0) >= 2;
    const fitsDuration =
      !panel.durationSeconds ||
      !selectedModel.maxDurationSeconds ||
      panel.durationSeconds <= selectedModel.maxDurationSeconds;
    if (supportsBothFrames && fitsDuration) setMode("first-last");
  }, [
    open,
    kind,
    canUseFirstLast,
    panel.id,
    panel.durationSeconds,
    selectedModel,
  ]);

  useEffect(() => {
    if (!open) return;
    setPrompt(
      (kind === "image"
        ? panel.imagePrompt
        : mode === "first-last"
          ? panel.firstLastFramePrompt || panel.videoPrompt
          : panel.videoPrompt) ??
        panel.description ??
        "",
    );
  }, [kind, mode, open, panel]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setPreview(null);
    setPreviewLoading(true);
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
            channelId: selectedModel?.channelId,
            model: selectedModel?.modelId,
            lastFramePanelId: mode === "first-last" ? nextPanel?.id : undefined,
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
  }, [
    episodeId,
    kind,
    mode,
    nextPanel?.id,
    open,
    panel.id,
    projectId,
    prompt,
    promptText.previewFailed,
    selectedModel,
  ]);

  async function submit() {
    const model = models.find((item) => item.id === modelId);
    if (!model) return;
    setIsSubmitting(true);
    try {
      if (kind === "image") {
        await generateStudioPanelImage(projectId, episodeId, panel.id, {
          previewConfigurationHash: preview?.configurationHash,
          previewRequestHash: preview?.requestHash,
          channelId: model.channelId,
          model: model.modelId,
          prompt: prompt.trim() || undefined,
        });
      } else {
        await generateStudioPanelVideo(projectId, episodeId, panel.id, {
          previewConfigurationHash: preview?.configurationHash,
          previewRequestHash: preview?.requestHash,
          channelId: model.channelId,
          model: model.modelId,
          mode,
          prompt: prompt.trim() || undefined,
          lastFramePanelId: mode === "first-last" ? nextPanel?.id : undefined,
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
    <Dialog
      onOpenChange={(next) => {
        if (isSubmitting) return;
        setOpen(next);
      }}
      open={open}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-lg p-0 sm:max-h-[min(90dvh,44rem)] sm:max-w-lg">
        <DialogHeader className="border-b px-4 py-4">
          <DialogTitle>
            {kind === "image" ? copy.generateImage : copy.generateVideo}
          </DialogTitle>
          <DialogDescription>
            {copy.panel} {String(panel.panelIndex + 1).padStart(2, "0")} ·{" "}
            {panel.shotType || copy.panelDescription}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 overflow-y-auto overflow-x-hidden px-4 py-4">
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
            <>
              <ModeControl
                canUseFirstLast={canUseFirstLast}
                locale={locale}
                mode={mode}
                onChange={setMode}
              />
              <VideoSegmentSummary
                locale={locale}
                maxDurationSeconds={preview?.maxDurationSeconds}
                segments={preview?.segments}
              />
            </>
          ) : null}
          <PromptPreview
            error={previewError}
            kind={kind}
            loading={previewLoading}
            locale={locale}
            preview={preview}
          />
        </div>
        <DialogFooter className="m-0 min-h-16 rounded-none border-t bg-background px-4 py-3">
          <Button
            disabled={isSubmitting}
            onClick={() => {
              setOpen(false);
            }}
            type="button"
            variant="outline"
          >
            {copy.cancel}
          </Button>
          <Button
            disabled={
              isSubmitting ||
              previewLoading ||
              !preview ||
              Boolean(previewError) ||
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
  const [preflightIssues, setPreflightIssues] = useState<
    Record<string, Array<{ blocking: boolean; code: string; message: string }>>
  >({});
  const [preflightError, setPreflightError] = useState("");
  const [globalPreflightIssues, setGlobalPreflightIssues] = useState<
    Array<{ blocking: boolean; code: string; message: string }>
  >([]);
  const [quota, setQuota] = useState<{
    status: "sufficient" | "insufficient" | "unknown";
    availableCredits: string | null;
    estimatedCredits: string | null;
    providerBalance: "unavailable";
  } | null>(null);
  const [requestCount, setRequestCount] = useState(0);
  const [batchBudgetLimit, setBatchBudgetLimit] = useState("");
  const [projectBudget, setProjectBudget] =
    useState<StudioMediaBudgetSummary | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const selectedModel = models.find((model) => model.id === modelId);
  const firstLastPanels = useMemo(
    () =>
      panels.filter(
        (panel) =>
          panel.imageAssetId &&
          nextStoryboardPanel(panel, allPanels)?.imageAssetId,
      ),
    [allPanels, panels],
  );
  const modeTargets = useMemo(
    () =>
      kind === "video" && mode === "first-last" ? firstLastPanels : panels,
    [firstLastPanels, kind, mode, panels],
  );
  const activePanelIds = useMemo(
    () =>
      new Set(
        tasks
          .filter(
            (task) =>
              task.kind === kind &&
              task.targetType === "storyboard_panel" &&
              ["queued", "running"].includes(task.status),
          )
          .map((task) => task.targetId),
      ),
    [kind, tasks],
  );
  const completedPanelIds = useMemo(
    () =>
      new Set(
        panels.flatMap((panel) => {
          const assetId =
            kind === "image" ? panel.imageAssetId : panel.videoAssetId;
          const videoComplete =
            kind === "video" && panel.videoSegments.length
              ? panel.videoSegments.every((segment) => segment.videoAssetId)
              : Boolean(assetId);
          return kind === "video"
            ? videoComplete
              ? [panel.id]
              : []
            : assetId
              ? [panel.id]
              : [];
        }),
      ),
    [kind, panels],
  );
  const readyTargets = modeTargets.filter(
    (panel) =>
      !activePanelIds.has(panel.id) &&
      !(skipCompleted && completedPanelIds.has(panel.id)) &&
      preflight[panel.id] &&
      !(preflightIssues[panel.id] ?? preflight[panel.id]?.issues ?? []).some(
        (issue) => issue.blocking,
      ),
  );
  const skippedCount = modeTargets.filter(
    (panel) => skipCompleted && completedPanelIds.has(panel.id),
  ).length;
  const activeCount = modeTargets.filter((panel) =>
    activePanelIds.has(panel.id),
  ).length;
  const preflightTargets = useMemo(
    () =>
      modeTargets.filter(
        (panel) =>
          !activePanelIds.has(panel.id) &&
          !(skipCompleted && completedPanelIds.has(panel.id)),
      ),
    [activePanelIds, completedPanelIds, modeTargets, skipCompleted],
  );
  const blockedCount = modeTargets.filter(
    (panel) =>
      !activePanelIds.has(panel.id) &&
      !(skipCompleted && completedPanelIds.has(panel.id)) &&
      (!preflight[panel.id] ||
        (preflightIssues[panel.id] ?? preflight[panel.id]?.issues ?? []).some(
          (issue) => issue.blocking,
        )),
  ).length;
  const plannedDuration = readyTargets.reduce(
    (total, panel) =>
      total +
      (preflight[panel.id]?.segments?.reduce(
        (subtotal, segment) => subtotal + segment.durationSeconds,
        0,
      ) ?? 0),
    0,
  );

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
    if (!open) return;
    if (!preflightTargets.length) {
      setPreflight({});
      setPreflightIssues({});
      setQuota(null);
      setRequestCount(0);
      return;
    }
    const controller = new AbortController();
    setPreflightLoading(true);
    setPreflight({});
    setPreflightIssues({});
    setPreflightError("");
    setGlobalPreflightIssues([]);
    setQuota(null);
    setRequestCount(0);
    setProjectBudget(null);
    if (!selectedModel) {
      setPreflightError(promptText.preflightFailed);
      setPreflightLoading(false);
      return () => controller.abort();
    }
    void preflightStudioPanelBatch(
      projectId,
      episodeId,
      {
        channelId: selectedModel.channelId,
        model: selectedModel.modelId,
        kind,
        mode,
        batchBudgetLimit: batchBudgetLimit.trim()
          ? batchBudgetLimit.trim()
          : null,
        items: preflightTargets.map((panel) => ({
          panelId: panel.id,
          mode: kind === "video" ? mode : undefined,
          lastFramePanelId:
            kind === "video" && mode === "first-last"
              ? nextStoryboardPanel(panel, allPanels)?.id
              : undefined,
        })),
      },
      controller.signal,
    )
      .then(({ preflight: result }) => {
        if (controller.signal.aborted) return;
        setPreflight(
          Object.fromEntries(
            result.items.map((item) => [item.panelId, item.preview]),
          ),
        );
        setPreflightIssues(
          Object.fromEntries(
            result.items.map((item) => [item.panelId, item.issues]),
          ),
        );
        setQuota(result.quota);
        setRequestCount(result.requestCount);
        setProjectBudget(result.projectBudget);
        const itemIssueKeys = new Set(
          result.items.flatMap((item) =>
            item.issues.map((issue) => issue.code),
          ),
        );
        setGlobalPreflightIssues(
          result.blockers.filter((issue) => !itemIssueKeys.has(issue.code)),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setPreflightError(promptText.preflightFailed);
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreflightLoading(false);
      });
    return () => controller.abort();
  }, [
    allPanels,
    episodeId,
    kind,
    mode,
    modeTargets,
    preflightTargets,
    open,
    projectId,
    selectedModel,
    batchBudgetLimit,
    promptText.preflightFailed,
    skipCompleted,
  ]);

  async function submit() {
    const model = models.find((item) => item.id === modelId);
    if (!model || !readyTargets.length) return;
    setIsSubmitting(true);
    try {
      const result = await generateStudioPanelBatch(projectId, episodeId, {
        batchBudgetLimit: batchBudgetLimit.trim()
          ? batchBudgetLimit.trim()
          : null,
        channelId: model.channelId,
        model: model.modelId,
        kind,
        mode,
        items: readyTargets.map((panel) => ({
          previewConfigurationHash:
            preflight[panel.id]?.configurationHash,
          previewRequestHash:
            preflight[panel.id]?.requestHash,
          panelId: panel.id,
          mode: kind === "video" ? mode : undefined,
          lastFramePanelId:
            kind === "video" && mode === "first-last"
              ? nextStoryboardPanel(panel, allPanels)?.id
              : undefined,
        })),
      });
      if (result.summary?.failedToSubmit) {
        toast.warning(
          copy.batchSubmissionPartial
            .replace("{submitted}", String(result.count))
            .replace("{failed}", String(result.summary.failedToSubmit))
            .replace(
              "{message}",
              result.failures?.[0]?.message ?? copy.actionFailed,
            ),
        );
      } else {
        toast.success(
          copy.batchGenerated.replace("{count}", String(result.count)) +
            (result.budget?.configured
              ? promptText.batchBudgetResult
                  .replace("{actual}", result.budget.actual)
                  .replace("{reserved}", result.budget.reserved)
                  .replace("{remaining}", result.budget.remaining ?? "0")
              : ""),
        );
      }
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
        if (isSubmitting) return;
        setOpen(next);
      }}
      open={open}
    >
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
            <>
              <ModeControl
                canUseFirstLast={firstLastPanels.length > 0}
                locale={locale}
                mode={mode}
                onChange={setMode}
              />
            </>
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
                (preflightIssues[panel.id] ?? preflight[panel.id]?.issues ?? [])
                  .filter((issue) => issue.blocking)
                  .map((issue) => (
                    <p
                      className="py-1 text-xs text-destructive"
                      key={`${panel.id}-${issue.code}`}
                    >
                      {copy.panel}{" "}
                      {String(panel.panelIndex + 1).padStart(2, "0")} ·{" "}
                      {issue.message}
                    </p>
                  )),
              )}
            </div>
          ) : null}
          {preflightError ? (
            <p className="text-xs text-destructive" role="alert">
              {preflightError}
            </p>
          ) : null}
          {globalPreflightIssues.map((issue) => (
            <p
              className="text-xs text-destructive"
              key={issue.code}
              role="alert"
            >
              {issue.message}
            </p>
          ))}
          {quota ? (
            <div
              className={
                quota.status === "insufficient"
                  ? "space-y-1 border-b pb-3 text-xs text-destructive"
                  : "space-y-1 border-b pb-3 text-xs text-muted-foreground"
              }
              role={quota.status === "insufficient" ? "alert" : undefined}
            >
              <p>
                {quota.status === "insufficient"
                  ? promptText.quotaInsufficient
                  : quota.status === "unknown"
                    ? promptText.quotaUnknown
                    : promptText.quotaSufficient}
              </p>
              {quota.availableCredits !== null &&
              quota.estimatedCredits !== null ? (
                <p>
                  {promptText.quotaKnown}: {quota.availableCredits} /{" "}
                  {quota.estimatedCredits}
                </p>
              ) : null}
              <p>{promptText.providerCostUnknown}</p>
              <p>{promptText.providerQuotaUnknown}</p>
            </div>
          ) : null}
          <label className="grid gap-1.5 text-xs font-medium">
            {promptText.batchBudget}
            <Input
              disabled={isSubmitting}
              inputMode="decimal"
              min="0"
              onChange={(event) => setBatchBudgetLimit(event.target.value)}
              placeholder={
                locale === "en" ? "Blank means unlimited" : "留空不单独限制本批"
              }
              type="number"
              value={batchBudgetLimit}
            />
          </label>
          {projectBudget?.configured ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {promptText.projectBudget
                .replace("{limit}", projectBudget.limit ?? "—")
                .replace("{actual}", projectBudget.actual)
                .replace("{reserved}", projectBudget.reserved)
                .replace("{remaining}", projectBudget.remaining ?? "0")}
            </p>
          ) : null}
          <p className="flex items-center justify-between border-y py-2 text-xs">
            <span className="text-muted-foreground">
              {promptText.generationRequests}
            </span>
            <span className="font-mono font-medium">
              {requestCount}
              {kind === "video" ? ` · ${plannedDuration}s` : ""}
            </span>
          </p>
        </div>
        <DialogFooter className="rounded-b-lg">
          <Button
            disabled={isSubmitting}
            onClick={() => {
              setOpen(false);
            }}
            type="button"
            variant="outline"
          >
            {copy.cancel}
          </Button>
          <Button
            disabled={
              isSubmitting ||
              preflightLoading ||
              Boolean(preflightError) ||
              globalPreflightIssues.some((issue) => issue.blocking) ||
              quota?.status === "insufficient" ||
              !modelId ||
              !readyTargets.length
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
  kind,
  loading,
  locale,
  preview,
}: {
  error: string;
  kind: ShotMediaKind;
  loading: boolean;
  locale: StudioLocale;
  preview: StoryboardPromptPreview | null;
}) {
  const text = promptCopy[locale];
  return (
    <details className="min-w-0 border-y py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
        <Eye className="size-4" />
        {kind === "video" ? text.verbatimVideoPrompt : text.finalPrompt}
        {loading ? (
          <LoaderCircle className="ml-auto size-4 animate-spin" />
        ) : null}
      </summary>
      {loading ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {kind === "video" ? text.checkingVideo : text.compiling}
        </p>
      ) : error ? (
        <p className="mt-3 text-xs text-destructive">{error}</p>
      ) : preview ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {preview.sources.map((source) => (
              <Badge
                className="max-w-full"
                key={source.key}
                title={source.value}
                variant="outline"
              >
                <span className="max-w-48 truncate">
                  {source.label} · {source.value}
                </span>
              </Badge>
            ))}
          </div>
          {preview.issues.length ? (
            <div className="space-y-1 border-y py-2">
              {preview.issues.map((issue) => (
                <p
                  className={
                    issue.blocking
                      ? "flex gap-2 text-xs text-destructive"
                      : "flex gap-2 text-xs text-muted-foreground"
                  }
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
          <pre className="max-h-64 max-w-full overflow-y-auto overflow-x-hidden whitespace-pre-wrap wrap-break-word bg-muted/35 p-3 text-xs leading-5">
            {preview.segments && preview.segments.length > 1
              ? preview.segments
                  .map(
                    (segment) =>
                      `${text.segment} ${segment.index + 1} · ${segment.durationSeconds}s\n${segment.prompt}`,
                  )
                  .join("\n\n")
              : preview.finalPrompt}
          </pre>
          {preview.parameters && (
            <pre className="whitespace-pre-wrap break-anywhere rounded border p-3 text-xs break-anywhere">
              {JSON.stringify(preview.parameters, null, 2)}
            </pre>
          )}
          {preview.capabilities && (
            <dl className="grid gap-3 rounded border bg-muted/20 p-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">
                  {locale === "en" ? "Native audio" : "原生声音"}
                </dt>
                <dd>
                  {preview.capabilities.nativeAudio === "supported"
                    ? locale === "en"
                      ? "Supported"
                      : "支持"
                    : preview.capabilities.nativeAudio === "unsupported"
                      ? locale === "en"
                        ? "Unsupported"
                        : "不支持"
                      : locale === "en"
                        ? "Not verified"
                        : "能力尚未确认"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {locale === "en" ? "Audio control" : "声音控制方式"}
                </dt>
                <dd>
                  {preview.capabilities.audioControl === "native_parameter"
                    ? locale === "en"
                      ? "Native audio parameter"
                      : "原生音频参数"
                    : locale === "en"
                      ? "Prompt requirement; inspect output"
                      : "提示词要求，需检查实际输出"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {locale === "en" ? "Reference audio" : "参考音频"}
                </dt>
                <dd>
                  {preview.capabilities.referenceAudio
                    ? `${preview.capabilities.maxReferenceAudios} ${locale === "en" ? "maximum" : "个以内"}`
                    : locale === "en"
                      ? "Not supported by this adapter"
                      : "当前渠道未接线支持"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {locale === "en"
                    ? "Speech, voice, lip sync and rendered subtitles"
                    : "台词、音色、口型与模型内字幕"}
                </dt>
                <dd>
                  {locale === "en"
                    ? "Prompt requirements; exact results are not guaranteed"
                    : "提示词约束，不能保证精确结果"}
                </dd>
              </div>
            </dl>
          )}
          {preview.safetyRewrites.length ? (
            <div className="text-xs">
              <p className="font-medium">{text.safety}</p>
              {preview.safetyRewrites.map((rewrite, index) => (
                <p
                  className="mt-1 text-muted-foreground"
                  key={`${rewrite.category}-${index}`}
                >
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

function VideoSegmentSummary({
  locale,
  maxDurationSeconds,
  segments,
}: {
  locale: StudioLocale;
  maxDurationSeconds?: number;
  segments?: StoryboardPromptPreview["segments"];
}) {
  const text = promptCopy[locale];
  if (!segments?.length) return null;
  return (
    <div className="border-y py-2.5 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{text.generationPlan}</span>
        <span className="text-muted-foreground">
          {text.modelLimit} {maxDurationSeconds ?? "-"}s
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-muted-foreground">
        {segments.map((segment) => (
          <span key={segment.index}>
            {text.segment} {segment.index + 1} · {segment.startSeconds}-
            {segment.endSeconds}s
          </span>
        ))}
      </div>
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
