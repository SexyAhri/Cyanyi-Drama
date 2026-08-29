"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  BookOpenText,
  Braces,
  CircleAlert,
  FilePenLine,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { EpisodeSourceVersionRecord } from "@/lib/projects/types";
import { cn } from "@/lib/utils";

import {
  activateStudioEpisodeSource,
  adaptStudioEpisode,
  controlStudioWorkflow,
  loadStudioEpisodeSources,
  loadStudioProductionData,
  startStoryToScriptWorkflow,
  updateStudioEpisode,
} from "../api";
import { ModelSelect } from "../components/model-select";
import { formatStudioDate, getStudioCopy } from "../i18n";
import {
  getWorkflowForStage,
  getWorkflowContentRevision,
  runtimeStatusToStageStatus,
} from "../stage-state";
import type {
  ProductionClipRecord,
  StudioLocale,
  StudioModelOption,
  StudioSelectionContext,
  WorkspaceSnapshot,
} from "../types";
import { workflowStepLabel } from "../workflow-labels";
import { StatusIndicator } from "../components/status-indicator";
import {
  AdaptationDialog,
  type AdaptationRequest,
} from "./adaptation-dialog";

type AdaptationDraft = {
  episodeId: string;
  status: "running" | "failed";
  content: string;
  error?: string;
};

