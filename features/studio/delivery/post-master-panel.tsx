"use client";

import { FileDown, LoaderCircle, Save } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  MASTER_QC_KEYS,
  parsePostMasterPackage,
  type PostMasterPackage,
} from "@/lib/production/post-contract";

import {
  createStudioDeliverable,
  transitionStudioDeliverable,
} from "../api";
import { QcReportEditor, VersionHistory } from "../post/post-ui";
import type {
  EditorSubtitle,
  EditorTimeline,
  ProductionDeliverableCatalog,
  StudioLocale,
} from "../types";
import {
  buildPostMasterPackage,
  getCurrentPostMasterVersion,
  getMasterQcReadiness,
  getPostMasterVersions,
} from "./delivery-view-model";

const copy = {
  "zh-CN": {
    title: "后期母版",
    subtitle: "剪辑 EDL、调色、Online 与字幕验收",
    edl: "EDL",
    color: "调色",
    online: "Online",
    subtitles: "字幕",
    qc: "母版 QC",
    versions: "版本",
    save: "保存母版包",
    saved: "后期母版版本已保存",
    restored: "后期母版版本已恢复",
    invalid: "母版包字段不完整",
    exportEdl: "导出 EDL",
    workingSpace: "工作色彩空间",
    outputSpace: "输出色彩空间",
    look: "Look 名称",
    lut: "LUT 名称",
    notes: "调色备注",
    resolution: "分辨率",
    aspect: "画幅",
    codec: "母版编码",
    fps: "帧率",
    language: "字幕语言",
    format: "字幕格式",
    cues: "字幕条数",
    missing: "缺失字幕",
  },
  en: {
    title: "Post master",
    subtitle: "Edit decision list, color, online and subtitle review",
    edl: "EDL",
    color: "Color",
    online: "Online",
    subtitles: "Subtitles",
    qc: "Master QC",
    versions: "Versions",
    save: "Save master package",
    saved: "Post master version saved",
    restored: "Post master version restored",
    invalid: "Master package fields are incomplete",
    exportEdl: "Export EDL",
    workingSpace: "Working color space",
    outputSpace: "Output color space",
    look: "Look name",
    lut: "LUT name",
    notes: "Color notes",
    resolution: "Resolution",
    aspect: "Aspect ratio",
    codec: "Master codec",
    fps: "Frame rate",
    language: "Subtitle language",
    format: "Subtitle format",
    cues: "Subtitle cues",
    missing: "Missing cues",
  },
} as const;

const qcLabels = {
  "zh-CN": {
    frame_rate: "帧率一致性",
    resolution: "分辨率",
    color_space: "色彩空间",
    black_frames: "黑帧 / 坏帧",
    subtitle_coverage: "字幕覆盖",
    subtitle_safe_area: "字幕安全区",
  },
  en: {
    frame_rate: "Frame rate",
    resolution: "Resolution",
    color_space: "Color space",
    black_frames: "Black / bad frames",
    subtitle_coverage: "Subtitle coverage",
    subtitle_safe_area: "Subtitle safe area",
  },
} as const;

