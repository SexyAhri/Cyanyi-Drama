"use client";

import {
  AudioLines,
  Ban,
  Download,
  LoaderCircle,
  Merge,
  RotateCcw,
  Save,
  Sparkles,
  Video,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MediaTask } from "@/lib/media/task-contract";
import { cn } from "@/lib/utils";

import {
  analyzeStudioVoiceLines,
  controlStudioMediaTask,
  createStudioVoicePreset,
  generateStudioLipSync,
  generateStudioVoiceLine,
  generateStudioVoiceLineBatch,
  loadStudioProductionData,
  loadStudioProjectAssets,
  loadStudioStoryboard,
  loadStudioVoicePresets,
  mergeStudioEpisodeAudio,
  updateStudioVoiceLine,
} from "../api";
import { ModelSelect } from "../components/model-select";
import { StatusIndicator } from "../components/status-indicator";
import { runtimeStatusToStageStatus } from "../stage-state";
import type {
  ProductionData,
  ProjectMediaAsset,
  StudioLocale,
  StudioModelOption,
  StudioSelectionContext,
  StudioStoryboardData,
  VoiceLineRecord,
  VoicePresetRecord,
  WorkspaceSnapshot,
} from "../types";
import {
  latestFailedVoiceTasks,
  latestVoiceTask,
  voiceLineAsset,
} from "./audio-view-model";
import { VoicePresetDialog } from "./voice-preset-dialog";

const copy = {
  "zh-CN": {
    title: "声音制作",
    analyze: "分析台词",
    analysisModel: "分析模型",
    audioModel: "语音模型",
    lipModel: "口型模型",
    noLines: "还没有台词",
    noLinesDetail: "从当前剧本分析角色与台词后，可在这里编辑和生成语音。",
    noAudioModel: "没有可用的语音模型",
    lines: "台词",
    selected: "已选择",
    generateSelected: "生成所选",
    retryFailed: "重试失败项",
    merge: "合并音轨",
    speaker: "角色",
    content: "台词内容",
    voice: "音色",
    noVoice: "未绑定音色",
    panel: "关联镜头",
    noPanel: "未关联镜头",
    emotion: "情绪提示",
    strength: "情绪强度",
    save: "保存台词",
    generate: "生成语音",
    audioPreview: "语音预览",
    noAudio: "尚未生成语音",
    mergedAudio: "整集音轨",
    noMergedAudio: "尚未合并整集音轨",
    lipSync: "口型同步",
    generateLip: "生成口型",
    noLip: "尚未生成口型视频",
    download: "下载",
    cancel: "取消任务",
    retry: "重试任务",
    loadFailed: "声音数据载入失败",
    saved: "台词已保存",
    submitted: "任务已提交",
    created: "音色已创建",
    tasksRetried: "已重试 {count} 个失败任务",
    actionFailed: "操作失败",
  },
  en: {
    title: "Audio production",
    analyze: "Analyze dialogue",
    analysisModel: "Analysis model",
    audioModel: "Speech model",
    lipModel: "Lip sync model",
    noLines: "No dialogue yet",
    noLinesDetail:
      "Analyze the current script to edit dialogue and generate speech here.",
    noAudioModel: "No speech model is available",
    lines: "Dialogue",
    selected: "selected",
    generateSelected: "Generate selected",
    retryFailed: "Retry failed",
    merge: "Merge audio",
    speaker: "Speaker",
    content: "Dialogue",
    voice: "Voice",
    noVoice: "No voice assigned",
    panel: "Linked shot",
    noPanel: "No linked shot",
    emotion: "Emotion",
    strength: "Emotion strength",
    save: "Save dialogue",
    generate: "Generate speech",
    audioPreview: "Speech preview",
    noAudio: "No speech generated",
    mergedAudio: "Episode mix",
    noMergedAudio: "No episode mix yet",
    lipSync: "Lip sync",
    generateLip: "Generate lip sync",
    noLip: "No lip sync video yet",
    download: "Download",
    cancel: "Cancel task",
    retry: "Retry task",
    loadFailed: "Unable to load audio data",
    saved: "Dialogue saved",
    submitted: "Task submitted",
    created: "Voice created",
    tasksRetried: "Retried {count} failed tasks",
    actionFailed: "Action failed",
  },
} as const;

