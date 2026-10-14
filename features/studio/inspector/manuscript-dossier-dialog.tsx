"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { ManuscriptDossier, ManuscriptNotes } from "@/lib/episodes/manuscript-analysis";
import type { ProductionDeliverableRecord, StudioLocale } from "../types";
import { transitionStudioDeliverable } from "../api";
import { getNextPendingGate } from "../production/deliverable-view-model";
import { productionLabel } from "../production/copy";

export function ManuscriptDossierDialog({ projectId, deliverable, dossier, initialTab, open, onOpenChange, onRefresh, locale }: {
  projectId: string; deliverable: ProductionDeliverableRecord; dossier: ManuscriptDossier;
  initialTab: string; open: boolean; onOpenChange: (open: boolean) => void; onRefresh: () => Promise<unknown> | void; locale: StudioLocale;
}) {
  const [chunkRef, setChunkRef] = useState("overview");
  const [notes, setNotes] = useState<ManuscriptNotes | null>(null);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);
  const [chunkPage, setChunkPage] = useState(0);
  const [chapterPage, setChapterPage] = useState(0);
  const pageSize = 50;
  const chunkPages = Math.max(1, Math.ceil(dossier.chunks.length / pageSize));
  const chapterPages = Math.max(1, Math.ceil(dossier.chapters.length / pageSize));
  const visibleChunks = dossier.chunks.slice(chunkPage * pageSize, (chunkPage + 1) * pageSize);
  const visibleChapters = dossier.chapters.slice(chapterPage * pageSize, (chapterPage + 1) * pageSize);
  const selectedChunk = dossier.chunks.find(chunk => chunk.artifactRef === chunkRef);
  const en = locale === "en";
  const t = (zh: string, english: string) => en ? english : zh;
  useEffect(() => {
    if (!open || chunkRef === "overview") return;
    const controller = new AbortController();
    fetch(`/api/projects/${encodeURIComponent(projectId)}/manuscripts/${encodeURIComponent(dossier.manuscriptId)}/notes?ref=${encodeURIComponent(chunkRef)}`, { signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.message); return body.notes as ManuscriptNotes; })
      .then(value => { if (!controller.signal.aborted) setNotes(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "读取失败"); });
    return () => controller.abort();
  }, [chunkRef, dossier.manuscriptId, open, projectId]);
  const displayed = chunkRef === "overview" ? dossier.summary : notes;
  const gate = getNextPendingGate(deliverable);
  async function transition() {
    setActing(true);
    try {
      await transitionStudioDeliverable(projectId, deliverable.id, deliverable.status === "draft" ?
        { action: "submit" } : { action: "approve", gateKey: gate?.key });
      await onRefresh(); toast.success(t("资料审核状态已更新", "Review status updated"));
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "审核失败"); }
    finally { setActing(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[min(90dvh,900px)] max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
      <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12"><DialogTitle>{deliverable.title}</DialogTitle>
        <p className="text-xs text-muted-foreground">{t("原著提取资料 · 待审核内容不是新增剧情", "Source-grounded notes · review required")} · {productionLabel(locale, "statuses", deliverable.status)} · v{deliverable.version}</p>
      </DialogHeader>
      <div className="shrink-0 px-5 py-3"><Select value={chunkRef} onValueChange={value => { if (value) { setChunkRef(value); setNotes(null); setError(""); } }}>
        <SelectTrigger className="w-full"><SelectValue>{selectedChunk ? `${t("原文段落", "Source chunk")} ${selectedChunk.index + 1} · ${selectedChunk.start}-${selectedChunk.end}` : t("全书 / 所选范围资料概览", "Selected source overview")}</SelectValue></SelectTrigger><SelectContent>
          <SelectItem value="overview">{t("全书 / 所选范围资料概览", "Selected source overview")}</SelectItem>
          {selectedChunk && !visibleChunks.includes(selectedChunk) ? <SelectItem value={selectedChunk.artifactRef}>{t("原文段落", "Source chunk")} {selectedChunk.index + 1} · {selectedChunk.start}-{selectedChunk.end}</SelectItem> : null}
          {visibleChunks.map(chunk => <SelectItem key={chunk.artifactRef} value={chunk.artifactRef}>{t("原文段落", "Source chunk")} {chunk.index + 1} · {chunk.start}-{chunk.end}</SelectItem>)}
        </SelectContent></Select>
        {chunkPages > 1 ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span>{t("段落索引", "Chunk index")} {chunkPage + 1}/{chunkPages}</span><Button size="sm" variant="outline" disabled={chunkPage === 0} onClick={() => setChunkPage(page => page - 1)}>{t("上一页", "Previous")}</Button><Button size="sm" variant="outline" disabled={chunkPage + 1 >= chunkPages} onClick={() => setChunkPage(page => page + 1)}>{t("下一页", "Next")}</Button></div> : null}
        <p className="mt-2 text-xs text-muted-foreground">{t("概览只保留主要信息；次要人物和事件可按原文段落查阅。已审核资料供改编引用，原文始终保留。", "The overview highlights key facts. Select a source chunk for details. Approved notes inform adaptation; the original is retained.")}</p></div>
      <Tabs defaultValue={initialTab === "overview" ? "outline" : initialTab} className="flex min-h-0 flex-1 flex-col px-5">
        <TabsList variant="line" className="h-auto shrink-0 flex-wrap justify-start">
          <TabsTrigger value="outline">{t("故事大纲", "Outline")}</TabsTrigger><TabsTrigger value="characters">{t("人物传记", "Characters")}</TabsTrigger>
          <TabsTrigger value="locations">{t("场景设计", "Locations")}</TabsTrigger><TabsTrigger value="props">{t("道具设计", "Props")}</TabsTrigger>
        </TabsList>
        {(["outline", "characters", "locations", "props"] as const).map(tab => <TabsContent key={tab} value={tab} className="min-h-0 flex-1 overflow-y-auto py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {error ? <p role="alert">{error}</p> : !displayed ? <p>{t("正在读取资料…", "Loading notes…")}</p> : tab === "outline" ? <>
            <p className="whitespace-pre-wrap text-sm leading-7">{displayed.summary}</p><h3 className="mt-5 font-semibold">{t("世界规则", "World rules")}</h3>
            <ul className="mt-2 space-y-2 text-sm">{displayed.rules.map((rule, index) => <li key={index}>{rule}</li>)}</ul>
            {chunkRef === "overview" ? <><h3 className="mt-5 font-semibold">{t("章节索引", "Chapter index")}</h3><ul className="mt-2 space-y-2 text-sm">{visibleChapters.map((chapter, index) => <li key={index}>{chapter.heading} · {chapter.startIndex}-{chapter.endIndex}</li>)}</ul>
              {chapterPages > 1 ? <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span>{chapterPage + 1}/{chapterPages}</span><Button size="sm" variant="outline" disabled={chapterPage === 0} onClick={() => setChapterPage(page => page - 1)}>{t("上一页", "Previous")}</Button><Button size="sm" variant="outline" disabled={chapterPage + 1 >= chapterPages} onClick={() => setChapterPage(page => page + 1)}>{t("下一页", "Next")}</Button></div> : null}
            </> : null}
          </> : <div className="space-y-4">{displayed[tab].length ? displayed[tab].map((entry, index) => <section key={index} className="border-b pb-4"><h3 className="font-semibold">{entry.name}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{entry.details}</p></section>) : <p className="text-sm text-muted-foreground">{t("当前范围未提取到此类资料", "No notes for this category in the selected scope")}</p>}</div>}
        </TabsContent>)}
      </Tabs>
      <DialogFooter className="m-0 min-h-16 shrink-0 border-t px-5 py-3"><Button variant="outline" onClick={() => onOpenChange(false)}>{t("关闭", "Close")}</Button>
        {deliverable.status === "draft" || (deliverable.status === "review" && gate) ? <Button disabled={acting} onClick={() => void transition()}>
          {acting ? t("正在更新…", "Updating…") : deliverable.status === "draft" ? t("提交审核", "Submit for review") : `${t("确认审核", "Approve gate")} · ${gate?.key}`}
        </Button> : null}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
