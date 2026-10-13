"use client";
import { Textarea } from "@/components/ui/textarea";
import { ConfigurationField, selectClass } from "./fields";
import type { ProductionCopy } from "./copy";
import type { SoundPolicy } from "@/lib/production-configuration/contract";

export function SoundEditor({ sound, patch, onChange, source, copy }: {
  sound: SoundPolicy; patch: Partial<SoundPolicy>; onChange: (patch: Partial<SoundPolicy>) => void; source: (field: string) => string; copy: ProductionCopy;
}) {
  function change<K extends keyof SoundPolicy>(key: K, value: SoundPolicy[K]) { onChange({ ...patch, [key]: value }); }
  const field = (key: keyof SoundPolicy, child: React.ReactNode) => <ConfigurationField key={key} label={copy[key]} copy={copy} source={source(`sound.${key}`)} overridden={key in patch} onInherit={() => { const next = { ...patch }; delete next[key]; onChange(next); }}>{child}</ConfigurationField>;
  return <div className="space-y-5">
    {field("mode", <select aria-label={copy.mode} className={selectClass} value={sound.mode} onChange={e => change("mode", e.target.value as SoundPolicy["mode"])}>{(["native", "post", "silent"] as const).map(mode => <option key={mode} value={mode}>{copy[mode]}</option>)}</select>)}
    <div className="grid gap-4 sm:grid-cols-2">{(["dialogue", "voiceover", "innerMonologue", "ambience", "effects"] as const).map(key => field(key, <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sound[key]} onChange={e => change(key, e.target.checked)} />{copy[key]}</label>))}</div>
    <div className="grid gap-4 sm:grid-cols-2">
      {field("music", <select aria-label={copy.music} className={selectClass} value={sound.music} onChange={e => change("music", e.target.value as SoundPolicy["music"])}><option value="off">{copy.off}</option><option value="designed">{copy.designed}</option><option value="post">{copy.musicPost}</option></select>)}
      {field("subtitles", <select aria-label={copy.subtitles} className={selectClass} value={sound.subtitles} onChange={e => change("subtitles", e.target.value as SoundPolicy["subtitles"])}><option value="post">{copy.subtitlesPost}</option><option value="model">{copy.subtitlesModel}</option><option value="off">{copy.subtitlesOff}</option></select>)}
    </div>
    <div className="grid gap-4 sm:grid-cols-2">{(["voiceDirection", "ambienceDirection", "effectsDirection", "musicDirection"] as const).map(key => field(key, <Textarea aria-label={copy[key]} maxLength={4000} value={sound[key]} onChange={e => change(key, e.target.value)} />))}</div>
    <p className="text-xs leading-relaxed text-muted-foreground">{copy.soundHelp}</p>
  </div>;
}