type AudioData = {
  production: ProductionData;
  presets: VoicePresetRecord[];
  storyboard: StudioStoryboardData;
  assets: ProjectMediaAsset[];
};

export function AudioWorkspace({
  analysisModels,
  audioModels,
  episode,
  lipSyncModels,
  locale,
  onContextChange,
  onRefresh,
  snapshot,
}: {
  analysisModels: StudioModelOption[];
  audioModels: StudioModelOption[];
  episode: WorkspaceSnapshot["project"]["episodes"][number];
  lipSyncModels: StudioModelOption[];
  locale: StudioLocale;
  onContextChange: (selection?: StudioSelectionContext) => void;
  onRefresh: () => Promise<unknown> | void;
  snapshot: WorkspaceSnapshot;
}) {
  const text = copy[locale];
  const projectId = snapshot.project.id;
  const [data, setData] = useState<AudioData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState("");
  const [selectedLineId, setSelectedLineId] = useState("");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [analysisModelId, setAnalysisModelId] = useState("");
  const [audioModelId, setAudioModelId] = useState("");
  const [lipModelId, setLipModelId] = useState("");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const [production, presetResult, storyboard, assets] =
          await Promise.all([
            loadStudioProductionData(projectId, episode.id, signal),
            loadStudioVoicePresets(projectId, signal),
            loadStudioStoryboard(projectId, episode.id, signal),
            loadStudioProjectAssets(projectId, signal),
          ]);
        const next = {
          production,
          presets: presetResult.presets,
          storyboard,
          assets,
        };
        if (!signal?.aborted) setData(next);
        return next;
      } catch (requestError) {
        if (!signal?.aborted)
          setError(
            requestError instanceof Error
              ? requestError.message
              : text.loadFailed,
          );
        return null;
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [episode.id, projectId, text.loadFailed],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    setAnalysisModelId((current) =>
      analysisModels.some((model) => model.id === current)
        ? current
        : (analysisModels[0]?.id ?? ""),
    );
    setAudioModelId((current) => {
      if (audioModels.some((model) => model.id === current)) return current;
      const configured = audioModels.find(
        (model) => model.modelId === snapshot.project.config.audioModel,
      );
      return configured?.id ?? audioModels[0]?.id ?? "";
    });
    setLipModelId((current) =>
      lipSyncModels.some((model) => model.id === current)
        ? current
        : (lipSyncModels[0]?.id ?? ""),
    );
  }, [
    analysisModels,
    audioModels,
    lipSyncModels,
    snapshot.project.config.audioModel,
  ]);

  const lines = useMemo(
    () => data?.production.voiceLines ?? [],
    [data?.production.voiceLines],
  );
  const panels = data?.storyboard.storyboard?.panels ?? [];
  const tasks = snapshot.tasks.filter((task) => task.episodeId === episode.id);
  const selectedLine =
    lines.find((line) => line.id === selectedLineId) ?? lines[0];

  useEffect(() => {
    onContextChange(
      selectedLine
        ? {
            id: selectedLine.id,
            kind: "voice_line",
            label: `${selectedLine.speaker} · ${selectedLine.content}`,
            metadata: { lineIndex: selectedLine.lineIndex },
          }
        : undefined,
    );
  }, [onContextChange, selectedLine]);

  useEffect(() => {
    if (!lines.length) return setSelectedLineId("");
    if (!lines.some((line) => line.id === selectedLineId))
      setSelectedLineId(lines[0].id);
  }, [lines, selectedLineId]);

  async function refreshAll() {
    await Promise.all([load(), onRefresh()]);
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await refreshAll();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : text.actionFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    const model = analysisModels.find((item) => item.id === analysisModelId);
    if (!model) return;
    await run(
      () =>
        analyzeStudioVoiceLines(projectId, episode.id, {
          channelId: model.channelId,
          model: model.modelId,
          locale: locale === "en" ? "en" : "zh",
        }),
      text.submitted,
    );
  }

  async function generateLines(lineIds: string[]) {
    const model = audioModels.find((item) => item.id === audioModelId);
    if (!model || !lineIds.length) return;
    await run(
      () =>
        lineIds.length === 1
          ? generateStudioVoiceLine(projectId, episode.id, lineIds[0], {
              channelId: model.channelId,
              model: model.modelId,
            })
          : generateStudioVoiceLineBatch(projectId, episode.id, {
              channelId: model.channelId,
              model: model.modelId,
              lineIds,
            }),
      text.submitted,
    );
  }

  async function mergeAudio() {
    const model = audioModels.find((item) => item.id === audioModelId);
    if (!model) return;
    await run(
      () =>
        mergeStudioEpisodeAudio(projectId, episode.id, {
          channelId: model.channelId,
          model: model.modelId,
        }),
      text.submitted,
    );
  }

  async function retryFailed() {
    const failed = latestFailedVoiceTasks(checkedIds, tasks);
    if (!failed.length) return;
    setBusy(true);
    try {
      await Promise.all(
        failed.map((task) => controlStudioMediaTask(task.id, "retry")),
      );
      toast.success(
        text.tasksRetried.replace("{count}", String(failed.length)),
      );
      await refreshAll();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : text.actionFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  async function controlTask(task: MediaTask, action: "cancel" | "retry") {
    setBusyTaskId(task.id);
    try {
      await controlStudioMediaTask(task.id, action);
      await refreshAll();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error
          ? requestError.message
          : text.actionFailed,
      );
    } finally {
      setBusyTaskId("");
    }
  }

  async function createPreset(
    input: Parameters<typeof createStudioVoicePreset>[1],
  ) {
    await createStudioVoicePreset(projectId, input);
    toast.success(text.created);
    await load();
  }

  if (loading && !data)
    return (
      <div className="flex min-h-96 items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-7 sm:py-7">
      <header className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {String(episode.episodeNumber).padStart(2, "0")} · {episode.name}
          </p>
          <h1 className="mt-1 text-xl font-semibold">{text.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {!lines.length ? (
            <div className="flex min-w-56 items-end gap-2">
              <label className="grid min-w-0 flex-1 gap-1 text-xs font-medium">
                {text.analysisModel}
                <ModelSelect
                  disabled={busy}
                  models={analysisModels}
                  onChange={setAnalysisModelId}
                  placeholder={text.analysisModel}
                  value={analysisModelId}
                />
              </label>
              <Button
                disabled={busy || !analysisModelId}
                onClick={analyze}
                size="sm"
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {text.analyze}
              </Button>
            </div>
          ) : null}
          <VoicePresetDialog locale={locale} onCreate={createPreset} />
        </div>
      </header>

      {error ? (
        <div className="flex items-center justify-between gap-3 border-b py-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button onClick={() => void load()} size="sm" variant="outline">
            <RotateCcw className="size-4" />
            {text.retry}
          </Button>
        </div>
      ) : null}

      {lines.length ? (
        <div className="flex flex-col gap-3 border-b py-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
          <label className="grid min-w-0 gap-1 text-xs font-medium sm:w-72">
            {text.audioModel}
            <ModelSelect
              disabled={busy}
              models={audioModels}
              onChange={setAudioModelId}
              placeholder={text.audioModel}
              value={audioModelId}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !checkedIds.length || !audioModelId}
              onClick={() => void generateLines(checkedIds)}
              size="sm"
            >
              <Volume2 className="size-4" />
              {text.generateSelected}
            </Button>
            <Button
              disabled={
                busy || !latestFailedVoiceTasks(checkedIds, tasks).length
              }
              onClick={() => void retryFailed()}
              size="sm"
              variant="outline"
            >
              <RotateCcw className="size-4" />
              {text.retryFailed}
            </Button>
            <Button
              disabled={
                busy ||
                !audioModelId ||
                !lines.some((line) => line.audioAssetId)
              }
              onClick={() => void mergeAudio()}
              size="sm"
              variant="outline"
            >
              <Merge className="size-4" />
              {text.merge}
            </Button>
          </div>
        </div>
      ) : null}

      {!lines.length ? (
        <div className="flex min-h-96 flex-col items-center justify-center gap-2 border-b text-center text-muted-foreground">
          <AudioLines className="size-6" />
          <h2 className="text-sm font-medium text-foreground">
            {text.noLines}
          </h2>
          <p className="max-w-md text-sm leading-6">{text.noLinesDetail}</p>
        </div>
      ) : (
        <div className="grid min-h-160 border-b 2xl:grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="border-b 2xl:border-r 2xl:border-b-0">
            <div className="flex h-11 items-center justify-between border-b px-3 text-xs font-semibold">
              <span>{text.lines}</span>
              <span className="text-muted-foreground">
                {checkedIds.length} {text.selected}
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto p-1.5 2xl:max-h-[calc(100dvh-17rem)]">
              {lines.map((line) => {
                const task = latestVoiceTask(line.id, tasks);
                const checked = checkedIds.includes(line.id);
                return (
                  <div
                    className={cn(
                      "flex items-start gap-2 rounded-md px-2 py-1",
                      selectedLine?.id === line.id && "bg-muted",
                    )}
                    key={line.id}
                  >
                    <Checkbox
                      aria-label={`${text.lines} ${line.lineIndex + 1}`}
                      checked={checked}
                      className="mt-3"
                      onCheckedChange={(next) =>
                        setCheckedIds((current) =>
                          next
                            ? [...new Set([...current, line.id])]
                            : current.filter((id) => id !== line.id),
                        )
                      }
                    />
                    <button
                      className="min-w-0 flex-1 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      onClick={() => setSelectedLineId(line.id)}
                      type="button"
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {line.speaker}
                        </span>
                        {task ? (
                          <StatusIndicator
                            compact
                            locale={locale}
                            status={runtimeStatusToStageStatus(task.status)}
                          />
                        ) : null}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {line.content}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </aside>

          {selectedLine && data ? (
            <VoiceLineDetails
              assets={data.assets}
              audioModel={audioModels.find((item) => item.id === audioModelId)}
              busy={busy}
              busyTaskId={busyTaskId}
              line={selectedLine}
              lipModel={lipSyncModels.find((item) => item.id === lipModelId)}
              lipModels={lipSyncModels}
              lipModelId={lipModelId}
              locale={locale}
              onControlTask={controlTask}
              onGenerate={() => generateLines([selectedLine.id])}
              onLipModelChange={setLipModelId}
              onRun={run}
              panels={panels}
              presets={data.presets}
              projectId={projectId}
              episodeId={episode.id}
              setData={setData}
              tasks={tasks}
            />
          ) : null}
        </div>
      )}

      {data ? (
        <MergedAudio
          assets={data.assets}
          audioTracks={data.production.audioTracks}
          busyTaskId={busyTaskId}
          locale={locale}
          onControlTask={controlTask}
          tasks={tasks}
        />
      ) : null}
    </div>
  );
}

function VoiceLineDetails({
  assets,
  audioModel,
  busy,
  busyTaskId,
  episodeId,
  line,
  lipModel,
  lipModelId,
  lipModels,
  locale,
  onControlTask,
  onGenerate,
  onLipModelChange,
  onRun,
  panels,
  presets,
  projectId,
  setData,
  tasks,
}: {
  assets: ProjectMediaAsset[];
  audioModel?: StudioModelOption;
  busy: boolean;
  busyTaskId: string;
  episodeId: string;
  line: VoiceLineRecord;
  lipModel?: StudioModelOption;
  lipModelId: string;
  lipModels: StudioModelOption[];
  locale: StudioLocale;
  onControlTask: (task: MediaTask, action: "cancel" | "retry") => Promise<void>;
  onGenerate: () => Promise<void>;
  onLipModelChange: (value: string) => void;
  onRun: (action: () => Promise<unknown>, success: string) => Promise<void>;
  panels: NonNullable<StudioStoryboardData["storyboard"]>["panels"];
  presets: VoicePresetRecord[];
  projectId: string;
  setData: React.Dispatch<React.SetStateAction<AudioData | null>>;
  tasks: MediaTask[];
}) {
  const text = copy[locale];
  const [speaker, setSpeaker] = useState(line.speaker);
  const [content, setContent] = useState(line.content);
  const [presetId, setPresetId] = useState(line.voicePresetId ?? "");
  const [panelId, setPanelId] = useState(line.matchedPanelId ?? "");
  const [emotion, setEmotion] = useState(line.emotionPrompt ?? "");
  const [strength, setStrength] = useState(line.emotionStrength ?? 0.5);

  useEffect(() => {
    setSpeaker(line.speaker);
    setContent(line.content);
    setPresetId(line.voicePresetId ?? "");
    setPanelId(line.matchedPanelId ?? "");
    setEmotion(line.emotionPrompt ?? "");
    setStrength(line.emotionStrength ?? 0.5);
  }, [line]);

  const voiceTask = latestVoiceTask(line.id, tasks);
  const audio = voiceLineAsset(line, tasks, assets);
  const panel = panels.find((item) => item.id === panelId);
  const lipTask = tasks
    .filter(
      (task) => task.targetType === "lip_sync" && task.targetId === panelId,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const lipAsset = panel?.lipSyncAssetId
    ? assets.find((asset) => asset.id === panel.lipSyncAssetId)
    : undefined;
  const lipOutput =
    lipTask?.status === "succeeded" ? lipTask.output?.[0] : undefined;

  async function saveLine() {
    await onRun(async () => {
      const result = await updateStudioVoiceLine(projectId, episodeId, {
        lineId: line.id,
        speaker,
        content,
        voicePresetId: presetId || null,
        matchedPanelId: panelId || null,
        emotionPrompt: emotion || null,
        emotionStrength: strength,
      });
      setData((current) =>
        current
          ? {
              ...current,
              production: {
                ...current.production,
                voiceLines: current.production.voiceLines.map((item) =>
                  item.id === line.id ? result.voiceLine : item,
                ),
              },
            }
          : current,
      );
    }, text.saved);
  }

  async function generateLip() {
    if (!lipModel || !panel || !audio?.id) return;
    await onRun(
      () =>
        generateStudioLipSync(projectId, episodeId, {
          channelId: lipModel.channelId,
          model: lipModel.modelId,
          panelId: panel.id,
          audioAssetId: audio.id,
        }),
      text.submitted,
    );
  }

  return (
    <section className="min-w-0 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-3 border-b pb-4">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">
            {String(line.lineIndex + 1).padStart(2, "0")}
          </p>
          <h2 className="truncate text-base font-semibold">{line.speaker}</h2>
        </div>
        <Button
          disabled={busy || !speaker.trim() || !content.trim()}
          onClick={() => void saveLine()}
          size="sm"
          variant="outline"
        >
          <Save className="size-4" />
          {text.save}
        </Button>
      </header>

      <div className="grid gap-4 border-b py-5 sm:grid-cols-2">
        <Field label={text.speaker}>
          <Input
            onChange={(event) => setSpeaker(event.target.value)}
            value={speaker}
          />
        </Field>
        <Field label={text.voice}>
          <NativeSelect
            className="w-full"
            onChange={(event) => setPresetId(event.target.value)}
            value={presetId}
          >
            <NativeSelectOption value="">{text.noVoice}</NativeSelectOption>
            {presets.map((preset) => (
              <NativeSelectOption key={preset.id} value={preset.id}>
                {preset.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field label={text.panel}>
          <NativeSelect
            className="w-full"
            onChange={(event) => setPanelId(event.target.value)}
            value={panelId}
          >
            <NativeSelectOption value="">{text.noPanel}</NativeSelectOption>
            {panels.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {String(item.panelIndex + 1).padStart(2, "0")} ·{" "}
                {item.shotType || item.description || text.panel}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field label={text.strength}>
          <Input
            max={1}
            min={0}
            onChange={(event) => setStrength(Number(event.target.value))}
            step={0.1}
            type="number"
            value={strength}
          />
        </Field>
        <Field className="sm:col-span-2" label={text.content}>
          <Textarea
            className="min-h-24"
            onChange={(event) => setContent(event.target.value)}
            value={content}
          />
        </Field>
        <Field className="sm:col-span-2" label={text.emotion}>
          <Input
            onChange={(event) => setEmotion(event.target.value)}
            value={emotion}
          />
        </Field>
      </div>

      <div className="grid gap-5 py-5 2xl:grid-cols-2">
        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{text.audioPreview}</h3>
            <Button
              disabled={busy || !audioModel}
              onClick={() => void onGenerate()}
              size="sm"
            >
              <Volume2 className="size-4" />
              {text.generate}
            </Button>
          </div>
          <MediaCard
            busyTaskId={busyTaskId}
            empty={text.noAudio}
            kind="audio"
            locale={locale}
            onTaskAction={onControlTask}
            task={voiceTask}
            url={audio?.url ?? undefined}
          />
        </section>

        <section>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <label className="grid min-w-0 flex-1 gap-1 text-xs font-medium">
              {text.lipModel}
              <ModelSelect
                models={lipModels}
                onChange={onLipModelChange}
                placeholder={text.lipModel}
                value={lipModelId}
              />
            </label>
            <Button
              disabled={busy || !lipModel || !panel || !audio?.id}
              onClick={() => void generateLip()}
              size="sm"
              variant="outline"
            >
              <Video className="size-4" />
              {text.generateLip}
            </Button>
          </div>
          <MediaCard
            busyTaskId={busyTaskId}
            empty={text.noLip}
            kind="video"
            locale={locale}
            onTaskAction={onControlTask}
            task={lipTask}
            url={lipAsset?.url ?? lipOutput?.url}
          />
        </section>
      </div>
    </section>
  );
}

function MergedAudio({
  assets,
  audioTracks,
  busyTaskId,
  locale,
  onControlTask,
  tasks,
}: {
  assets: ProjectMediaAsset[];
  audioTracks: ProductionData["audioTracks"];
  busyTaskId: string;
  locale: StudioLocale;
  onControlTask: (task: MediaTask, action: "cancel" | "retry") => Promise<void>;
  tasks: MediaTask[];
}) {
  const text = copy[locale];
  const track = audioTracks.find((item) => item.trackType === "merged");
  const asset = track?.assetId
    ? assets.find((item) => item.id === track.assetId)
    : undefined;
  const task = tasks
    .filter((item) => item.targetType === "episode_audio")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const output = task?.status === "succeeded" ? task.output?.[0] : undefined;
  return (
    <section className="py-5">
      <h2 className="mb-2 text-sm font-semibold">{text.mergedAudio}</h2>
      <MediaCard
        busyTaskId={busyTaskId}
        empty={text.noMergedAudio}
        kind="audio"
        locale={locale}
        onTaskAction={onControlTask}
        task={task}
        url={asset?.url ?? output?.url}
      />
    </section>
  );
}

function MediaCard({
  busyTaskId,
  empty,
  kind,
  locale,
  onTaskAction,
  task,
  url,
}: {
  busyTaskId: string;
  empty: string;
  kind: "audio" | "video";
  locale: StudioLocale;
  onTaskAction: (task: MediaTask, action: "cancel" | "retry") => void;
  task?: MediaTask;
  url?: string | null;
}) {
  const text = copy[locale];
  const active = task && ["queued", "running"].includes(task.status);
  return (
    <figure className="overflow-hidden rounded-md border bg-card">
      <div
        className={cn(
          "flex items-center justify-center bg-muted/30",
          kind === "video" ? "aspect-video" : "h-24 px-4",
        )}
      >
        {url && kind === "audio" ? (
          <audio className="w-full" controls preload="metadata" src={url} />
        ) : url && kind === "video" ? (
          <video
            className="size-full object-contain"
            controls
            preload="metadata"
            src={url}
          />
        ) : active ? (
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <span className="text-sm text-muted-foreground">{empty}</span>
        )}
      </div>
      <figcaption className="flex min-h-11 items-center gap-2 border-t px-2.5 py-1.5">
        {task ? (
          <StatusIndicator
            locale={locale}
            status={runtimeStatusToStageStatus(task.status)}
          />
        ) : (
          <StatusIndicator
            locale={locale}
            status={url ? "completed" : "not_started"}
          />
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {active ? (
            <IconAction
              busy={busyTaskId === task.id}
              icon={<Ban className="size-3.5" />}
              label={text.cancel}
              onClick={() => onTaskAction(task, "cancel")}
            />
          ) : null}
          {task?.status === "failed" ? (
            <IconAction
              busy={busyTaskId === task.id}
              icon={<RotateCcw className="size-3.5" />}
              label={text.retry}
              onClick={() => onTaskAction(task, "retry")}
            />
          ) : null}
          {url ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    aria-label={text.download}
                    className={buttonVariants({
                      size: "icon-sm",
                      variant: "ghost",
                    })}
                    download
                    href={url}
                  />
                }
              >
                <Download className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>{text.download}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </figcaption>
    </figure>
  );
}

function IconAction({
  busy,
  icon,
  label,
  onClick,
}: {
  busy: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            disabled={busy}
            onClick={onClick}
            size="icon-sm"
            type="button"
            variant="ghost"
          />
        }
      >
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function Field({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <label
      className={cn("grid min-w-0 gap-1.5 text-xs font-medium", className)}
    >
      {label}
      {children}
    </label>
  );
}