export function PostMasterPanel({
  aspectRatio,
  catalog,
  episodeId,
  episodeName,
  frameRate,
  language,
  locale,
  onCompleted,
  projectId,
  resolution,
  subtitles,
  timeline,
}: {
  aspectRatio: string;
  catalog: ProductionDeliverableCatalog;
  episodeId: string;
  episodeName: string;
  frameRate: number;
  language: string;
  locale: StudioLocale;
  onCompleted: () => Promise<unknown> | void;
  projectId: string;
  resolution: string;
  subtitles: EditorSubtitle[];
  timeline: EditorTimeline;
}) {
  const text = copy[locale];
  const versions = useMemo(
    () => getPostMasterVersions(catalog.deliverables, episodeId),
    [catalog.deliverables, episodeId],
  );
  const current = getCurrentPostMasterVersion(versions);
  const initial = useMemo(
    () =>
      buildPostMasterPackage({
        aspectRatio,
        episodeId,
        frameRate,
        language,
        resolution,
        subtitles,
        timeline,
        title: episodeName,
      }),
    [aspectRatio, episodeId, episodeName, frameRate, language, resolution, subtitles, timeline],
  );
  const [draft, setDraft] = useState<PostMasterPackage>(current?.package ?? initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(current?.package ?? initial);
  }, [current?.deliverable.id, current?.package, initial]);

  const readiness = getMasterQcReadiness(draft);

  async function save() {
    const parsed = parsePostMasterPackage(draft);
    if (!parsed.success) return toast.error(text.invalid);
    setBusy(true);
    try {
      await createStudioDeliverable(projectId, {
        department: "post",
        deliverableType: "post_master_package",
        title: locale === "en" ? "Post master package" : "后期母版包",
        scopeType: "episode",
        scopeId: episodeId,
        episodeId,
        payload: parsed.data,
        sourceRefs: draft.edl.tracks
          .filter((track) => track.sourceAssetId)
          .map((track) => ({ type: "media_asset", id: track.sourceAssetId })),
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

  function exportEdl() {
    const rows = draft.edl.tracks.map((track, index) =>
      `${String(index + 1).padStart(3, "0")}  ${track.reel.padEnd(12, " ")} V C ${timecode(track.inMs, draft.edl.frameRate)} ${timecode(track.outMs, draft.edl.frameRate)}`,
    );
    const blob = new Blob([[`TITLE: ${draft.edl.title}`, `FCM: NON-DROP FRAME`, ...rows].join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${draft.edl.title.replaceAll(/[^a-zA-Z0-9_-]+/g, "-") || "timeline"}.edl`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="border-b py-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><h2 className="text-base font-semibold">{text.title}</h2>{current ? <Badge variant="outline">v{current.deliverable.version}</Badge> : null}</div>
          <p className="mt-1 text-sm text-muted-foreground">{text.subtitle}</p>
        </div>
        <Button disabled={busy} onClick={() => void save()} size="sm">
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{text.save}
        </Button>
      </div>
      <Tabs defaultValue="edl">
        <TabsList className="max-w-full justify-start overflow-x-auto" variant="line">
          <TabsTrigger value="edl">{text.edl}</TabsTrigger><TabsTrigger value="color">{text.color}</TabsTrigger><TabsTrigger value="online">{text.online}</TabsTrigger><TabsTrigger value="subtitles">{text.subtitles}</TabsTrigger><TabsTrigger value="qc">{text.qc}</TabsTrigger><TabsTrigger value="versions">{text.versions}</TabsTrigger>
        </TabsList>
        <TabsContent className="pt-4" value="edl">
          <div className="mb-3 flex items-center justify-between"><span className="text-xs text-muted-foreground">{locale === "en" ? `${draft.edl.tracks.length} clips` : `${draft.edl.tracks.length} 个镜头`} · {(draft.edl.durationMs / 1_000).toFixed(1)}s · {draft.edl.frameRate} fps</span><Button onClick={exportEdl} size="sm" variant="outline"><FileDown className="size-4" />{text.exportEdl}</Button></div>
          <div className="max-h-80 divide-y overflow-y-auto border-y font-mono text-xs">
            {draft.edl.tracks.map((track) => <div className="grid grid-cols-[4rem_8rem_1fr_1fr] gap-2 py-2" key={track.id}><span>{String(track.shotIndex + 1).padStart(3, "0")}</span><span>{track.reel}</span><span>{timecode(track.inMs, draft.edl.frameRate)}</span><span>{timecode(track.outMs, draft.edl.frameRate)}</span></div>)}
          </div>
        </TabsContent>
        <TabsContent className="pt-4" value="color">
          <div className="grid gap-4 sm:grid-cols-2"><Field label={text.workingSpace} value={draft.color.workingSpace} onChange={(value) => setDraft({ ...draft, color: { ...draft.color, workingSpace: value } })} /><Field label={text.outputSpace} value={draft.color.outputSpace} onChange={(value) => setDraft({ ...draft, color: { ...draft.color, outputSpace: value } })} /><Field label={text.look} value={draft.color.lookName} onChange={(value) => setDraft({ ...draft, color: { ...draft.color, lookName: value } })} /><Field label={text.lut} value={draft.color.lutName} onChange={(value) => setDraft({ ...draft, color: { ...draft.color, lutName: value } })} /></div>
          <label className="mt-4 grid gap-1.5 text-sm font-medium">{text.notes}<Textarea className="min-h-28" onChange={(event) => setDraft({ ...draft, color: { ...draft.color, notes: event.target.value } })} value={draft.color.notes} /></label>
        </TabsContent>
        <TabsContent className="pt-4" value="online">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label={text.resolution} value={draft.online.resolution} onChange={(value) => setDraft({ ...draft, online: { ...draft.online, resolution: value } })} /><Field label={text.aspect} value={draft.online.aspectRatio} onChange={(value) => setDraft({ ...draft, online: { ...draft.online, aspectRatio: value } })} /><Field label={text.codec} value={draft.online.codec} onChange={(value) => setDraft({ ...draft, online: { ...draft.online, codec: value } })} /><NumberField label={text.fps} value={draft.online.frameRate} onChange={(value) => setDraft({ ...draft, online: { ...draft.online, frameRate: value } })} /></div>
        </TabsContent>
        <TabsContent className="pt-4" value="subtitles">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label={text.language} value={draft.subtitles.language} onChange={(value) => setDraft({ ...draft, subtitles: { ...draft.subtitles, language: value } })} /><label className="grid gap-1.5 text-sm font-medium">{text.format}<NativeSelect onChange={(event) => setDraft({ ...draft, subtitles: { ...draft.subtitles, format: event.target.value as PostMasterPackage["subtitles"]["format"] } })} value={draft.subtitles.format}><NativeSelectOption value="srt">SRT</NativeSelectOption><NativeSelectOption value="vtt">WebVTT</NativeSelectOption><NativeSelectOption value="ttml">TTML</NativeSelectOption></NativeSelect></label><NumberField label={text.cues} value={draft.subtitles.cueCount} onChange={(value) => setDraft({ ...draft, subtitles: { ...draft.subtitles, cueCount: value } })} /><NumberField label={text.missing} value={draft.subtitles.missingCueCount} onChange={(value) => setDraft({ ...draft, subtitles: { ...draft.subtitles, missingCueCount: value } })} /></div>
        </TabsContent>
        <TabsContent className="pt-4" value="qc">
          <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">{text.qc}</h3><span className="text-xs text-muted-foreground">{readiness.passed}/{readiness.total}</span></div>
          <QcReportEditor checks={draft.qc} keys={MASTER_QC_KEYS} labels={qcLabels[locale]} locale={locale} onChange={(key, value) => setDraft({ ...draft, qc: { ...draft.qc, [key]: value } })} />
        </TabsContent>
        <TabsContent className="pt-4" value="versions"><VersionHistory busy={busy} locale={locale} onRestore={(id) => void restore(id)} versions={versions.map((item) => ({ deliverable: item.deliverable, summary: item.package ? locale === "en" ? `${item.package.edl.tracks.length} clips · ${item.package.online.resolution} · ${item.package.subtitles.cueCount} cues` : `${item.package.edl.tracks.length} 个镜头 · ${item.package.online.resolution} · ${item.package.subtitles.cueCount} 条字幕` : item.deliverable.title }))} /></TabsContent>
      </Tabs>
    </section>
  );
}

function Field({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) { return <label className="grid gap-1.5 text-sm font-medium">{label}<Input onChange={(event) => onChange(event.target.value)} value={value} /></label>; }
function NumberField({ label, onChange, value }: { label: string; onChange: (value: number) => void; value: number }) { return <label className="grid gap-1.5 text-sm font-medium">{label}<Input onChange={(event) => onChange(Number(event.target.value) || 0)} type="number" value={value} /></label>; }
function timecode(valueMs: number, frameRate: number) { const totalSeconds = Math.floor(valueMs / 1_000); const frames = Math.floor(((valueMs % 1_000) / 1_000) * frameRate); const hours = Math.floor(totalSeconds / 3_600); const minutes = Math.floor((totalSeconds % 3_600) / 60); const seconds = totalSeconds % 60; return [hours, minutes, seconds, frames].map((value) => String(value).padStart(2, "0")).join(":"); }
