"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  FileText,
  LoaderCircle,
  Scissors,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { extractManuscriptMetadata } from "@/lib/episodes/manuscript-metadata";
import {
  joinManuscriptParts,
  mergeManuscriptParts,
  type ManuscriptPart,
} from "@/lib/episodes/manuscript-parts";

import { splitStudioNovel } from "../api";
import { ModelSelect } from "../components/model-select";
import { getStudioCopy } from "../i18n";
import type {
  EpisodeSplitDraft,
  EpisodeSplitResult,
  StudioLocale,
  StudioModelOption,
} from "../types";

type SplitMode = "auto" | "markers" | "ai";
const MAX_MANUSCRIPT_CHARS = 50_000_000;
const PAGE_SIZE = 24;

export function SplitNovelDialog({
  locale,
  models,
  onCompleted,
  projectId,
  trigger,
}: {
  locale: StudioLocale;
  models: StudioModelOption[];
  onCompleted: () => Promise<unknown> | void;
  projectId: string;
  trigger?: React.ReactElement;
}) {
  const copy = getStudioCopy(locale);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [importedParts, setImportedParts] = useState<ManuscriptPart[]>([]);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [mode, setMode] = useState<SplitMode>("auto");
  const [modelId, setModelId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [preview, setPreview] = useState<EpisodeSplitResult | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeSplitDraft[]>([]);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!models.some((model) => model.id === modelId)) {
      setModelId(models[0]?.id ?? "");
    }
  }, [modelId, models]);

  const pageCount = Math.max(1, Math.ceil(episodes.length / PAGE_SIZE));
  const visibleEpisodes = useMemo(
    () => episodes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [episodes, page],
  );
  const sourceFileName = importedParts.map((part) => part.name).join(" + ");

  function reset() {
    setContent("");
    setImportedParts([]);
    setTitle("");
    setAuthor("");
    setSynopsis("");
    setConfirmed(false);
    setPreview(null);
    setEpisodes([]);
    setPage(0);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && !isSubmitting) reset();
  }

  async function handleFiles(fileList?: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    if (files.some((file) => !file.name.toLowerCase().endsWith(".txt"))) {
      toast.error(copy.splitTextFileOnly);
      return;
    }
    setIsSubmitting(true);
    try {
      const decoded = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          text: await decodeTextFile(file),
        })),
      );
      const parts = mergeManuscriptParts(importedParts, decoded, locale);
      const text = joinManuscriptParts(parts);
      if (text.length < 100 || text.length > MAX_MANUSCRIPT_CHARS)
        throw new Error(copy.splitLengthInvalid);
      const metadata = extractManuscriptMetadata(text, parts[0]?.name);
      setContent(text);
      setImportedParts(parts);
      if (!importedParts.length) {
        setTitle(metadata.title);
        setAuthor(metadata.author);
        setSynopsis(metadata.synopsis);
      }
      setPreview(null);
      setEpisodes([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSubmitting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeImportedPart(name: string) {
    const parts = importedParts.filter((part) => part.name !== name);
    setImportedParts(parts);
    setContent(joinManuscriptParts(parts));
    setPreview(null);
    setEpisodes([]);
  }

  async function handlePreview() {
    const model = models.find((item) => item.id === modelId);
    if (
      content.length < 100 ||
      content.length > MAX_MANUSCRIPT_CHARS ||
      (mode === "ai" && !model)
    )
      return;
    setIsSubmitting(true);
    try {
      const result = await splitStudioNovel(projectId, {
        content,
        sourceFileName: sourceFileName || undefined,
        title,
        author,
        synopsis,
        mode,
        channelId: mode !== "markers" ? model?.channelId : undefined,
        model: mode !== "markers" ? model?.modelId : undefined,
        locale: locale === "en" ? "en" : "zh",
        persist: false,
      });
      setPreview(result);
      setEpisodes(result.episodes);
      setTitle(result.manuscript.title);
      setAuthor(result.manuscript.author ?? "");
      setSynopsis(result.manuscript.synopsis ?? "");
      setConfirmed(false);
      setPage(0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirm() {
    if (!preview || !confirmed || !episodes.length) return;
    setIsSubmitting(true);
    try {
      const result = await splitStudioNovel(projectId, {
        manuscriptId: preview.manuscript.id,
        title,
        author,
        synopsis,
        mode,
        method: preview.method,
        markerType: preview.markerType,
        confidence: preview.confidence,
        episodes: episodes.map((episode) => ({ ...episode, content: "" })),
        locale: locale === "en" ? "en" : "zh",
        persist: true,
      });
      const count = result.persisted?.length ?? result.episodes.length;
      toast.success(copy.splitSuccess.replace("{count}", String(count)));
      setOpen(false);
      reset();
      await onCompleted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateEpisode(index: number, patch: Partial<EpisodeSplitDraft>) {
    setEpisodes((current) =>
      current.map((episode, episodeIndex) =>
        episodeIndex === index ? { ...episode, ...patch } : episode,
      ),
    );
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      {trigger ? (
        <DialogTrigger render={trigger} />
      ) : (
        <DialogTrigger
          render={
            <Button aria-label={copy.splitNovel} size="icon-sm" variant="ghost" />
          }
        >
          <Scissors className="size-4" />
        </DialogTrigger>
      )}
      <DialogContent className="grid max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg sm:max-h-[min(92dvh,860px)] sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpenText className="size-4" />
            {copy.splitNovel}
          </DialogTitle>
          <DialogDescription>{copy.splitNovelDescription}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto pr-1">
          {!preview ? (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    accept=".txt,text/plain"
                    className="hidden"
                    multiple
                    onChange={(event) => void handleFiles(event.target.files)}
                    ref={fileInputRef}
                    type="file"
                  />
                  <Button
                    disabled={isSubmitting}
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                    variant="outline"
                  >
                    <Upload className="size-4" />
                    {importedParts.length ? copy.splitAddFiles : copy.splitImportFile}
                  </Button>
                  {importedParts.length ? (
                    <Badge variant="secondary">
                      {copy.splitFileTotal.replace(
                        "{count}",
                        String(importedParts.length),
                      )}
                    </Badge>
                  ) : null}
                </div>

                {importedParts.length ? (
                  <div className="border-y">
                    <div className="divide-y">
                      {importedParts.map((part, index) => (
                        <div className="flex items-center gap-3 py-2.5" key={part.name}>
                          <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {part.name}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {part.text.length.toLocaleString()}
                          </span>
                          <Button
                            aria-label={copy.splitRemoveFile}
                            disabled={isSubmitting}
                            onClick={() => removeImportedPart(part.name)}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between border-t py-2 text-xs text-muted-foreground">
                      <span>{copy.splitCombinedSource}</span>
                      <span className="font-mono">
                        {content.length.toLocaleString()} {copy.wordCount}
                      </span>
                    </div>
                  </div>
                ) : (
                  <label className="grid gap-1.5 text-sm font-medium">
                    <span className="flex items-center justify-between gap-3">
                      {copy.splitContent}
                      <span className="font-mono text-xs font-normal text-muted-foreground">
                        {content.length.toLocaleString()} / 50,000,000
                      </span>
                    </span>
                    <Textarea
                      className="h-72 min-h-52 max-h-[45dvh] resize-y overflow-y-auto field-sizing-fixed"
                      disabled={isSubmitting}
                      maxLength={MAX_MANUSCRIPT_CHARS}
                      onChange={(event) => {
                        const value = event.target.value;
                        setContent(value);
                        setImportedParts([]);
                        if (value.length >= 100) {
                          const metadata = extractManuscriptMetadata(value);
                          if (!title) setTitle(metadata.title);
                          if (!author) setAuthor(metadata.author);
                          if (!synopsis) setSynopsis(metadata.synopsis);
                        }
                      }}
                      placeholder={copy.splitContentPlaceholder}
                      value={content}
                    />
                  </label>
                )}
              </div>

              <div className="space-y-4 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
                <label className="grid gap-1.5 text-sm font-medium">
                  {copy.manuscriptTitle}
                  <Input
                    disabled={isSubmitting}
                    maxLength={160}
                    onChange={(event) => setTitle(event.target.value)}
                    value={title}
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  {copy.manuscriptAuthor}
                  <Input
                    disabled={isSubmitting}
                    maxLength={160}
                    onChange={(event) => setAuthor(event.target.value)}
                    value={author}
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  {copy.manuscriptSynopsis}
                  <Textarea
                    className="min-h-28 resize-y field-sizing-fixed"
                    disabled={isSubmitting}
                    maxLength={10_000}
                    onChange={(event) => setSynopsis(event.target.value)}
                    value={synopsis}
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  {copy.splitMode}
                  <Select
                    disabled={isSubmitting}
                    onValueChange={(next) => next && setMode(next as SplitMode)}
                    value={mode}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{copy.splitAuto}</SelectItem>
                      <SelectItem value="markers">{copy.splitMarkers}</SelectItem>
                      <SelectItem value="ai">{copy.splitAi}</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                {mode !== "markers" ? (
                  <label className="grid gap-1.5 text-sm font-medium">
                    {copy.analysisModel}
                    <ModelSelect
                      disabled={isSubmitting}
                      models={models}
                      onChange={setModelId}
                      placeholder={copy.analysisModel}
                      value={modelId}
                    />
                  </label>
                ) : null}
              </div>
            </div>
          ) : (
            <div>
              <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{title}</h3>
                    <Badge variant="secondary">
                      {preview.method === "ai" ? copy.splitAi : copy.splitMarkers}
                    </Badge>
                    <Badge variant="outline">
                      {copy.splitEpisodeTotal.replace("{count}", String(episodes.length))}
                    </Badge>
                  </div>
                  {author ? (
                    <p className="mt-1 text-xs text-muted-foreground">{author}</p>
                  ) : null}
                </div>
                <Button
                  disabled={isSubmitting}
                  onClick={() => {
                    setPreview(null);
                    setConfirmed(false);
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ChevronLeft className="size-4" />
                  {copy.splitBackToImport}
                </Button>
              </div>

              <div className="grid gap-4 py-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
                <div className="space-y-3">
                  <label className="grid gap-1.5 text-sm font-medium">
                    {copy.manuscriptTitle}
                    <Input
                      disabled={isSubmitting}
                      maxLength={160}
                      onChange={(event) => setTitle(event.target.value)}
                      value={title}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium">
                    {copy.manuscriptAuthor}
                    <Input
                      disabled={isSubmitting}
                      maxLength={160}
                      onChange={(event) => setAuthor(event.target.value)}
                      value={author}
                    />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium">
                    {copy.manuscriptSynopsis}
                    <Textarea
                      className="min-h-40 resize-y field-sizing-fixed"
                      disabled={isSubmitting}
                      onChange={(event) => setSynopsis(event.target.value)}
                      value={synopsis}
                    />
                  </label>
                </div>

                <div className="min-w-0 border-t pt-3 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
                  <Accordion className="border-y">
                    {visibleEpisodes.map((episode, visibleIndex) => {
                      const index = page * PAGE_SIZE + visibleIndex;
                      return (
                        <AccordionItem key={`${episode.number}-${episode.startIndex}`} value={String(index)}>
                          <AccordionTrigger className="px-2 hover:no-underline">
                            <span className="flex min-w-0 items-center gap-3 pr-3">
                              <span className="w-9 shrink-0 font-mono text-xs text-muted-foreground">
                                {String(episode.number).padStart(2, "0")}
                              </span>
                              <span className="truncate">{episode.title}</span>
                              <span className="shrink-0 font-mono text-[11px] font-normal text-muted-foreground">
                                {episode.wordCount.toLocaleString()}
                              </span>
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="grid gap-3 px-2 pb-4">
                            <label className="grid gap-1.5 text-xs font-medium">
                              {copy.episodeName}
                              <Input
                                disabled={isSubmitting}
                                maxLength={160}
                                onChange={(event) =>
                                  updateEpisode(index, { title: event.target.value })
                                }
                                value={episode.title}
                              />
                            </label>
                            <label className="grid gap-1.5 text-xs font-medium">
                              {copy.episodeSynopsis}
                              <Textarea
                                className="min-h-24 resize-y field-sizing-fixed"
                                disabled={isSubmitting}
                                maxLength={4_000}
                                onChange={(event) =>
                                  updateEpisode(index, { summary: event.target.value })
                                }
                                value={episode.summary}
                              />
                            </label>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                  {pageCount > 1 ? (
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <Button
                        aria-label={copy.previousPage}
                        disabled={page === 0}
                        onClick={() => setPage((current) => Math.max(0, current - 1))}
                        size="icon-sm"
                        type="button"
                        variant="outline"
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                      <span className="min-w-20 text-center font-mono text-xs text-muted-foreground">
                        {page + 1} / {pageCount}
                      </span>
                      <Button
                        aria-label={copy.nextPage}
                        disabled={page + 1 >= pageCount}
                        onClick={() =>
                          setPage((current) => Math.min(pageCount - 1, current + 1))
                        }
                        size="icon-sm"
                        type="button"
                        variant="outline"
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>

              <label className="flex cursor-pointer items-start gap-3 border-t pt-4 text-sm leading-5">
                <Checkbox
                  checked={confirmed}
                  disabled={isSubmitting}
                  onCheckedChange={setConfirmed}
                />
                <span>{copy.splitConfirm}</span>
              </label>
            </div>
          )}
        </div>

        <DialogFooter className="rounded-b-lg">
          <Button
            disabled={isSubmitting}
            onClick={() => handleOpenChange(false)}
            type="button"
            variant="outline"
          >
            {copy.cancel}
          </Button>
          {!preview ? (
            <Button
              disabled={
                isSubmitting ||
                content.length < 100 ||
                content.length > MAX_MANUSCRIPT_CHARS ||
                !title.trim() ||
                (mode === "ai" && !modelId)
              }
              onClick={() => void handlePreview()}
              type="button"
            >
              {isSubmitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Scissors className="size-4" />
              )}
              {isSubmitting ? copy.splitting : copy.splitPreview}
            </Button>
          ) : (
            <Button
              disabled={
                isSubmitting ||
                !confirmed ||
                !episodes.length ||
                episodes.some((episode) => !episode.title.trim())
              }
              onClick={() => void handleConfirm()}
              type="button"
            >
              {isSubmitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <BookOpenText className="size-4" />
              )}
              {isSubmitting ? copy.splitting : copy.splitAndCreate}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function decodeTextFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}
