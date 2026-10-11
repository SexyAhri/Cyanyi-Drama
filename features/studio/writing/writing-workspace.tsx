"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenText,
  Braces,
  CircleAlert,
  FilePenLine,
  LoaderCircle,
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
import { formatStudioDate, getStudioCopy } from "../i18n";
import {
  getWorkflowContentRevision,
  getWritingWorkflowContentRevision,
  getWritingWorkflowRuns,
} from "../stage-state";
import type {
  ProductionClipRecord,
  StudioLocale,
  StudioModelOption,
  StudioSelectionContext,
  WorkspaceSnapshot,
} from "../types";
import { AdaptationDialog, type AdaptationRequest } from "./adaptation-dialog";
import { WritingFlowPanel } from "./writing-flow-panel";

type AdaptationDraft = {
  episodeId: string;
  status: "running" | "failed";
  phase: "generating" | "saving";
  content: string;
  error?: string;
};

export function WritingWorkspace({
  analysisModelId,
  canContinueOriginal = false,
  episode,
  locale,
  models,
  onAnalysisModelChange,
  onContextChange,
  onRefresh,
  snapshot,
}: {
  analysisModelId: string;
  canContinueOriginal?: boolean;
  episode: WorkspaceSnapshot["project"]["episodes"][number];
  locale: StudioLocale;
  models: StudioModelOption[];
  onAnalysisModelChange: (value: string) => void;
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
  const [sourceCatalog, setSourceCatalog] = useState<Awaited<
    ReturnType<typeof loadStudioEpisodeSources>
  > | null>(null);
  const [selectedSourceIds, setSelectedSourceIds] = useState<
    Partial<Record<"original" | "adapted", string>>
  >({});
  const workflows = snapshot.workflows.filter(
    (workflow) => workflow.episodeId === episode.id,
  );
  const { adaptation: adaptationWorkflow, production: placementWorkflow } =
    getWritingWorkflowRuns(workflows);
  const writingWorkflowRevision = getWritingWorkflowContentRevision(workflows);
  const placementWorkflowRevision =
    getWorkflowContentRevision(placementWorkflow);
  const isDirty = novelText !== savedText;
  async function startOriginal(input: AdaptationRequest) {
    setIsActing(true);
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(snapshot.project.id)}/episodes/${encodeURIComponent(episode.id)}/original`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "续写任务提交失败");
      toast.success(locale === "en" ? "Original episode writing queued. See Tasks for progress." : "本集续写已提交，可在任务中查看进度。");
      await onRefresh();
    } catch (error) { toast.error(error instanceof Error ? error.message : "续写任务提交失败"); }
    finally { setIsActing(false); }
  }

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
  }, [
    copy.loadFailed,
    episode.id,
    snapshot.project.id,
    sourceRevision,
    writingWorkflowRevision,
  ]);

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
  }, [
    copy.loadFailed,
    episode.id,
    placementWorkflowRevision,
    writingWorkflowRevision,
    snapshot.project.id,
  ]);

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

  const activeProductionSource = sourceCatalog?.sources.find(source => source.id === sourceCatalog.activeSourceId);
  const isPackageSource = Boolean(activeProductionSource?.instructions?.startsWith("策划包 "));
  const hasStructuredScript = clips.length > 0 && clips.every(clip => Boolean(clip.screenplay));
  async function reusePackage() {
    setIsActing(true);
    try {
      const response = await fetch(`/api/projects/${snapshot.project.id}/episodes/${episode.id}/reuse-package`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message);
      const production = await loadStudioProductionData(snapshot.project.id, episode.id);
      setClips(production.clips);
      if (!result.synced && !production.clips.length) {
        toast.info(locale === "en" ? "The active script or downstream work has changed. Existing work was preserved; organize the current script if needed." : "当前制作稿或下游记录已变化，已保留现有工作；请按当前剧本整理场次。");
      } else {
        toast.success(locale === "en" ? "Existing package material is available; review the storyboard draft." : "已有制作内容已保留或同步，请在分镜页检查并确认草案。");
      }
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally { setIsActing(false); }
  }

  const sourceKind = tab === "adapted" ? "adapted" : "original";
  const sourceVersions = (sourceCatalog?.sources ?? []).filter(
    (source) => source.kind === sourceKind,
  );
  const selectedSource =
    sourceVersions.find(
      (source) => source.id === selectedSourceIds[sourceKind],
    ) ??
    sourceVersions.find(
      (source) => source.id === sourceCatalog?.activeSourceId,
    ) ??
    sourceVersions[0];
  const selectedSourceIsActive =
    Boolean(selectedSource) &&
    selectedSource?.id === sourceCatalog?.activeSourceId;
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
      phase: "generating",
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
      onPhase: (phase) =>
        setAdaptationDraft((current) =>
          current?.episodeId === requestEpisodeId
            ? { ...current, status: "running", phase, error: undefined }
            : current,
        ),
      onWorkflowStarted: () => {
        void onRefresh();
      },
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
    if (hasStructuredScript && !window.confirm(locale === "en" ? "Reorganize the existing screenplay? This updates structured scenes; downstream production must be reviewed." : "已有结构化剧本。确定重新整理？场次结构会更新，下游分镜需要重新核对。")) return;
    if (!savedText.trim() || isDirty) return;
    const model = models.find((item) => item.id === analysisModelId);
    if (!model) {
      toast.error(
        locale === "en"
          ? "Select an analysis model first"
          : "请先选择用于 AI 整理的分析模型",
      );
      return;
    }
    setIsActing(true);
    try {
      const result = await startStoryToScriptWorkflow(
        snapshot.project.id,
        episode.id,
        {
          locale: locale === "en" ? "en" : "zh",
          channelId: model.channelId,
          model: model.modelId,
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
    runId: string,
    action: "cancel" | "retry" | "pause" | "resume",
  ) {
    setIsActing(true);
    try {
      await controlStudioWorkflow(runId, action);
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsActing(false);
    }
  }

  const workflowActive = [adaptationWorkflow, placementWorkflow].some(
    (current) =>
      current &&
      ["queued", "running", "canceling", "paused"].includes(current.status),
  );

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
          <Badge variant="outline">
            {copy.episodeTargetDuration.replace(
              "{seconds}",
              String(snapshot.project.config.episodeTargetDurationSeconds),
            )}
          </Badge>
          {tab !== "screenplay" ? (
            <>
              <span className="font-mono">
                {displayedTextLength.toLocaleString()} {copy.wordCount}
              </span>
              <span aria-hidden>·</span>
              <span>
                {adaptationDraft?.episodeId === episode.id && tab === "adapted"
                  ? adaptationDraft.status === "running"
                    ? adaptationPhaseLabel(copy, adaptationDraft.phase)
                    : copy.adaptationFailed
                  : selectedSourceIsActive
                    ? isDirty
                      ? copy.unsavedChanges
                      : copy.productionSource
                    : copy.sourceReadOnly}
              </span>
              {selectedSourceIsActive &&
              !(
                tab === "adapted" && adaptationDraft?.episodeId === episode.id
              ) ? (
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
                originalContinuation={canContinueOriginal}
                hasProductionScript={Boolean(savedText.trim()) && episode.activeSourceKind === "adapted"}
                defaultModelId={analysisModelId}
                disabled={
                  isSaving ||
                  isActing ||
                  workflowActive ||
                  adaptationDraft?.status === "running" ||
                  (!sourceCatalog?.sources.length && !canContinueOriginal)
                }
                locale={locale}
                models={models}
                onStart={canContinueOriginal ? input => void startOriginal(input) : startAdaptation}
              />
            </>
          ) : null}
        </div>
      </header>

      <div className="grid min-w-0 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_19rem] xl:overflow-hidden">
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
                {
                  (sourceCatalog?.sources ?? []).filter(
                    (source) => source.kind === "original",
                  ).length
                }
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="adapted">
              <FilePenLine className="size-4" />
              {copy.adaptedSource}
              <Badge className="ml-1" variant="secondary">
                {
                  (sourceCatalog?.sources ?? []).filter(
                    (source) => source.kind === "adapted",
                  ).length
                }
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
              versions.find((item) => item.id === selectedSourceIds[kind]) ??
              versions.find(
                (item) => item.id === sourceCatalog?.activeSourceId,
              ) ??
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
                    kind === "adapted" &&
                    adaptationDraft?.episodeId === episode.id
                      ? adaptationDraft
                      : null
                  }
                  displayedText={isActive ? novelText : (source?.content ?? "")}
                  isActivating={isActivatingSource}
                  isLoading={isLoadingSources}
                  isSaving={isSaving}
                  kind={kind}
                  locale={locale}
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
          <TabsContent
            className="mt-4 xl:min-h-0 xl:overflow-y-auto"
            value="screenplay"
          >
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

        <WritingFlowPanel
          hasProductionScript={Boolean(savedText.trim()) && episode.activeSourceKind === "adapted"}
          hasStructuredScript={hasStructuredScript}
          isPackageSource={isPackageSource}
          onReusePackage={() => void reusePackage()}
          canReusePackage={!isDirty && !isLoadingClips}
          analysisModelId={analysisModelId}
          models={models}
          onAnalysisModelChange={onAnalysisModelChange}
          adaptationWorkflow={adaptationWorkflow}
          canStartPlacement={
            Boolean(savedText.trim()) &&
            !isDirty &&
            models.some((model) => model.id === analysisModelId)
          }
          isActing={isActing}
          locale={locale}
          onControl={(runId, action) => void controlWorkflow(runId, action)}
          onStartPlacement={() => void startWorkflow()}
          placementWorkflow={placementWorkflow}
        />
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
        <Select
          onValueChange={(value) => value && onSelect(value)}
          value={source.id}
        >
          <SelectTrigger className="h-8 w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {versions.map((version) => (
              <SelectItem key={version.id} value={version.id}>
                {copy.sourceVersion} {version.version} ·{" "}
                {formatStudioDate(locale, version.createdAt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Badge variant="outline">
            {kind === "adapted" ? copy.adaptedSource : copy.originalSource} v
            {source.version}
          </Badge>
          {isActive ? <Badge>{copy.productionSource}</Badge> : null}
          {!isActive ? (
            <Button
              disabled={isActivating || workflowActive}
              onClick={() => onActivate(source)}
              size="sm"
              type="button"
            >
              {isActivating ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}
              {copy.setProductionSource}
            </Button>
          ) : null}
        </div>
      </div>

      {kind === "adapted" && (source.title || source.summary) ? (
        <div className="border-b py-3 text-sm">
          {source.title ? (
            <p className="font-medium leading-6">{source.title}</p>
          ) : null}
          {source.summary ? (
            <p className="mt-1 line-clamp-2 leading-6 text-muted-foreground">
              {source.summary}
            </p>
          ) : null}
        </div>
      ) : null}

      <Textarea
        aria-label={
          kind === "adapted" ? copy.adaptedSource : copy.originalSource
        }
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
            ? adaptationPhaseLabel(copy, draft.phase)
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
      {draft.content ? (
        <Textarea
          aria-busy={draft.status === "running"}
          aria-label={copy.adaptedSource}
          className="mt-4 h-[min(56dvh,42rem)] min-h-80 resize-y overflow-y-auto rounded-md bg-card p-4 leading-7 field-sizing-fixed xl:min-h-0 xl:flex-1 xl:resize-none"
          readOnly
          ref={textareaRef}
          value={draft.content}
        />
      ) : (
        <div
          aria-busy={draft.status === "running"}
          className="mt-4 flex min-h-80 flex-1 items-center justify-center border-y px-6 text-center"
        >
          <div className="flex max-w-xs flex-col items-center gap-3 text-sm text-muted-foreground">
            {draft.status === "running" ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : (
              <CircleAlert className="size-5 text-destructive" />
            )}
            <p>{draft.error || copy.adaptationWaiting}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function adaptationPhaseLabel(
  copy: ReturnType<typeof getStudioCopy>,
  phase: AdaptationDraft["phase"],
) {
  if (phase === "saving") return copy.adaptationSaving;
  return copy.adaptationGenerating;
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
