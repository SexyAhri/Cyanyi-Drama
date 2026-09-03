"use client";

import { LoaderCircle, Music2, Save, Trash2, Upload, Waves } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  deleteStudioEpisodeAudioTrack,
  updateStudioEpisodeAudioTrack,
  uploadStudioEpisodeAudioTrack,
} from "../api";
import type {
  EpisodeAudioTrackRecord,
  ProjectMediaAsset,
  StudioLocale,
} from "../types";

const copy = {
  "zh-CN": {
    title: "环境音、音效与配乐",
    empty: "尚未添加独立声音素材",
    upload: "上传音轨",
    trackType: "类型",
    audioFile: "音频文件",
    noAudio: "音频素材不可用",
    ambience: "环境音",
    sfx: "音效",
    music: "配乐",
    startTime: "开始（秒）",
    endTime: "结束（秒）",
    endOptional: "至片尾",
    volume: "音量",
    loop: "循环",
    save: "保存音轨",
    remove: "移除音轨",
    uploaded: "音轨已添加",
    saved: "音轨设置已保存",
    removed: "音轨已移除",
    actionFailed: "操作失败",
  },
  en: {
    title: "Ambience, effects, and music",
    empty: "No independent sound assets yet",
    upload: "Upload track",
    trackType: "Type",
    audioFile: "Audio file",
    noAudio: "Audio asset unavailable",
    ambience: "Ambience",
    sfx: "Sound effect",
    music: "Music",
    startTime: "Start (seconds)",
    endTime: "End (seconds)",
    endOptional: "To episode end",
    volume: "Volume",
    loop: "Loop",
    save: "Save track",
    remove: "Remove track",
    uploaded: "Track added",
    saved: "Track settings saved",
    removed: "Track removed",
    actionFailed: "Action failed",
  },
} as const;

type IndependentAudioTrackType = "ambience" | "sfx" | "music";

