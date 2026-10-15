"use client";
import { Input } from "@/components/ui/input";
import { inspectSubtitleTimings, type SubtitleAudioSource } from "@/lib/production/subtitle-timing";
import type { EditorSubtitle, StudioLocale } from "../types";

export function SubtitleEditor({ subtitles, visibleIds, duration, locale, onChange, voiceLines }: {
  subtitles: EditorSubtitle[]; visibleIds: Set<string>; duration: number; locale: StudioLocale;
  onChange: (subtitles: EditorSubtitle[]) => void; voiceLines: readonly SubtitleAudioSource[];
}) {
  const issues = inspectSubtitleTimings(subtitles, duration, voiceLines);
  return <div className="mt-2 divide-y border-y">
    <div className="grid grid-cols-[minmax(0,1fr)_4.25rem_4.25rem] items-center gap-2 py-1 text-xs text-muted-foreground">
      <span>{locale === "en" ? "Dialogue" : "对白"}</span>
      <span>{locale === "en" ? "In (s)" : "入点(秒)"}</span>
      <span>{locale === "en" ? "Out (s)" : "出点(秒)"}</span>
    </div>
    {subtitles.filter(cue => visibleIds.has(cue.id)).map(cue => <div className="grid grid-cols-[minmax(0,1fr)_4.25rem_4.25rem] items-start gap-2 py-2" key={cue.id}>
      <div className="min-w-0 text-sm leading-5 break-words">
        <span className="mr-2 text-xs font-medium">{cue.speaker}</span>
        {cue.text}
      </div>
      {(["start", "end"] as const).map(field => <Input className="px-2 font-mono tabular-nums md:h-7" aria-label={`${cue.speaker} ${cue.text} ${field}`} type="number" min={0} max={duration} step={0.05} value={cue[field]} key={field}
        onChange={event => onChange(subtitles.map(item => item.id === cue.id ? { ...item, [field]: Number(event.target.value) } : item))} />)}
      {issues.filter(issue => issue.id === cue.id).map(issue => <p role="alert" className="col-span-3 text-xs text-destructive" key={issue.code}>{issue.message}</p>)}
    </div>)}
  </div>;
}