export function WritingWorkspace({
  analysisModelId,
  episode,
  locale,
  models,
  onAnalysisModelChange,
  onContextChange,
  onRefresh,
  snapshot,
}: {
  analysisModelId: string;
  episode: WorkspaceSnapshot["project"]["episodes"][number];
  locale: StudioLocale;
  models: StudioModelOption[];
  onAnalysisModelChange: (modelId: string) => void;
  onContextChange: (selection?: StudioSelectionContext) => void;
  onRefresh: () => Promise<unknown> | void;
  snapshot: WorkspaceSnapshot;
}) {
  const copy = getStudioCopy(locale);
  const [tab, setTab] = useState<"original" | "adapted" | "screenplay">(
    episode.activeSourceKind,
  );
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
  const [isLoadingSources, setIsLoadingSources] = useState(true);
  const [isActivatingSource, setIsActivatingSource] = useState(false);
  const [sourceRevision, setSourceRevision] = useState(0);
  const [adaptationDraft, setAdaptationDraft] =
    useState<AdaptationDraft | null>(null);
  const episodeIdRef = useRef(episode.id);
  const [sourceCatalog, setSourceCatalog] = useState<
    Awaited<ReturnType<typeof loadStudioEpisodeSources>> | null
  >(null);
  const [selectedSourceIds, setSelectedSourceIds] = useState<
    Partial<Record<"original" | "adapted", string>>
  >({});
  const workflows = snapshot.workflows.filter(
    (workflow) => workflow.episodeId === episode.id,
  );
  const workflow = getWorkflowForStage(workflows, "writing");
  const workflowRevision = getWorkflowContentRevision(workflow);
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
    episodeIdRef.current = episode.id;
    setTab(episode.activeSourceKind);
    setSelectedSourceIds({});
    setAdaptationDraft(null);
  }, [episode.id, episode.activeSourceKind]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadingSources(true);
    void loadStudioEpisodeSources(
      snapshot.project.id,
      episode.id,
      controller.signal,
    )
      .then(setSourceCatalog)
      .catch((error) => {
        if (!controller.signal.aborted)
          toast.error(error instanceof Error ? error.message : copy.loadFailed);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingSources(false);
      });
    return () => controller.abort();
  }, [copy.loadFailed, episode.id, snapshot.project.id, sourceRevision]);

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
  }, [copy.loadFailed, episode.id, snapshot.project.id, workflowRevision]);

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

  const sourceKind = tab === "adapted" ? "adapted" : "original";
  const sourceVersions = (sourceCatalog?.sources ?? []).filter(
    (source) => source.kind === sourceKind,
  );
  const selectedSource =
    sourceVersions.find(
      (source) => source.id === selectedSourceIds[sourceKind],
    ) ??
    sourceVersions.find((source) => source.id === sourceCatalog?.activeSourceId) ??
    sourceVersions[0];
  const selectedSourceIsActive =
    Boolean(selectedSource) && selectedSource?.id === sourceCatalog?.activeSourceId;
  const displayedSourceText = selectedSourceIsActive
    ? novelText
    : (selectedSource?.content ?? "");
  const displayedTextLength =
    tab === "adapted" && adaptationDraft?.episodeId === episode.id
      ? adaptationDraft.content.length
      : displayedSourceText.length;

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
      setSourceRevision((current) => current + 1);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function activateSource(source: EpisodeSourceVersionRecord) {
    setIsActivatingSource(true);
    try {
      await activateStudioEpisodeSource(
        snapshot.project.id,
        episode.id,
        source.id,
      );
      setNovelText(source.content);
      setSavedText(source.content);
      setSourceRevision((current) => current + 1);
      toast.success(copy.sourceActivated);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsActivatingSource(false);
    }
  }

  function startAdaptation(input: AdaptationRequest) {
    const requestEpisodeId = episode.id;
    setTab("adapted");
    setAdaptationDraft({
      episodeId: requestEpisodeId,
      status: "running",
      content: "",
    });
    void adaptStudioEpisode(snapshot.project.id, requestEpisodeId, input, {
      onReset: () =>
        setAdaptationDraft((current) =>
          current?.episodeId === requestEpisodeId
            ? { ...current, status: "running", content: "", error: undefined }
            : current,
        ),
      onContent: (content) =>
        setAdaptationDraft((current) =>
          current?.episodeId === requestEpisodeId
            ? { ...current, status: "running", content, error: undefined }
            : current,
        ),
    })
      .then(async (result) => {
        if (episodeIdRef.current !== requestEpisodeId) return;
        setSelectedSourceIds((current) => ({
          ...current,
          adapted: result.source.id,
        }));
        setAdaptationDraft(null);
        setSourceRevision((current) => current + 1);
        toast.success(copy.adaptationCreated);
        await onRefresh();
      })
      .catch((error: unknown) => {
        if (episodeIdRef.current !== requestEpisodeId) return;
        const message =
          error instanceof Error ? error.message : copy.actionFailed;
        setAdaptationDraft((current) =>
          current?.episodeId === requestEpisodeId
            ? { ...current, status: "failed", error: message }
            : current,
        );
        toast.error(message);
      });
  }

  async function startWorkflow() {
    const model = models.find((item) => item.id === analysisModelId);
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
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-7 sm:py-7 xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:overflow-hidden">
      <header className="flex shrink-0 flex-col gap-4 border-b pb-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {String(episode.episodeNumber).padStart(2, "0")} · {episode.name}
          </p>
          <h1 className="mt-1 text-xl font-semibold">{copy.sourceEditor}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {tab !== "screenplay" ? (
            <>
              <span className="font-mono">
                {displayedTextLength.toLocaleString()} {copy.wordCount}
              </span>
              <span aria-hidden>·</span>
              <span>
                {adaptationDraft?.episodeId === episode.id && tab === "adapted"
                  ? adaptationDraft.status === "running"
                    ? copy.adaptationStreaming
                    : copy.adaptationFailed
                  : selectedSourceIsActive
                  ? isDirty
                    ? copy.unsavedChanges
                    : copy.productionSource
                  : copy.sourceReadOnly}
              </span>
              {selectedSourceIsActive &&
              !(tab === "adapted" && adaptationDraft?.episodeId === episode.id) ? (
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
              ) : null}
              <AdaptationDialog
                defaultModelId={analysisModelId}
                disabled={
                  isSaving ||
                  workflowActive ||
                  adaptationDraft?.status === "running" ||
                  !sourceCatalog?.sources.length
                }
                locale={locale}
                models={models}
                onStart={startAdaptation}
              />
            </>
          ) : null}
        </div>
      </header>

      <div
        className="grid min-w-0 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_19rem] xl:overflow-hidden"
      >
        <Tabs
          className="min-w-0 py-5 xl:min-h-0 xl:overflow-hidden xl:pr-7"
          onValueChange={(value) =>
            setTab(value as "original" | "adapted" | "screenplay")
          }
          value={tab}
        >
          <TabsList variant="line">
            <TabsTrigger value="original">
              <BookOpenText className="size-4" />
              {copy.originalSource}
              <Badge className="ml-1" variant="secondary">
                {(sourceCatalog?.sources ?? []).filter(
                  (source) => source.kind === "original",
                ).length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="adapted">
              <FilePenLine className="size-4" />
              {copy.adaptedSource}
              <Badge className="ml-1" variant="secondary">
                {(sourceCatalog?.sources ?? []).filter(
                  (source) => source.kind === "adapted",
                ).length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="screenplay">
              <Braces className="size-4" />
              {copy.screenplay}
              <Badge className="ml-1" variant="secondary">
                {clips.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
          {(["original", "adapted"] as const).map((kind) => {
            const versions = (sourceCatalog?.sources ?? []).filter(
              (source) => source.kind === kind,
            );
            const source =
              versions.find(
                (item) => item.id === selectedSourceIds[kind],
              ) ??
              versions.find((item) => item.id === sourceCatalog?.activeSourceId) ??
              versions[0];
            const isActive = source?.id === sourceCatalog?.activeSourceId;
            return (
              <TabsContent
                className="mt-4 xl:min-h-0 xl:overflow-hidden"
                key={kind}
                value={kind}
              >
                <SourceVersionPane
                  activeSourceId={sourceCatalog?.activeSourceId ?? null}
                  adaptationDraft={
                    kind === "adapted" && adaptationDraft?.episodeId === episode.id
                      ? adaptationDraft
                      : null
                  }
                  displayedText={isActive ? novelText : (source?.content ?? "")}
                  isActivating={isActivatingSource}
                  isLoading={isLoadingSources}
                  isSaving={isSaving}
                  kind={kind}
                  locale={locale}
                  manuscriptSynopsis={sourceCatalog?.manuscript?.synopsis}
                  onActivate={(next) => void activateSource(next)}
                  onChange={setNovelText}
                  onDismissAdaptation={() => setAdaptationDraft(null)}
                  onSelect={(sourceId) =>
                    setSelectedSourceIds((current) => ({
                      ...current,
                      [kind]: sourceId,
                    }))
                  }
                  source={source}
                  versions={versions}
                  workflowActive={workflowActive}
                />
              </TabsContent>
            );
          })}
          <TabsContent className="mt-4 xl:min-h-0 xl:overflow-y-auto" value="screenplay">
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

          <aside className="border-t py-5 xl:min-h-0 xl:overflow-y-auto xl:border-t-0 xl:border-l xl:pl-6">
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
                    <div
                      className="flex items-center gap-2 py-2.5"
                      key={step.id}
                    >
                      <span className="w-5 font-mono text-[10px] text-muted-foreground">
                        {String(step.index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {workflowStepLabel(locale, step.key)}
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
                <ModelSelect
                  ariaLabel={copy.analysisModel}
                  className="h-8"
                  disabled={isActing || workflowActive}
                  models={models}
                  onChange={onAnalysisModelChange}
                  placeholder={copy.analysisModel}
                  value={analysisModelId}
                />
                {!models.length ? (
                  <p className="text-xs leading-5 text-destructive">
                    {copy.noAnalysisModels}
                  </p>
                ) : null}
                {!workflowActive ? (
                  <Button
                    className="w-full"
                    disabled={
                      isActing ||
                      !savedText.trim() ||
                      isDirty ||
                      !analysisModelId
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
                <p className="mt-5 text-[11px] text-muted-foreground">
                  {formatStudioDate(locale, workflow.updatedAt)}
                </p>
              ) : null}
            </div>
          </aside>
      </div>
    </div>
  );
}

function SourceVersionPane({
  activeSourceId,
  adaptationDraft,
  displayedText,
  isActivating,
  isLoading,
  isSaving,
  kind,
  locale,
  manuscriptSynopsis,
  onActivate,
  onChange,
  onDismissAdaptation,
  onSelect,
  source,
  versions,
  workflowActive,
}: {
  activeSourceId: string | null;
  adaptationDraft: AdaptationDraft | null;
  displayedText: string;
  isActivating: boolean;
  isLoading: boolean;
  isSaving: boolean;
  kind: "original" | "adapted";
  locale: StudioLocale;
  manuscriptSynopsis?: string | null;
  onActivate: (source: EpisodeSourceVersionRecord) => void;
  onChange: (value: string) => void;
  onDismissAdaptation: () => void;
  onSelect: (sourceId: string) => void;
  source?: EpisodeSourceVersionRecord;
  versions: EpisodeSourceVersionRecord[];
  workflowActive: boolean;
}) {
  const copy = getStudioCopy(locale);
  if (adaptationDraft)
    return (
      <StreamingAdaptationPane
        draft={adaptationDraft}
        locale={locale}
        onDismiss={onDismissAdaptation}
      />
    );
  if (isLoading)
    return (
      <div className="flex min-h-80 items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  if (!source)
    return (
      <div className="flex min-h-80 items-center justify-center border-y px-6 text-center text-sm text-muted-foreground">
        {kind === "adapted" ? copy.noAdaptedSource : copy.novelTextPlaceholder}
      </div>
    );

  const isActive = source.id === activeSourceId;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-3 border-y py-3 sm:flex-row sm:items-center">
        <Select onValueChange={(value) => value && onSelect(value)} value={source.id}>
          <SelectTrigger className="h-8 w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {versions.map((version) => (
              <SelectItem key={version.id} value={version.id}>
                {copy.sourceVersion} {version.version} · {formatStudioDate(locale, version.createdAt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Badge variant="outline">
            {kind === "adapted" ? copy.adaptedSource : copy.originalSource} v{source.version}
          </Badge>
          {isActive ? <Badge>{copy.productionSource}</Badge> : null}
          {!isActive ? (
            <Button
              disabled={isActivating || workflowActive}
              onClick={() => onActivate(source)}
              size="sm"
              type="button"
            >
              {isActivating ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {copy.setProductionSource}
            </Button>
          ) : null}
        </div>
      </div>

      {manuscriptSynopsis ? (
        <div className="border-b py-3 text-sm">
          <p className="text-xs font-medium text-muted-foreground">
            {copy.manuscriptSynopsis}
          </p>
          <p className="mt-1 line-clamp-3 leading-6">{manuscriptSynopsis}</p>
        </div>
      ) : null}

      {source.summary || source.changeSummary.length ? (
        <div className="grid gap-3 border-b py-3 text-sm lg:grid-cols-2">
          {source.summary ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {kind === "adapted"
                  ? copy.episodeSynopsis
                  : copy.episodeExcerpt}
              </p>
              <p className="mt-1 line-clamp-3 leading-6">{source.summary}</p>
            </div>
          ) : null}
          {source.changeSummary.length ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {copy.changeSummary}
              </p>
              <p className="mt-1 line-clamp-3 leading-6">
                {source.changeSummary.join("；")}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <Textarea
        aria-label={kind === "adapted" ? copy.adaptedSource : copy.originalSource}
        className="mt-4 h-[min(56dvh,42rem)] min-h-80 resize-y overflow-y-auto rounded-md bg-card p-4 leading-7 field-sizing-fixed xl:min-h-0 xl:flex-1 xl:resize-none"
        disabled={!isActive || isSaving || workflowActive}
        onChange={(event) => onChange(event.target.value)}
        placeholder={copy.novelTextPlaceholder}
        value={displayedText}
      />
    </div>
  );
}

function StreamingAdaptationPane({
  draft,
  locale,
  onDismiss,
}: {
  draft: AdaptationDraft;
  locale: StudioLocale;
  onDismiss: () => void;
}) {
  const copy = getStudioCopy(locale);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (draft.status !== "running" || !textareaRef.current) return;
    textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
  }, [draft.content, draft.status]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 items-center gap-2 border-y py-3 text-sm">
        {draft.status === "running" ? (
          <LoaderCircle className="size-4 animate-spin text-primary" />
        ) : (
          <CircleAlert className="size-4 text-destructive" />
        )}
        <span className="font-medium">
          {draft.status === "running"
            ? copy.adaptationStreaming
            : copy.adaptationFailed}
        </span>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {draft.content.length.toLocaleString()} {copy.wordCount}
        </span>
        {draft.status === "failed" ? (
          <Button
            aria-label={copy.close}
            onClick={onDismiss}
            size="icon-sm"
            title={copy.close}
            type="button"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
      {draft.status === "failed" && draft.error ? (
        <p className="border-b py-3 text-sm leading-6 text-destructive">
          {draft.error}
        </p>
      ) : null}
      <Textarea
        aria-busy={draft.status === "running"}
        aria-label={copy.adaptedSource}
        className="mt-4 h-[min(56dvh,42rem)] min-h-80 resize-y overflow-y-auto rounded-md bg-card p-4 leading-7 field-sizing-fixed xl:min-h-0 xl:flex-1 xl:resize-none"
        placeholder={copy.adapting}
        readOnly
        ref={textareaRef}
        value={draft.content}
      />
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
