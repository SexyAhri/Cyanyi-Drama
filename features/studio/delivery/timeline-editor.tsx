"use client";

import {
  Captions,
  Film,
  GripVertical,
  Music2,
  Volume2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import type { EditorSubtitle, EditorTimeline, StudioLocale } from "../types";
import {
  reorderTimelineTrack,
  updateTimelineDuration,
  updateTimelineTrackSettings,
} from "./delivery-view-model";

const copy = {
  "zh-CN": {
    video: "画面",
    audio: "镜头音频",
    subtitles: "字幕",
    shotDuration: "镜头时长",
    sourceStart: "源视频起点",
    volume: "镜头音量",
    transition: "镜头过渡",
    transitionDuration: "淡入淡出时长",
    cut: "直接切换",
    fade: "淡入淡出",
    noSubtitle: "无字幕",
  },
  en: {
    video: "Video",
    audio: "Clip audio",
    subtitles: "Subtitles",
    shotDuration: "Shot duration",
    sourceStart: "Source in",
    volume: "Clip volume",
    transition: "Transition",
    transitionDuration: "Fade duration",
    cut: "Cut",
    fade: "Fade in/out",
    noSubtitle: "No subtitle",
  },
} as const;

export function TimelineEditor({
  locale,
  onChange,
  onSelect,
  pixelsPerSecond,
  selectedTrackId,
  subtitles,
  timeline,
}: {
  locale: StudioLocale;
  onChange: (timeline: EditorTimeline) => void;
  onSelect: (trackId: string) => void;
  pixelsPerSecond: number;
  selectedTrackId: string;
  subtitles: EditorSubtitle[];
  timeline: EditorTimeline;
}) {
  const text = copy[locale];
  const [draggedTrackId, setDraggedTrackId] = useState("");
  const tracks = timeline.tracks;
  const selectedTrack =
    tracks.find((track) => track.id === selectedTrackId) ?? tracks[0];
  const subtitlesByTrack = useMemo(
    () =>
      new Map(
        tracks.map((track) => [
          track.id,
          subtitles
            .filter(
              (subtitle) =>
                subtitle.start === track.start && subtitle.end === track.end,
            )
            .map((subtitle) => subtitle.text)
            .join(" / "),
        ]),
      ),
    [subtitles, tracks],
  );

  return (
    <section className="border-b">
      <div className="overflow-x-auto">
        <div
          className="min-w-full"
          style={{ width: Math.max(760, timeline.duration * pixelsPerSecond + 92) }}
        >
          <TimelineRow icon={<Film />} label={text.video}>
            {tracks.map((track, index) => (
              <button
                className={cn(
                  "group relative flex h-20 shrink-0 cursor-grab items-center border-r border-background/80 bg-muted/70 px-2 text-left active:cursor-grabbing",
                  selectedTrack?.id === track.id &&
                    "bg-foreground text-background ring-2 ring-inset ring-foreground",
                )}
                draggable
                key={track.id}
                onClick={() => onSelect(track.id)}
                onDragEnd={() => setDraggedTrackId("")}
                onDragOver={(event) => event.preventDefault()}
                onDragStart={() => setDraggedTrackId(track.id)}
                onDrop={() => {
                  if (draggedTrackId)
                    onChange(
                      reorderTimelineTrack(timeline, draggedTrackId, track.id),
                    );
                  setDraggedTrackId("");
                }}
                style={{ width: clipWidth(track.duration, pixelsPerSecond) }}
                type="button"
              >
                <GripVertical className="mr-1 size-3.5 shrink-0 opacity-55" />
                <span className="min-w-0">
                  <span className="block font-mono text-xs font-semibold">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="block truncate text-[10px] opacity-70">
                    {track.duration.toFixed(1)}s · {track.type}
                  </span>
                </span>
                {track.transition === "fade" ? (
                  <span className="absolute right-1 bottom-1 rounded-sm bg-background/70 px-1 text-[9px] text-foreground">
                    {text.fade}
                  </span>
                ) : null}
              </button>
            ))}
          </TimelineRow>

          <TimelineRow icon={<Music2 />} label={text.audio}>
            {tracks.map((track) => (
              <button
                className={cn(
                  "flex h-11 shrink-0 items-center border-r border-background/80 bg-status-success/15 px-2 text-left text-[10px] text-status-success",
                  selectedTrack?.id === track.id && "ring-2 ring-inset ring-foreground",
                )}
                key={track.id}
                onClick={() => onSelect(track.id)}
                style={{ width: clipWidth(track.duration, pixelsPerSecond) }}
                type="button"
              >
                <Volume2 className="mr-1 size-3 shrink-0" />
                {Math.round((track.volume ?? 1) * 100)}%
              </button>
            ))}
          </TimelineRow>

          <TimelineRow icon={<Captions />} label={text.subtitles}>
            {tracks.map((track) => (
              <button
                className={cn(
                  "h-11 shrink-0 truncate border-r border-background/80 bg-status-warning/15 px-2 text-left text-[10px]",
                  selectedTrack?.id === track.id && "ring-2 ring-inset ring-foreground",
                )}
                key={track.id}
                onClick={() => onSelect(track.id)}
                style={{ width: clipWidth(track.duration, pixelsPerSecond) }}
                title={subtitlesByTrack.get(track.id) || text.noSubtitle}
                type="button"
              >
                {subtitlesByTrack.get(track.id) || text.noSubtitle}
              </button>
            ))}
          </TimelineRow>
        </div>
      </div>

      {selectedTrack ? (
        <div className="grid gap-3 border-t px-3 py-4 sm:grid-cols-2 xl:grid-cols-5">
          <NumberField
            label={text.shotDuration}
            max={30}
            min={0.5}
            onChange={(value) =>
              onChange(updateTimelineDuration(timeline, selectedTrack.id, value))
            }
            step={0.5}
            value={selectedTrack.duration}
          />
          <NumberField
            disabled={selectedTrack.type === "image"}
            label={text.sourceStart}
            max={300}
            min={0}
            onChange={(value) =>
              onChange(
                updateTimelineTrackSettings(timeline, selectedTrack.id, {
                  sourceStart: value,
                }),
              )
            }
            step={0.1}
            value={selectedTrack.sourceStart ?? 0}
          />
          <label className="grid gap-1.5 text-xs font-medium">
            {text.volume} · {Math.round((selectedTrack.volume ?? 1) * 100)}%
            <input
              className="h-9 w-full accent-foreground"
              max={2}
              min={0}
              onChange={(event) =>
                onChange(
                  updateTimelineTrackSettings(timeline, selectedTrack.id, {
                    volume: Number(event.target.value),
                  }),
                )
              }
              step={0.05}
              type="range"
              value={selectedTrack.volume ?? 1}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {text.transition}
            <NativeSelect
              className="w-full"
              onChange={(event) =>
                onChange(
                  updateTimelineTrackSettings(timeline, selectedTrack.id, {
                    transition: event.target.value === "fade" ? "fade" : "cut",
                  }),
                )
              }
              value={selectedTrack.transition ?? "cut"}
            >
              <NativeSelectOption value="cut">{text.cut}</NativeSelectOption>
              <NativeSelectOption value="fade">{text.fade}</NativeSelectOption>
            </NativeSelect>
          </label>
          <NumberField
            disabled={(selectedTrack.transition ?? "cut") !== "fade"}
            label={text.transitionDuration}
            max={Math.max(0.1, selectedTrack.duration / 2)}
            min={0.1}
            onChange={(value) =>
              onChange(
                updateTimelineTrackSettings(timeline, selectedTrack.id, {
                  transitionDuration: value,
                }),
              )
            }
            step={0.05}
            value={selectedTrack.transitionDuration ?? 0.35}
          />
        </div>
      ) : null}
    </section>
  );
}

function TimelineRow({
  children,
  icon,
  label,
}: {
  children: React.ReactNode;
  icon: React.ReactElement;
  label: string;
}) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] border-b last:border-b-0">
      <div className="sticky left-0 z-10 flex items-center gap-2 border-r bg-background px-3 text-xs font-medium">
        <span className="[&_svg]:size-3.5">{icon}</span>
        {label}
      </div>
      <div className="flex min-w-0">{children}</div>
    </div>
  );
}

function NumberField({
  disabled,
  label,
  max,
  min,
  onChange,
  step,
  value,
}: {
  disabled?: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      {label}
      <Input
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="number"
        value={value}
      />
    </label>
  );
}

function clipWidth(duration: number, pixelsPerSecond: number) {
  return Math.max(84, duration * pixelsPerSecond);
}
