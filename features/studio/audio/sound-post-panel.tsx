"use client";

import { LoaderCircle, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ADR_STATUSES,
  CUE_STATUSES,
  MUSIC_RIGHTS_STATUSES,
  parseSoundPostPackage,
  SOUND_QC_KEYS,
  type SoundPostPackage,
} from "@/lib/production/post-contract";

import {
  createStudioDeliverable,
  transitionStudioDeliverable,
} from "../api";
import { QcReportEditor, VersionHistory } from "../post/post-ui";
import type {
  ProductionDeliverableCatalog,
  StudioLocale,
  VoiceLineRecord,
} from "../types";
import {
  buildSoundPostPackage,
  getCurrentSoundPostVersion,
  getSoundPostVersions,
  getSoundQcReadiness,
} from "./audio-view-model";

const labels = {
  "zh-CN": {
    title: "声音后期",
    subtitle: "对白编辑、拟音、音乐监督与混录",
    dialogue: "对白 / ADR",
    effects: "SFX / Foley",
    music: "音乐",
    mix: "混录与 QC",
    versions: "版本",
    status: "ADR 状态",
    reason: "原因与表演备注",
    offset: "同步偏移 ms",
    addEffect: "添加声音 Cue",
    addMusic: "添加音乐 Cue",
    description: "声音描述",
    titleField: "曲目或主题",
    inPoint: "入点 ms",
    outPoint: "出点 ms",
    rights: "版权状态",
    notes: "音乐监督备注",
    save: "保存声音包",
    saved: "声音后期版本已保存",
    restored: "声音后期版本已恢复",
    invalid: "声音包字段不完整",
    qc: "机器可读声音 QC",
    mixFormat: "混录格式",
    sampleRate: "采样率",
    bitDepth: "位深",
    targetLufs: "目标 LUFS",
    truePeak: "真峰值 dBTP",
  },
  en: {
    title: "Sound post",
    subtitle: "Dialogue edit, Foley, music supervision and final mix",
    dialogue: "Dialogue / ADR",
    effects: "SFX / Foley",
    music: "Music",
    mix: "Mix and QC",
    versions: "Versions",
    status: "ADR status",
    reason: "Reason and performance note",
    offset: "Sync offset ms",
    addEffect: "Add sound cue",
    addMusic: "Add music cue",
    description: "Sound description",
    titleField: "Track or theme",
    inPoint: "In ms",
    outPoint: "Out ms",
    rights: "Rights status",
    notes: "Music supervision note",
    save: "Save sound package",
    saved: "Sound post version saved",
    restored: "Sound post version restored",
    invalid: "Sound package fields are incomplete",
    qc: "Machine-readable sound QC",
    mixFormat: "Format",
    sampleRate: "Sample rate",
    bitDepth: "Bit depth",
    targetLufs: "Target LUFS",
    truePeak: "True peak dBTP",
  },
} as const;

const qcLabels = {
  "zh-CN": {
    loudness: "节目响度",
    true_peak: "真峰值",
    dialogue_sync: "对白同步",
    intelligibility: "对白可懂度",
  },
  en: {
    loudness: "Program loudness",
    true_peak: "True peak",
    dialogue_sync: "Dialogue sync",
    intelligibility: "Intelligibility",
  },
} as const;