export function EpisodeAudioTracks({
  assets,
  episodeId,
  locale,
  onRefresh,
  projectId,
  tracks,
}: {
  assets: ProjectMediaAsset[];
  episodeId: string;
  locale: StudioLocale;
  onRefresh: () => Promise<unknown> | void;
  projectId: string;
  tracks: EpisodeAudioTrackRecord[];
}) {
  const text = copy[locale];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [trackType, setTrackType] =
    useState<IndependentAudioTrackType>("ambience");
  const [startSeconds, setStartSeconds] = useState("0");
  const [endSeconds, setEndSeconds] = useState("");
  const [volume, setVolume] = useState(0.35);
  const [loop, setLoop] = useState(true);
  const [uploading, setUploading] = useState(false);
  const independentTracks = tracks.filter(isIndependentAudioTrack);

  function changeTrackType(value: string) {
    if (!isIndependentAudioTrackType(value)) return;
    setTrackType(value);
    setVolume(defaultIndependentTrackVolume(value));
    setLoop(value !== "sfx");
  }

  async function uploadTrack() {
    if (!file) return;
    setUploading(true);
    try {
      await uploadStudioEpisodeAudioTrack(projectId, episodeId, {
        file,
        trackType,
        startSeconds: finiteInputValue(startSeconds, 0),
        endSeconds: optionalFiniteInputValue(endSeconds),
        volume,
        loop,
      });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.success(text.uploaded);
      await onRefresh();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : text.actionFailed,
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="py-5">
      <div className="flex items-center gap-2">
        <Waves className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{text.title}</h2>
      </div>

      <div className="mt-3 grid gap-3 border-y py-4 lg:grid-cols-[10rem_minmax(12rem,1fr)_7rem_7rem_minmax(10rem,1fr)_auto] lg:items-end">
        <AudioField label={text.trackType}>
          <NativeSelect
            className="w-full"
            disabled={uploading}
            onChange={(event) => changeTrackType(event.target.value)}
            value={trackType}
          >
            <NativeSelectOption value="ambience">
              {text.ambience}
            </NativeSelectOption>
            <NativeSelectOption value="sfx">{text.sfx}</NativeSelectOption>
            <NativeSelectOption value="music">{text.music}</NativeSelectOption>
          </NativeSelect>
        </AudioField>
        <AudioField label={text.audioFile}>
          <Input
            accept="audio/*"
            disabled={uploading}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            ref={fileInputRef}
            type="file"
          />
        </AudioField>
        <AudioField label={text.startTime}>
          <Input
            disabled={uploading}
            min={0}
            onChange={(event) => setStartSeconds(event.target.value)}
            step="0.1"
            type="number"
            value={startSeconds}
          />
        </AudioField>
        <AudioField label={text.endTime}>
          <Input
            disabled={uploading}
            min={0}
            onChange={(event) => setEndSeconds(event.target.value)}
            placeholder={text.endOptional}
            step="0.1"
            type="number"
            value={endSeconds}
          />
        </AudioField>
        <VolumeControl
          disabled={uploading}
          label={text.volume}
          onChange={setVolume}
          value={volume}
        />
        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <LoopControl
            checked={loop}
            disabled={uploading}
            label={text.loop}
            onChange={setLoop}
          />
          <Button
            disabled={uploading || !file}
            onClick={() => void uploadTrack()}
            size="sm"
          >
            {uploading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {text.upload}
          </Button>
        </div>
      </div>

      {independentTracks.length ? (
        <div className="divide-y">
          {independentTracks.map((track) => (
            <AudioTrackEditor
              asset={
                track.assetId
                  ? assets.find((item) => item.id === track.assetId)
                  : undefined
              }
              episodeId={episodeId}
              key={track.id}
              locale={locale}
              onRefresh={onRefresh}
              projectId={projectId}
              track={track}
            />
          ))}
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
          {text.empty}
        </div>
      )}
    </section>
  );
}

function AudioTrackEditor({
  asset,
  episodeId,
  locale,
  onRefresh,
  projectId,
  track,
}: {
  asset?: ProjectMediaAsset;
  episodeId: string;
  locale: StudioLocale;
  onRefresh: () => Promise<unknown> | void;
  projectId: string;
  track: EpisodeAudioTrackRecord;
}) {
  const text = copy[locale];
  const [startSeconds, setStartSeconds] = useState(
    String(track.startSeconds ?? 0),
  );
  const [endSeconds, setEndSeconds] = useState(
    track.endSeconds === null ? "" : String(track.endSeconds),
  );
  const [volume, setVolume] = useState(track.volume ?? 1);
  const [loop, setLoop] = useState(track.metadata.loop === true);
  const [pendingAction, setPendingAction] = useState<"save" | "remove" | null>(
    null,
  );

  useEffect(() => {
    setStartSeconds(String(track.startSeconds ?? 0));
    setEndSeconds(track.endSeconds === null ? "" : String(track.endSeconds));
    setVolume(track.volume ?? 1);
    setLoop(track.metadata.loop === true);
  }, [track]);

  async function saveTrack() {
    setPendingAction("save");
    try {
      await updateStudioEpisodeAudioTrack(projectId, episodeId, {
        id: track.id,
        startSeconds: finiteInputValue(startSeconds, 0),
        endSeconds: optionalFiniteInputValue(endSeconds),
        volume,
        loop,
      });
      toast.success(text.saved);
      await onRefresh();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : text.actionFailed,
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function removeTrack() {
    setPendingAction("remove");
    try {
      await deleteStudioEpisodeAudioTrack(projectId, episodeId, track.id);
      toast.success(text.removed);
      await onRefresh();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : text.actionFailed,
      );
    } finally {
      setPendingAction(null);
    }
  }

  const trackType = track.trackType as IndependentAudioTrackType;
  const fileName =
    typeof track.metadata.fileName === "string"
      ? track.metadata.fileName
      : text.audioFile;
  const disabled = pendingAction !== null;

  return (
    <div className="grid gap-4 py-4 xl:grid-cols-[12rem_minmax(14rem,1fr)_7rem_7rem_minmax(10rem,1fr)_auto] xl:items-end">
      <div className="min-w-0 self-center">
        <div className="flex items-center gap-2">
          {trackType === "music" ? (
            <Music2 className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <Waves className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{text[trackType]}</span>
        </div>
        <p
          className="mt-1 truncate text-xs text-muted-foreground"
          title={fileName}
        >
          {fileName}
        </p>
      </div>
      <div className="flex min-h-8 items-center">
        {asset?.url ? (
          <audio
            className="h-8 w-full"
            controls
            preload="metadata"
            src={asset.url}
          />
        ) : (
          <span className="text-xs text-muted-foreground">{text.noAudio}</span>
        )}
      </div>
      <AudioField label={text.startTime}>
        <Input
          disabled={disabled}
          min={0}
          onChange={(event) => setStartSeconds(event.target.value)}
          step="0.1"
          type="number"
          value={startSeconds}
        />
      </AudioField>
      <AudioField label={text.endTime}>
        <Input
          disabled={disabled}
          min={0}
          onChange={(event) => setEndSeconds(event.target.value)}
          placeholder={text.endOptional}
          step="0.1"
          type="number"
          value={endSeconds}
        />
      </AudioField>
      <VolumeControl
        disabled={disabled}
        label={text.volume}
        onChange={setVolume}
        value={volume}
      />
      <div className="flex items-center justify-between gap-1 xl:justify-end">
        <LoopControl
          checked={loop}
          disabled={disabled}
          label={text.loop}
          onChange={setLoop}
        />
        <TrackIconAction
          busy={pendingAction === "save"}
          disabled={disabled}
          icon={<Save className="size-3.5" />}
          label={text.save}
          onClick={() => void saveTrack()}
        />
        <TrackIconAction
          busy={pendingAction === "remove"}
          className="text-destructive hover:text-destructive"
          disabled={disabled}
          icon={<Trash2 className="size-3.5" />}
          label={text.remove}
          onClick={() => void removeTrack()}
        />
      </div>
    </div>
  );
}

function VolumeControl({
  disabled,
  label,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs font-medium">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">
          {Math.round(value * 100)}%
        </span>
      </div>
      <div className="flex h-8 items-center px-1">
        <Slider
          aria-label={label}
          disabled={disabled}
          max={2}
          min={0}
          onValueChange={(next) =>
            onChange(Array.isArray(next) ? (next[0] ?? 0) : next)
          }
          step={0.05}
          value={value}
        />
      </div>
    </div>
  );
}

function LoopControl({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="mr-2 flex items-center gap-2 text-sm">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
      {label}
    </label>
  );
}

function TrackIconAction({
  busy,
  className,
  disabled,
  icon,
  label,
  onClick,
}: {
  busy: boolean;
  className?: string;
  disabled: boolean;
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
            className={className}
            disabled={disabled}
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

function AudioField({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-medium">
      {label}
      {children}
    </label>
  );
}

function isIndependentAudioTrack(
  track: EpisodeAudioTrackRecord,
): track is EpisodeAudioTrackRecord & { trackType: IndependentAudioTrackType } {
  return isIndependentAudioTrackType(track.trackType);
}

function isIndependentAudioTrackType(
  value: string,
): value is IndependentAudioTrackType {
  return value === "ambience" || value === "sfx" || value === "music";
}

function defaultIndependentTrackVolume(trackType: IndependentAudioTrackType) {
  return trackType === "music" ? 0.2 : trackType === "ambience" ? 0.35 : 0.8;
}

function finiteInputValue(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalFiniteInputValue(value: string) {
  if (!value.trim()) return null;
  return finiteInputValue(value, 0);
}
