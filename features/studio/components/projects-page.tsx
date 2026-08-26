"use client";

import { useState } from "react";
import { FolderOpen, Grid2X2, List, RotateCcw, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useProjects } from "../hooks/use-projects";
import { useStudioLocale } from "../hooks/use-studio-locale";
import { getStudioCopy } from "../i18n";
import { CreateProjectDialog } from "./create-project-dialog";
import { ProjectItem } from "./project-item";
import { StudioAppHeader } from "./studio-app-header";

export function ProjectsPage() {
  const { locale, toggleLocale } = useStudioLocale();
  const copy = getStudioCopy(locale);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const { createProject, data, error, isLoading, reload } = useProjects(search);
  const projects = data?.projects ?? [];

  return (
    <TooltipProvider>
      <div className="flex h-dvh min-h-0 flex-col bg-background">
        <StudioAppHeader locale={locale} onLocaleChange={toggleLocale} />

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 sm:py-10">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-semibold">{copy.projects}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {data
                    ? `${data.pagination.total} ${copy.projectUnit}`
                    : "\u00a0"}
                </p>
              </div>
              <CreateProjectDialog
                createProject={createProject}
                locale={locale}
              />
            </div>

            <div className="mt-8 flex items-center gap-2 border-y py-3">
              <div className="relative max-w-md flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label={copy.searchProjects}
                  className="pl-8 pr-8"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={copy.searchProjects}
                  value={search}
                />
                {search ? (
                  <Button
                    aria-label={copy.clearSearch}
                    className="absolute top-1/2 right-0.5 -translate-y-1/2"
                    onClick={() => setSearch("")}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <X className="size-3.5" />
                  </Button>
                ) : null}
              </div>

              <div className="ml-auto flex h-8 items-center rounded-md border p-0.5">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={copy.gridView}
                        aria-pressed={view === "grid"}
                        className={cn(view === "grid" && "bg-muted")}
                        onClick={() => setView("grid")}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      />
                    }
                  >
                    <Grid2X2 className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>{copy.gridView}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={copy.listView}
                        aria-pressed={view === "list"}
                        className={cn(view === "list" && "bg-muted")}
                        onClick={() => setView("list")}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      />
                    }
                  >
                    <List className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>{copy.listView}</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {isLoading && !data ? (
              <ProjectSkeletons view={view} />
            ) : error ? (
              <Empty className="min-h-80 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <RotateCcw />
                  </EmptyMedia>
                  <EmptyTitle>{copy.loadFailed}</EmptyTitle>
                  <EmptyDescription>{error}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={reload} variant="outline">
                    <RotateCcw className="size-4" />
                    {copy.retry}
                  </Button>
                </EmptyContent>
              </Empty>
            ) : projects.length ? (
              <div
                className={cn(
                  "mt-6",
                  view === "grid"
                    ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                    : "grid gap-3",
                )}
              >
                {projects.map((project) => (
                  <ProjectItem
                    key={project.id}
                    locale={locale}
                    project={project}
                    view={view}
                  />
                ))}
              </div>
            ) : (
              <Empty className="min-h-80 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FolderOpen />
                  </EmptyMedia>
                  <EmptyTitle>
                    {search ? copy.noSearchResults : copy.noProjects}
                  </EmptyTitle>
                </EmptyHeader>
                <EmptyContent>
                  {search ? (
                    <Button onClick={() => setSearch("")} variant="outline">
                      <X className="size-4" />
                      {copy.clearSearch}
                    </Button>
                  ) : (
                    <CreateProjectDialog
                      createProject={createProject}
                      locale={locale}
                    />
                  )}
                </EmptyContent>
              </Empty>
            )}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}

function ProjectSkeletons({ view }: { view: "grid" | "list" }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "mt-6",
        view === "grid"
          ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          : "grid gap-3",
      )}
    >
      {Array.from({ length: view === "grid" ? 8 : 4 }).map((_, index) => (
        <div
          className={cn(
            "overflow-hidden rounded-lg border",
            view === "list" && "flex h-28",
          )}
          key={index}
        >
          <Skeleton
            className={cn(
              "rounded-none",
              view === "grid" ? "h-32 w-full" : "h-full w-48",
            )}
          />
          <div className="flex-1 space-y-3 p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