export function SoundPostPanel({
  catalog,
  episodeId,
  lines,
  locale,
  onCompleted,
  projectId,
}: {
  catalog: ProductionDeliverableCatalog;
  episodeId: string;
  lines: VoiceLineRecord[];
  locale: StudioLocale;
  onCompleted: () => Promise<unknown> | void;
  projectId: string;
}) {
  const text = labels[locale];
  const versions = useMemo(
    () => getSoundPostVersions(catalog.deliverables, episodeId),
    [catalog.deliverables, episodeId],
  );
  const current = getCurrentSoundPostVersion(versions);
  const [draft, setDraft] = useState<SoundPostPackage>(() =>
    current?.package ?? buildSoundPostPackage(episodeId, lines),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(current?.package ?? buildSoundPostPackage(episodeId, lines));
  }, [current?.deliverable.id, current?.package, episodeId, lines]);

  const readiness = getSoundQcReadiness(draft);

  async function save() {
    const parsed = parseSoundPostPackage(draft);
    if (!parsed.success) return toast.error(text.invalid);
    setBusy(true);
    try {
      await createStudioDeliverable(projectId, {
        department: "sound",
        deliverableType: "sound_post_package",
        title: locale === "en" ? "Sound post package" : "声音后期包",
        scopeType: "episode",
        scopeId: episodeId,
        episodeId,
        payload: parsed.data,
        sourceRefs: lines
          .filter((line) => line.audioAssetId)
          .map((line) => ({ type: "media_asset", id: line.audioAssetId })),
      });
      toast.success(text.saved);
      await onCompleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text.invalid);
    } finally {
      setBusy(false);
    }
  }

  async function restore(id: string) {
    setBusy(true);
    try {
      await transitionStudioDeliverable(projectId, id, { action: "restore" });
      toast.success(text.restored);
      await onCompleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text.invalid);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-b py-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{text.title}</h2>
            {current ? <Badge variant="outline">v{current.deliverable.version}</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{text.subtitle}</p>
        </div>
        <Button disabled={busy} onClick={() => void save()} size="sm">
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          {text.save}
        </Button>
      </div>
      <Tabs defaultValue="dialogue">
        <TabsList className="max-w-full justify-start overflow-x-auto" variant="line">
          <TabsTrigger value="dialogue">{text.dialogue}</TabsTrigger>
          <TabsTrigger value="effects">{text.effects}</TabsTrigger>
          <TabsTrigger value="music">{text.music}</TabsTrigger>
          <TabsTrigger value="mix">{text.mix}</TabsTrigger>
          <TabsTrigger value="versions">{text.versions}</TabsTrigger>
        </TabsList>
        <TabsContent className="pt-4" value="dialogue">
          <div className="max-h-[32rem] divide-y overflow-y-auto border-y">
            {draft.dialogue.map((item, index) => (
              <div className="grid gap-2 py-3 lg:grid-cols-[10rem_10rem_8rem_minmax(12rem,1fr)]" key={item.lineId}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.speaker}</p>
                  <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{item.text}</p>
                </div>
                <NativeSelect
                  aria-label={text.status}
                  className="h-8"
                  onChange={(event) =>
                    updateDialogue(setDraft, draft, index, { adrStatus: event.target.value as SoundPostPackage["dialogue"][number]["adrStatus"] })
                  }
                  value={item.adrStatus}
                >
                  {ADR_STATUSES.map((status) => <NativeSelectOption key={status} value={status}>{soundStatus(locale, status)}</NativeSelectOption>)}
                </NativeSelect>
                <Input
                  aria-label={text.offset}
                  className="h-8"
                  onChange={(event) => updateDialogue(setDraft, draft, index, { syncOffsetMs: Number(event.target.value) || 0 })}
                  type="number"
                  value={item.syncOffsetMs}
                />
                <Input
                  aria-label={text.reason}
                  className="h-8"
                  maxLength={2_000}
                  onChange={(event) => updateDialogue(setDraft, draft, index, { reason: event.target.value })}
                  placeholder={text.reason}
                  value={item.reason}
                />
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent className="pt-4" value="effects">
          <CueToolbar label={text.addEffect} onAdd={() => setDraft({ ...draft, effects: [...draft.effects, { id: crypto.randomUUID(), type: "sfx", description: locale === "en" ? "New sound cue" : "新声音 Cue", inMs: 0, outMs: 0, status: "planned" }] })} />
          <div className="divide-y border-y">
            {draft.effects.map((cue, index) => (
              <div className="grid gap-2 py-3 sm:grid-cols-[7rem_minmax(10rem,1fr)_7rem_7rem_8rem_2rem]" key={cue.id}>
                <NativeSelect className="h-8" onChange={(event) => updateEffect(setDraft, draft, index, { type: event.target.value as "sfx" | "foley" })} value={cue.type}>
                  <NativeSelectOption value="sfx">SFX</NativeSelectOption><NativeSelectOption value="foley">Foley</NativeSelectOption>
                </NativeSelect>
                <Input aria-label={text.description} className="h-8" onChange={(event) => updateEffect(setDraft, draft, index, { description: event.target.value })} value={cue.description} />
                <NumberInput label={text.inPoint} value={cue.inMs} onChange={(value) => updateEffect(setDraft, draft, index, { inMs: value })} />
                <NumberInput label={text.outPoint} value={cue.outMs} onChange={(value) => updateEffect(setDraft, draft, index, { outMs: value })} />
                <NativeSelect className="h-8" onChange={(event) => updateEffect(setDraft, draft, index, { status: event.target.value as SoundPostPackage["effects"][number]["status"] })} value={cue.status}>
                  {CUE_STATUSES.map((status) => <NativeSelectOption key={status} value={status}>{soundStatus(locale, status)}</NativeSelectOption>)}
                </NativeSelect>
                <RemoveButton onClick={() => setDraft({ ...draft, effects: draft.effects.filter((item) => item.id !== cue.id) })} />
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent className="pt-4" value="music">
          <CueToolbar label={text.addMusic} onAdd={() => setDraft({ ...draft, music: [...draft.music, { id: crypto.randomUUID(), title: locale === "en" ? "New music cue" : "新音乐 Cue", inMs: 0, outMs: 0, rightsStatus: "unreviewed", notes: "" }] })} />
          <div className="divide-y border-y">
            {draft.music.map((cue, index) => (
              <div className="grid gap-2 py-3 sm:grid-cols-[minmax(10rem,1fr)_7rem_7rem_9rem_minmax(10rem,1fr)_2rem]" key={cue.id}>
                <Input aria-label={text.titleField} className="h-8" onChange={(event) => updateMusic(setDraft, draft, index, { title: event.target.value })} value={cue.title} />
                <NumberInput label={text.inPoint} value={cue.inMs} onChange={(value) => updateMusic(setDraft, draft, index, { inMs: value })} />
                <NumberInput label={text.outPoint} value={cue.outMs} onChange={(value) => updateMusic(setDraft, draft, index, { outMs: value })} />
                <NativeSelect aria-label={text.rights} className="h-8" onChange={(event) => updateMusic(setDraft, draft, index, { rightsStatus: event.target.value as SoundPostPackage["music"][number]["rightsStatus"] })} value={cue.rightsStatus}>
                  {MUSIC_RIGHTS_STATUSES.map((status) => <NativeSelectOption key={status} value={status}>{soundStatus(locale, status)}</NativeSelectOption>)}
                </NativeSelect>
                <Input aria-label={text.notes} className="h-8" onChange={(event) => updateMusic(setDraft, draft, index, { notes: event.target.value })} value={cue.notes} />
                <RemoveButton onClick={() => setDraft({ ...draft, music: draft.music.filter((item) => item.id !== cue.id) })} />
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent className="space-y-5 pt-4" value="mix">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label={text.mixFormat} value={draft.mix.format} onChange={(value) => setDraft({ ...draft, mix: { ...draft.mix, format: value } })} />
            <NumberField label={text.sampleRate} value={draft.mix.sampleRate} onChange={(value) => setDraft({ ...draft, mix: { ...draft.mix, sampleRate: value } })} />
            <NumberField label={text.bitDepth} value={draft.mix.bitDepth} onChange={(value) => setDraft({ ...draft, mix: { ...draft.mix, bitDepth: value } })} />
            <NumberField label={text.targetLufs} value={draft.mix.targetLufs} onChange={(value) => setDraft({ ...draft, mix: { ...draft.mix, targetLufs: value } })} />
            <NumberField label={text.truePeak} value={draft.mix.truePeakDbtp} onChange={(value) => setDraft({ ...draft, mix: { ...draft.mix, truePeakDbtp: value } })} />
          </div>
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{text.qc}</h3><span className="text-xs text-muted-foreground">{readiness.passed}/{readiness.total}</span></div>
          <QcReportEditor checks={draft.qc} keys={SOUND_QC_KEYS} labels={qcLabels[locale]} locale={locale} onChange={(key, value) => setDraft({ ...draft, qc: { ...draft.qc, [key]: value } })} />
        </TabsContent>
        <TabsContent className="pt-4" value="versions">
          <VersionHistory busy={busy} locale={locale} onRestore={(id) => void restore(id)} versions={versions.map((item) => ({ deliverable: item.deliverable, summary: item.package ? locale === "en" ? `${item.package.dialogue.length} ADR · ${item.package.effects.length} FX · ${item.package.music.length} Music` : `${item.package.dialogue.length} 条 ADR · ${item.package.effects.length} 条音效 · ${item.package.music.length} 条音乐` : item.deliverable.title }))} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function CueToolbar({ label, onAdd }: { label: string; onAdd: () => void }) { return <div className="mb-3 flex justify-end"><Button onClick={onAdd} size="sm" variant="outline"><Plus className="size-4" />{label}</Button></div>; }
function RemoveButton({ onClick }: { onClick: () => void }) { return <Button aria-label="Remove" onClick={onClick} size="icon-sm" variant="ghost"><Trash2 className="size-3.5" /></Button>; }
function NumberInput({ label, onChange, value }: { label: string; onChange: (value: number) => void; value: number }) { return <Input aria-label={label} className="h-8" onChange={(event) => onChange(Number(event.target.value) || 0)} type="number" value={value} />; }
function Field({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) { return <label className="grid gap-1 text-xs font-medium">{label}<Input className="h-8" onChange={(event) => onChange(event.target.value)} value={value} /></label>; }
function NumberField({ label, onChange, value }: { label: string; onChange: (value: number) => void; value: number }) { return <label className="grid gap-1 text-xs font-medium">{label}<Input className="h-8" onChange={(event) => onChange(Number(event.target.value))} type="number" value={value} /></label>; }
function updateDialogue(setDraft: (value: SoundPostPackage) => void, draft: SoundPostPackage, index: number, value: Partial<SoundPostPackage["dialogue"][number]>) { setDraft({ ...draft, dialogue: draft.dialogue.map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item) }); }
function updateEffect(setDraft: (value: SoundPostPackage) => void, draft: SoundPostPackage, index: number, value: Partial<SoundPostPackage["effects"][number]>) { setDraft({ ...draft, effects: draft.effects.map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item) }); }
function updateMusic(setDraft: (value: SoundPostPackage) => void, draft: SoundPostPackage, index: number, value: Partial<SoundPostPackage["music"][number]>) { setDraft({ ...draft, music: draft.music.map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item) }); }
function soundStatus(locale: StudioLocale, status: string) { const values: Record<string, readonly [string, string]> = { not_required: ["无需 ADR", "Not required"], required: ["需要 ADR", "Required"], recorded: ["已录制", "Recorded"], approved: ["已批准", "Approved"], planned: ["已规划", "Planned"], ready: ["已就绪", "Ready"], unreviewed: ["待审查", "Unreviewed"], cleared: ["已清权", "Cleared"], restricted: ["受限制", "Restricted"] }; const value = values[status]; return value?.[locale === "en" ? 1 : 0] ?? status; }
