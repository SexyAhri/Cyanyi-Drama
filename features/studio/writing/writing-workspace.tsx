"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  BookOpenText,
  Braces,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Save,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  controlStudioWorkflow,
  loadStudioProductionData,
  startStoryToScriptWorkflow,
  updateStudioEpisode,
} from "../api";
import { ModelSelect } from "../components/model-select";
import { formatStudioDate, getStudioCopy } from "../i18n";
import {
  getWorkflowForStage,
  runtimeStatusToStageStatus,
} from "../stage-state";
import type {
  ProductionClipRecord,
  StudioLocale,
  StudioModelOption,
  StudioSelectionContext,
  WorkspaceSnapshot,
} from "../types";
import { StatusIndicator } from "../components/status-indicator";

export function WritingWorkspace({
  episode,
  locale,
  models,
  onContextChange,
  onRefresh,
  snapshot,
}: {
  episode: WorkspaceSnapshot["project"]["episodes"][number];
  locale: StudioLocale;
  models: StudioModelOption[];
  onContextChange: (selection?: StudioSelectionContext) => void;
  onRefresh: () => Promise<unknown> | void;
  snapshot: WorkspaceSnapshot;
}) {
  const copy = getStudioCopy(locale);
  const [novelText, setNovelText] = useState(episode.novelText ?? "");
  const [savedText, setSavedText] = useState(episode.novelText ?? "");
  const serverTextRef = useRef({
    episodeId: episode.id,
    text: episode.novelText ?? "",
  });
  const [clips, setClips] = useState<ProductionClipRecord[]>([]);
  const [selectedClipId, setSelectedClipId] = useState("");
  const [isLoadingClips, setIsLoadingClips] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [modelId, setModelId] = useState("");
  const workflows = snapshot.workflows.filter(
    (workflow) => workflow.episodeId === episode.id,
  );
  const workflow = getWorkflowForStage(workflows, "writing");
  const isDirty = novelText !== savedText;

  useEffect(() => {
    const nextText = episode.novelText ?? "";
    const previous = serverTextRef.current;
    setNovelText((current) =>
      episode.id !== previous.episodeId || current === previous.text
        ? nextText
        : current,
    );
    setSavedText(nextText);
    serverTextRef.current = { episodeId: episode.id, text: nextText };
  }, [episode.id, episode.novelText]);

  useEffect(() => {
    if (models.some((model) => model.id === modelId)) return;
    const configured = models.find(
      (model) => model.modelId === snapshot.project.config.analysisModel,
    );
    setModelId(configured?.id ?? models[0]?.id ?? "");
  }, [modelId, models, snapshot.project.config.analysisModel]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingClips(true);
    void loadStudioProductionData(
      snapshot.project.id,
      episode.id,
      controller.signal,
    )
      .then((result) => setClips(result.clips))
      .catch((error) => {
        if (!controller.signal.aborted) {
          toast.error(error instanceof Error ? error.message : copy.loadFailed);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingClips(false);
      });
    return () => controller.abort();
  }, [copy.loadFailed, episode.id, snapshot.project.id, workflow?.updatedAt]);

  const selectedClip =
    clips.find((clip) => clip.id === selectedClipId) ?? clips[0];

  useEffect(() => {
    if (!clips.length) {
      setSelectedClipId("");
      onContextChange(undefined);
      return;
    }
    if (!clips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(clips[0].id);
    }
  }, [clips, onContextChange, selectedClipId]);

  useEffect(() => {
    onContextChange(
      selectedClip
        ? {
            id: selectedClip.id,
            kind: "clip",
            label: selectedClip.summary,
            metadata: {
              clipIndex: selectedClip.clipIndex,
              shotCount: selectedClip.shotCount ?? 0,
            },
          }
        : undefined,
    );
  }, [onContextChange, selectedClip]);

  async function saveSource() {
    setIsSaving(true);
    try {
      const result = await updateStudioEpisode(
        snapshot.project.id,
        episode.id,
        {
          novelText,
        },
      );
      const persisted = result.episode.novelText ?? "";
      setNovelText(persisted);
      setSavedText(persisted);
      toast.success(copy.saved);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function startWorkflow() {
    const model = models.find((item) => item.id === modelId);
    if (!model || !savedText.trim() || isDirty) return;
    setIsActing(true);
    try {
      const result = await startStoryToScriptWorkflow(
        snapshot.project.id,
        episode.id,
        {
          channelId: model.channelId,
          model: model.modelId,
          locale: locale === "en" ? "en" : "zh",
        },
      );
      toast.success(result.reused ? copy.workflowReused : copy.workflowStarted);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsActing(false);
    }
  }

  async function controlWorkflow(
    action: "cancel" | "retry" | "pause" | "resume",
  ) {
    if (!workflow) return;
    setIsActing(true);
    try {
      await controlStudioWorkflow(workflow.id, action);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsActing(false);
    }
  }

  const workflowActive = workflow
    ? ["queued", "running", "canceling", "paused"].includes(workflow.status)
    : false;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-7 sm:py-7">
      <header className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {String(episode.episodeNumber).padStart(2, "0")} · {episode.name}
          </p>
          <h1 className="mt-1 text-xl font-semibold">{copy.sourceEditor}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">
            {novelText.length.toLocaleString()} {copy.wordCount}
          </span>
          <span aria-hidden>·</span>
          <span>{isDirty ? copy.unsavedChanges : copy.saved}</span>
          <Button
            disabled={!isDirty || isSaving || workflowActive}
            onClick={() => void saveSource()}
            size="sm"
            type="button"
          >
            {isSaving ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {isSaving ? copy.saving : copy.save}
          </Button>
        </div>
      </header>

      <div className="grid min-w-0 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <Tabs className="min-w-0 py-5 xl:pr-7" defaultValue="source">
          <TabsList variant="line">
            <TabsTrigger value="source">
              <BookOpenText className="size-4" />
              {copy.sourceText}
            </TabsTrigger>
            <TabsTrigger value="screenplay">
              <Braces className="size-4" />
              {copy.screenplay}
              <Badge className="ml-1" variant="secondary">
                {clips.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
          <TabsContent className="mt-4" value="source">
            <Textarea
              aria-label={copy.novelText}
              className="h-[min(60dvh,44rem)] min-h-80 resize-y overflow-y-auto rounded-md bg-card p-4 leading-7 field-sizing-fixed"
              disabled={isSaving || workflowActive}
              onChange={(event) => setNovelText(event.target.value)}
              placeholder={copy.novelTextPlaceholder}
              value={novelText}
            />
          </TabsContent>
          <TabsContent className="mt-4" value="screenplay">
            <ScreenplayList
              clips={clips}
              emptyLabel={copy.noClips}
              isLoading={isLoadingClips}
              locale={locale}
              onSelect={setSelectedClipId}
              selectedClipId={selectedClip?.id}
            />
          </TabsContent>
        </Tabs>

        <aside className="border-t py-5 xl:border-t-0 xl:border-l xl:pl-6">
          <div className="xl:sticky xl:top-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">{copy.workflow}</h2>
              {workflow ? (
                <StatusIndicator
                  className="ml-auto"
                  locale={locale}
                  status={runtimeStatusToStageStatus(workflow.status)}
                />
              ) : null}
            </div>
            {workflow ? (
              <div className="mt-4 divide-y border-y">
                {workflow.steps.map((step) => (
                  <div className="flex items-center gap-2 py-2.5" key={step.id}>
                    <span className="w-5 font-mono text-[10px] text-muted-foreground">
                      {String(step.index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {step.key}
                    </span>
                    <StatusIndicator
                      locale={locale}
                      status={runtimeStatusToStageStatus(step.status)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {copy.noWorkflow}
              </p>
            )}

            <div className="mt-5 space-y-2">
              <label className="grid gap-1.5 text-xs font-medium">
                {copy.analysisModel}
                <ModelSelect
                  disabled={isActing || workflowActive}
                  models={models}
                  onChange={setModelId}
                  placeholder={copy.analysisModel}
                  value={modelId}
                />
              </label>
              {!models.length ? (
                <p className="text-xs leading-5 text-destructive">
                  {copy.noAnalysisModels}
                </p>
              ) : null}
              {!workflowActive ? (
                <Button
                  className="w-full"
                  disabled={
                    isActing || !savedText.trim() || isDirty || !modelId
                  }
                  onClick={() => void startWorkflow()}
                  type="button"
                >
                  {isActing ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : workflow ? (
                    <RotateCcw className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  {workflow ? copy.rerunAnalysis : copy.startAnalysis}
                </Button>
              ) : null}
              <WorkflowActions
                disabled={isActing}
                locale={locale}
                onAction={controlWorkflow}
                status={workflow?.status}
              />
            </div>
            {workflow ? (
              <div className="mt-5 space-y-1 text-[11px] text-muted-foreground">
                <p className="truncate font-mono">{workflow.traceId}</p>
                <p>{formatStudioDate(locale, workflow.updatedAt)}</p>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

function WorkflowActions({
  disabled,
  locale,
  onAction,
  status,
}: {
  disabled: boolean;
  locale: StudioLocale;
  onAction: (action: "cancel" | "retry" | "pause" | "resume") => void;
  status?: string;
}) {
  const copy = getStudioCopy(locale);
  if (!status) return null;
  if (status === "failed" || status === "blocked") {
    return (
      <Button
        className="w-full"
        disabled={disabled}
        onClick={() => onAction("retry")}
        type="button"
        variant="outline"
      >
        <RotateCcw className="size-4" />
        {copy.retryWorkflow}
      </Button>
    );
  }
  if (!["queued", "running", "canceling", "paused"].includes(status)) {
    return null;
  }
  return (
    <div className="flex gap-2">
      {status === "running" ? (
        <Button
          className="flex-1"
          disabled={disabled}
          onClick={() => onAction("pause")}
          type="button"
          variant="outline"
        >
          <Pause className="size-4" />
          {copy.pauseWorkflow}
        </Button>
      ) : status === "paused" ? (
        <Button
          className="flex-1"
          disabled={disabled}
          onClick={() => onAction("resume")}
          type="button"
          variant="outline"
        >
          <Play className="size-4" />
          {copy.resumeWorkflow}
        </Button>
      ) : null}
      <Button
        className="flex-1"
        disabled={disabled || status === "canceling"}
        onClick={() => onAction("cancel")}
        type="button"
        variant="outline"
      >
        <Ban className="size-4" />
        {copy.cancelWorkflow}
      </Button>
    </div>
  );
}

function ScreenplayList({
  clips,
  emptyLabel,
  isLoading,
  locale,
  onSelect,
  selectedClipId,
}: {
  clips: ProductionClipRecord[];
  emptyLabel: string;
  isLoading: boolean;
  locale: StudioLocale;
  onSelect: (clipId: string) => void;
  selectedClipId?: string;
}) {
  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }
  if (!clips.length) {
    return (
      <div className="flex min-h-64 items-center justify-center border-y px-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }
  return (
    <div className="divide-y border-y">
      {clips.map((clip) => (
        <article
          className={cn(
            "px-3 py-5",
            clip.id === selectedClipId && "bg-muted/50",
          )}
          key={clip.id}
        >
          <button
            className="flex w-full min-w-0 items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            onClick={() => onSelect(clip.id)}
            type="button"
          >
            <span className="mt-0.5 w-8 shrink-0 font-mono text-xs text-muted-foreground">
              {String(clip.clipIndex + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">{clip.summary}</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[...clip.characters, ...clip.locations, ...clip.props].map(
                  (item) => (
                    <Badge key={item} variant="outline">
                      {item}
                    </Badge>
                  ),
                )}
              </div>
              <Screenplay screenplay={clip.screenplay} source={clip.content} />
              <p className="mt-3 text-[11px] text-muted-foreground">
                {formatStudioDate(locale, clip.updatedAt)}
              </p>
            </div>
          </button>
        </article>
      ))}
    </div>
  );
}

function Screenplay({
  screenplay,
  source,
}: {
  screenplay: string | null;
  source: string;
}) {
  const scenes = useMemo(() => parseScreenplay(screenplay), [screenplay]);
  if (!scenes.length) {
    return (
      <p className="mt-4 line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
        {source}
      </p>
    );
  }
  return (
    <div className="mt-4 space-y-5 border-l pl-4">
      {scenes.map((scene, index) => (
        <section key={`${scene.heading}-${index}`}>
          <h4 className="font-mono text-xs font-semibold uppercase">
            {scene.heading}
          </h4>
          {scene.description ? (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {scene.description}
            </p>
          ) : null}
          <div className="mt-3 space-y-2 text-sm leading-6">
            {scene.lines.map((line, lineIndex) => (
              <p
                className={line.speaker ? "pl-5" : undefined}
                key={`${lineIndex}-${line.text}`}
              >
                {line.speaker ? (
                  <strong className="mr-2 font-medium">{line.speaker}</strong>
                ) : null}
                {line.text}
              </p>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function parseScreenplay(value: string | null) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { scenes?: unknown }).scenes)
    ) {
      return [];
    }
    return (parsed as { scenes: unknown[] }).scenes.flatMap((scene) => {
      if (!scene || typeof scene !== "object") return [];
      const record = scene as Record<string, unknown>;
      const heading =
        record.heading && typeof record.heading === "object"
          ? (record.heading as Record<string, unknown>)
          : {};
      const content = Array.isArray(record.content) ? record.content : [];
      return [
        {
          heading: [heading.intExt, heading.location, heading.time]
            .filter(
              (item): item is string =>
                typeof item === "string" && Boolean(item),
            )
            .join(". "),
          description:
            typeof record.description === "string" ? record.description : "",
          lines: content.flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const line = item as Record<string, unknown>;
            const text =
              typeof line.lines === "string"
                ? line.lines
                : typeof line.text === "string"
                  ? line.text
                  : "";
            return text
              ? [
                  {
                    speaker:
                      typeof line.character === "string" ? line.character : "",
                    text,
                  },
                ]
              : [];
          }),
        },
      ];
    });
  } catch {
    return [];
  }
}
