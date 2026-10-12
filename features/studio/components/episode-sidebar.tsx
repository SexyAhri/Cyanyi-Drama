"use client";

import { useState } from "react";
import {
  BookOpenText,
  FilePlus2,
  MapPin,
  Package,
  Scissors,
  ScrollText,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { EpisodeRecord } from "@/lib/projects/types";
import { cn } from "@/lib/utils";
import type { StoryPackage } from "@/lib/production/story-package-contract";

import { getStudioStageStates } from "../stage-state";
import { getStudioCopy } from "../i18n";
import type {
  ProductionDeliverableCatalog,
  ProductionDeliverableRecord,
  StudioLocale,
  StudioModelOption,
  WorkspaceSnapshot,
} from "../types";
import { StoryPackageReviewDialog } from "../inspector/story-package-review-dialog";
import { ManuscriptDossierDialog } from "../inspector/manuscript-dossier-dialog";
import type { ManuscriptDossier } from "@/lib/episodes/manuscript-analysis";
import { SplitNovelDialog } from "../writing/split-novel-dialog";
import { CreateEpisodeDialog } from "./create-episode-dialog";
import { StatusIndicator } from "./status-indicator";

export function EpisodeSidebar({
  createEpisode,
  locale,
  onCreated,
  onSelect,
  onRefresh,
  selectedEpisodeId,
  snapshot,
  models,
  deliverables,
}: {
  createEpisode: (input: {
    name: string;
    novelText?: string;
  }) => Promise<EpisodeRecord>;
  locale: StudioLocale;
  onCreated: (episode: EpisodeRecord) => void;
  onRefresh: () => Promise<unknown> | void;
  onSelect: (episodeId: string) => void;
  selectedEpisodeId?: string;
  snapshot: WorkspaceSnapshot;
  models: StudioModelOption[];
  deliverables: ProductionDeliverableCatalog | null;
}) {
  const copy = getStudioCopy(locale);
  const episodes = snapshot.project.episodes;
  const [episodeSearch, setEpisodeSearch] = useState("");
  const [navigation, setNavigation] = useState({ selectedEpisodeId, page: 0 });
  const filteredEpisodes = episodes.filter(episode =>
    `${episode.episodeNumber} ${episode.name}`.toLocaleLowerCase().includes(episodeSearch.trim().toLocaleLowerCase()));
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filteredEpisodes.length / pageSize));
  const selectedIndex = filteredEpisodes.findIndex(episode => episode.id === selectedEpisodeId);
  const page = Math.min(pageCount - 1, navigation.selectedEpisodeId === selectedEpisodeId
    ? navigation.page : Math.max(0, Math.floor(selectedIndex / pageSize)));
  const visibleEpisodes = filteredEpisodes.slice(page * pageSize, (page + 1) * pageSize);
  const [storyPackageTab, setStoryPackageTab] = useState<
    "overview" | "outline" | "characters" | "locations" | "props" | "episode"
  >("overview");
  const [storyPackageOpen, setStoryPackageOpen] = useState(false);
  const [preferDossier, setPreferDossier] = useState(true);
  const dossierDeliverable = deliverables?.deliverables.filter(item =>
    item.payload.packageFormat === "cyanyi-manuscript-dossier-v1" && !["superseded", "stale"].includes(item.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const dossier = dossierDeliverable?.payload as unknown as ManuscriptDossier | undefined;
  const storyPackageDeliverable = deliverables?.deliverables
    .filter(isStoryPackageDeliverable)
    .sort(
      (left, right) =>
        right.version - left.version ||
        right.updatedAt.localeCompare(left.updatedAt),
    )[0];
  const storyPackage = storyPackageDeliverable
    ? readStoryPackage(storyPackageDeliverable)
    : null;
  const showDossier = Boolean(dossier && (preferDossier || !storyPackage));
  const hasMaterials = Boolean(storyPackage || dossier);
  const openStoryPackage = (
    tab: typeof storyPackageTab,
  ) => {
    if (!hasMaterials) return;
    if (tab === "episode") setPreferDossier(false);
    setStoryPackageTab(tab);
    setStoryPackageOpen(true);
  };
  const packageSections = [
    {
      icon: BookOpenText,
      label: locale === "en" ? "Story outline" : "故事大纲",
      tab: "outline" as const,
    },
    {
      icon: UserRound,
      label: locale === "en" ? "Character biographies" : "人物传记",
      tab: "characters" as const,
    },
    {
      icon: MapPin,
      label: locale === "en" ? "Location design" : "场景设计",
      tab: "locations" as const,
    },
    {
      icon: Package,
      label: locale === "en" ? "Prop design" : "道具设计",
      tab: "props" as const,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar/60">
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
        <h2 className="text-xs font-semibold text-sidebar-foreground">
          {copy.episodes}
        </h2>
        <div className="flex items-center gap-0.5">
          <SplitNovelDialog
            locale={locale}
            models={models}
            onCompleted={onRefresh}
            projectId={snapshot.project.id}
          />
          <CreateEpisodeDialog
            createEpisode={createEpisode}
            locale={locale}
            onCreated={onCreated}
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" scrollbarClassName="hidden">
        <section className="border-b px-2 py-3">
          <h3 className="px-2 pb-1.5 text-[11px] font-semibold text-muted-foreground">
            {locale === "en" ? "Story materials" : "故事资料"}
          </h3>
          {dossier && storyPackage ? <div className="flex gap-1 px-2 pb-2">
            <Button size="sm" variant={showDossier ? "secondary" : "ghost"} onClick={() => setPreferDossier(true)}>{locale === "en" ? "Source" : "原著资料"}</Button>
            <Button size="sm" variant={!showDossier ? "secondary" : "ghost"} onClick={() => setPreferDossier(false)}>{locale === "en" ? "Original" : "原创策划"}</Button>
          </div> : null}
          <div className="space-y-0.5">
            {packageSections.map(({ icon: Icon, label, tab }) => (
              <button
                aria-current={
                  storyPackageOpen && storyPackageTab === tab
                    ? "page"
                    : undefined
                }
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 disabled:cursor-not-allowed disabled:opacity-50",
                  storyPackageOpen && storyPackageTab === tab &&
                    "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
                disabled={!hasMaterials}
                key={tab}
                onClick={() => openStoryPackage(tab)}
                title={
                  hasMaterials
                    ? label
                    : locale === "en"
                      ? "Generate a story package to view this section"
                      : "生成原创策划包或建立原著资料后可查看"
                }
                type="button"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
            ))}
          </div>
          {!hasMaterials ? (
            <p className="px-2.5 pt-1.5 text-[10px] leading-4 text-muted-foreground">
              {locale === "en"
                ? "Generate a package to fill these sections."
                : "上传后可建立原著资料，也可让导演助手“建立原著改编资料”；原创内容使用策划包。"}
            </p>
          ) : null}
        </section>

        <section className="px-2 py-3">
          <div className="flex items-center justify-between px-2 pb-1.5">
            <button
              aria-current={
                storyPackageOpen && storyPackageTab === "episode"
                  ? "page"
                  : undefined
              }
              className={cn(
                "flex items-center gap-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                storyPackageOpen && storyPackageTab === "episode" &&
                  "text-foreground",
              )}
              disabled={!storyPackage}
              onClick={() => openStoryPackage("episode")}
              type="button"
            >
              <ScrollText className="size-3.5" />
              {locale === "en" ? "Episode scripts" : "分集剧本"}
            </button>
            <span className="text-[10px] text-muted-foreground">
              {episodes.length || storyPackage?.format.episodeCount || 0}
            </span>
          </div>
          {storyPackage ? (
            <button
              className="mb-1 flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60"
              onClick={() => openStoryPackage("episode")}
              type="button"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background font-mono text-[10px]">
                01
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {storyPackage.firstEpisode.title}
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                  {locale === "en" ? "Package draft" : "策划包正文"}
                </span>
              </span>
            </button>
          ) : null}
          {episodes.length ? (
            <div className="space-y-1 p-2">
              {episodes.length > pageSize ? <>
                <Input aria-label={locale === "en" ? "Search episodes" : "搜索分集"}
                  placeholder={locale === "en" ? "Episode number or title" : "集数或标题"}
                  value={episodeSearch} onChange={event => {
                    setEpisodeSearch(event.target.value);
                    setNavigation({ selectedEpisodeId, page: 0 });
                  }} className="mb-2 h-8 text-xs" />
                <div className="flex items-center justify-between gap-1 pb-2 text-[10px] text-muted-foreground">
                  <Button size="sm" variant="ghost" aria-label={locale === "en" ? "Previous episode page" : "上一页分集"}
                    disabled={page === 0} onClick={() => setNavigation({ selectedEpisodeId, page: page - 1 })}>←</Button>
                  <span aria-live="polite">{page + 1}/{pageCount} · {filteredEpisodes.length}</span>
                  <Button size="sm" variant="ghost" aria-label={locale === "en" ? "Next episode page" : "下一页分集"}
                    disabled={page + 1 >= pageCount} onClick={() => setNavigation({ selectedEpisodeId, page: page + 1 })}>→</Button>
                </div>
                {!filteredEpisodes.length ? <p className="py-3 text-xs text-muted-foreground">{locale === "en" ? "No matching episodes" : "没有匹配的分集"}</p> : null}
              </> : null}
              {visibleEpisodes.map((episode) => {
                const writingState = getStudioStageStates(
                  snapshot,
                  episode.id,
                )[0];
                const active = episode.id === selectedEpisodeId;
                return (
                  <button
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/60",
                    )}
                    key={episode.id}
                    onClick={() => onSelect(episode.id)}
                    type="button"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background font-mono text-[10px]">
                      {String(episode.episodeNumber).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {episode.name}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <StatusIndicator
                          compact
                          locale={locale}
                          status={writingState.status}
                        />
                        {episode.novelText
                          ? `${episode.novelText.length.toLocaleString()} ${copy.characters}`
                          : copy.notStarted}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : !storyPackage ? (
            <Empty className="flex-1 justify-start gap-5 rounded-none border-0 px-3 py-6 text-left">
              <EmptyHeader className="w-full max-w-none flex-row items-center gap-3 border-b pb-5">
                <EmptyMedia className="mb-0" variant="icon">
                  <ScrollText />
                </EmptyMedia>
                <EmptyTitle>{copy.noEpisodes}</EmptyTitle>
                <EmptyDescription className="sr-only">
                  {copy.noEpisodes}
                </EmptyDescription>
              </EmptyHeader>
              <div className="grid w-full gap-2">
                <CreateEpisodeDialog
                  createEpisode={createEpisode}
                  locale={locale}
                  onCreated={onCreated}
                  trigger={
                    <Button className="w-full justify-start">
                      <FilePlus2 className="size-4" />
                      {copy.addEpisode}
                    </Button>
                  }
                />
                <SplitNovelDialog
                  locale={locale}
                  models={models}
                  onCompleted={onRefresh}
                  projectId={snapshot.project.id}
                  trigger={
                    <Button className="w-full justify-start" variant="outline">
                      <Scissors className="size-4" />
                      {copy.splitNovel}
                    </Button>
                  }
                />
              </div>
            </Empty>
          ) : null}
        </section>
      </ScrollArea>
      {showDossier && dossier && dossierDeliverable ? <ManuscriptDossierDialog
        key={`${dossierDeliverable.id}:${storyPackageTab}`} projectId={snapshot.project.id}
        deliverable={dossierDeliverable} dossier={dossier} initialTab={storyPackageTab}
        open={storyPackageOpen} onOpenChange={setStoryPackageOpen} onRefresh={onRefresh} locale={locale}
      /> : storyPackage && storyPackageDeliverable ? (
        <StoryPackageReviewDialog
          key={storyPackageTab}
          projectId={snapshot.project.id}
          deliverableId={storyPackageDeliverable.id}
          onAdopted={onRefresh}
          deliverableTitle={storyPackageDeliverable.title}
          initialTab={storyPackageTab}
          locale={locale}
          onOpenChange={setStoryPackageOpen}
          open={storyPackageOpen}
          storyPackage={storyPackage}
          status={storyPackageDeliverable.status}
          version={storyPackageDeliverable.version}
        />
      ) : null}
    </div>
  );
}

function isStoryPackageDeliverable(
  deliverable: ProductionDeliverableRecord,
) {
  return (
    deliverable.payload.packageFormat === "cyanyi-story-package-v1" &&
    Boolean(readStoryPackage(deliverable))
  );
}

function readStoryPackage(
  deliverable: ProductionDeliverableRecord,
): StoryPackage | null {
  const value = deliverable.payload.storyPackage;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as StoryPackage;
}
