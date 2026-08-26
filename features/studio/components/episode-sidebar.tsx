"use client";

import { FilePlus2, ScrollText } from "lucide-react";

import { Button } from "@/components/ui/button";
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

import { getStudioStageStates } from "../stage-state";
import { getStudioCopy } from "../i18n";
import type {
  StudioLocale,
  StudioModelOption,
  WorkspaceSnapshot,
} from "../types";
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
}) {
  const copy = getStudioCopy(locale);
  const episodes = snapshot.project.episodes;

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

      {episodes.length ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 p-2">
            {episodes.map((episode) => {
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
        </ScrollArea>
      ) : (
        <Empty className="rounded-none border-0 px-4">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScrollText />
            </EmptyMedia>
            <EmptyTitle>{copy.noEpisodes}</EmptyTitle>
            <EmptyDescription className="sr-only">
              {copy.noEpisodes}
            </EmptyDescription>
          </EmptyHeader>
          <div className="flex flex-col gap-2">
            <CreateEpisodeDialog
              createEpisode={createEpisode}
              locale={locale}
              onCreated={onCreated}
              trigger={
                <Button variant="outline">
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
            />
          </div>
        </Empty>
      )}
    </div>
  );
}
