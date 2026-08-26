"use client";

import {
  Boxes,
  CheckSquare2,
  Download,
  ImagePlus,
  LoaderCircle,
  PackageOpen,
  Sparkles,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MediaTask } from "@/lib/media/task-contract";
import { cn } from "@/lib/utils";

import {
  loadStudioAssetCatalog,
  selectStudioAsset,
  uploadStudioAsset,
} from "../api";
import { getStudioCopy } from "../i18n";
import type {
  ProjectAssetCatalog,
  ProjectMediaAsset,
  StudioLocale,
  StudioModelOption,
  WorkspaceSnapshot,
} from "../types";
import { StatusIndicator } from "../components/status-indicator";
import { runtimeStatusToStageStatus } from "../stage-state";
import { AssetCandidateGrid } from "./asset-candidates";
import {
  AssetEntityDialog,
  ExtractAssetsDialog,
  GenerateAssetDialog,
} from "./asset-dialogs";
import {
  buildStudioAssetEntities,
  getProjectSourceAssets,
  type StudioAssetCandidate,
  type StudioAssetEntity,
  type StudioAssetKind,
} from "./asset-view-model";

type AssetTab = StudioAssetKind | "source";

export function AssetsWorkspace({
  analysisModels,
  imageModels,
  locale,
  onRefresh,
  snapshot,
}: {
  analysisModels: StudioModelOption[];
  imageModels: StudioModelOption[];
  locale: StudioLocale;
  onRefresh: () => Promise<unknown> | void;
  snapshot: WorkspaceSnapshot;
}) {
  const copy = getStudioCopy(locale);
  const [catalog, setCatalog] = useState<ProjectAssetCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<AssetTab>("character");
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [checkedEntityIds, setCheckedEntityIds] = useState<string[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const projectId = snapshot.project.id;
  const revision = snapshot.tasks
    .map((task) => `${task.id}:${task.status}:${task.updatedAt}`)
    .join("|");

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const result = await loadStudioAssetCatalog(projectId, signal);
        if (!signal?.aborted) setCatalog(result);
        return result;
      } catch (requestError) {
        if (!signal?.aborted) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : copy.loadFailed,
          );
        }
        return null;
      } finally {
        if (!signal?.aborted) setIsLoading(false);
      }
    },
    [copy.loadFailed, projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, revision]);

  const entities = useMemo(
    () =>
      catalog && tab !== "source"
        ? buildStudioAssetEntities(catalog, tab)
        : [],
    [catalog, tab],
  );
  const selectedEntity =
    entities.find((entity) => entity.id === selectedEntityId) ?? entities[0];

  useEffect(() => {
    if (!entities.length) {
      setSelectedEntityId("");
      setCheckedEntityIds([]);
      return;
    }
    if (!entities.some((entity) => entity.id === selectedEntityId)) {
      setSelectedEntityId(entities[0].id);
    }
    setCheckedEntityIds((current) =>
      current.filter((id) => entities.some((entity) => entity.id === id)),
    );
  }, [entities, selectedEntityId]);

  async function refreshAll() {
    await Promise.all([load(), onRefresh()]);
  }

  async function upload(file: File, entity?: StudioAssetEntity) {
    setIsUploading(true);
    try {
      const result = await uploadStudioAsset(projectId, {
        file,
        targetType: entity?.kind ?? "project",
        targetId: entity?.id ?? projectId,
      });
      if (entity?.kind === "prop") {
        await selectStudioAsset(projectId, {
          targetType: "prop",
          targetId: entity.id,
          assetId: result.asset.id,
        });
      }
      toast.success(copy.assetUploaded);
      await refreshAll();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : copy.actionFailed,
      );
    } finally {
      setIsUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      if (sourceInputRef.current) sourceInputRef.current.value = "";
    }
  }

  async function selectCandidate(candidate: StudioAssetCandidate) {
    if (!selectedEntity || !candidate.assetId) return;
    setIsSelecting(true);
    try {
      await selectStudioAsset(projectId, {
        targetType: selectedEntity.kind,
        targetId:
          selectedEntity.kind === "prop" ? selectedEntity.id : candidate.id,
        assetId:
          selectedEntity.kind === "prop" ? candidate.assetId : undefined,
      });
      toast.success(copy.assetSelected);
      await refreshAll();
    } catch (requestError) {
      toast.error(
        requestError instanceof Error ? requestError.message : copy.actionFailed,
      );
    } finally {
      setIsSelecting(false);
    }
  }

  if (isLoading && !catalog) {
    return (
      <div className="flex h-full min-h-96 items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }

  if (!catalog || error) {
    return (
      <div className="flex min-h-96 flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-sm text-destructive">{error ?? copy.loadFailed}</p>
        <Button onClick={() => void load()} type="button" variant="outline">
          {copy.retry}
        </Button>
      </div>
    );
  }

  const checkedEntities = entities.filter((entity) =>
    checkedEntityIds.includes(entity.id),
  );
  const sourceAssets = getProjectSourceAssets(catalog, projectId).filter(
    (asset) => asset.kind === "image",
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-7 sm:py-7">
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            {snapshot.project.name}
          </p>
          <h1 className="mt-1 text-xl font-semibold">{copy.assetLibrary}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab !== "source" ? (
            <>
              {checkedEntities.length ? (
                <GenerateAssetDialog
                  locale={locale}
                  models={imageModels}
                  onCompleted={refreshAll}
                  projectId={projectId}
                  targets={checkedEntities}
                  trigger={
                    <Button size="sm" variant="outline">
                      <Sparkles className="size-4" />
                      {copy.generateSelected} · {checkedEntities.length}
                    </Button>
                  }
                />
              ) : null}
              <AssetEntityDialog
                kind={tab}
                locale={locale}
                onCompleted={refreshAll}
                projectId={projectId}
              />
            </>
          ) : (
            <>
              <input
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
                ref={sourceInputRef}
                type="file"
              />
              <Button
                disabled={isUploading}
                onClick={() => sourceInputRef.current?.click()}
                size="sm"
                type="button"
                variant="outline"
              >
                {isUploading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                {copy.uploadSource}
              </Button>
              <ExtractAssetsDialog
                assetIds={selectedSourceIds}
                locale={locale}
                models={analysisModels}
                onCompleted={async () => {
                  setSelectedSourceIds([]);
                  await refreshAll();
                }}
                projectId={projectId}
                trigger={
                  <Button
                    disabled={!selectedSourceIds.length}
                    size="sm"
                  >
                    <CheckSquare2 className="size-4" />
                    {copy.extractAssets} · {selectedSourceIds.length}
                  </Button>
                }
              />
            </>
          )}
        </div>
      </header>

      <Tabs
        className="min-w-0 py-5"
        onValueChange={(value) => setTab(value as AssetTab)}
        value={tab}
      >
        <TabsList className="max-w-full overflow-x-auto" variant="line">
          <AssetTabTrigger count={catalog.characters.length} label={copy.characterAssets} value="character" />
          <AssetTabTrigger count={catalog.locations.length} label={copy.locationAssets} value="location" />
          <AssetTabTrigger count={catalog.props.length} label={copy.propAssets} value="prop" />
          <AssetTabTrigger count={sourceAssets.length} label={copy.sourceAssets} value="source" />
        </TabsList>

        {(["character", "location", "prop"] as const).map((kind) => (
          <TabsContent className="mt-4" key={kind} value={kind}>
            <DomainAssetView
              checkedEntityIds={checkedEntityIds}
              entities={entities}
              imageModels={imageModels}
              isSelecting={isSelecting}
              isUploading={isUploading}
              locale={locale}
              onCheckedChange={setCheckedEntityIds}
              onRefresh={refreshAll}
              onSelectCandidate={selectCandidate}
              onSelectEntity={setSelectedEntityId}
              onUpload={(file) => selectedEntity && upload(file, selectedEntity)}
              projectId={projectId}
              selectedEntity={selectedEntity}
              selectedEntityId={selectedEntity?.id}
              tasks={snapshot.tasks}
              uploadInputRef={uploadInputRef}
            />
          </TabsContent>
        ))}

        <TabsContent className="mt-4" value="source">
          <SourceAssetGrid
            assets={sourceAssets}
            locale={locale}
            onSelectionChange={setSelectedSourceIds}
            selectedIds={selectedSourceIds}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AssetTabTrigger({
  count,
  label,
  value,
}: {
  count: number;
  label: string;
  value: AssetTab;
}) {
  return (
    <TabsTrigger value={value}>
      {label}
      <Badge variant="secondary">{count}</Badge>
    </TabsTrigger>
  );
}

function DomainAssetView({
  checkedEntityIds,
  entities,
  imageModels,
  isSelecting,
  isUploading,
  locale,
  onCheckedChange,
  onRefresh,
  onSelectCandidate,
  onSelectEntity,
  onUpload,
  projectId,
  selectedEntity,
  selectedEntityId,
  tasks,
  uploadInputRef,
}: {
  checkedEntityIds: string[];
  entities: StudioAssetEntity[];
  imageModels: StudioModelOption[];
  isSelecting: boolean;
  isUploading: boolean;
  locale: StudioLocale;
  onCheckedChange: (ids: string[]) => void;
  onRefresh: () => Promise<unknown> | void;
  onSelectCandidate: (candidate: StudioAssetCandidate) => void;
  onSelectEntity: (id: string) => void;
  onUpload: (file: File) => void;
  projectId: string;
  selectedEntity?: StudioAssetEntity;
  selectedEntityId?: string;
  tasks: MediaTask[];
  uploadInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const copy = getStudioCopy(locale);
  if (!entities.length) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center gap-3 border-y text-center text-muted-foreground">
        <PackageOpen className="size-5" />
        <p className="text-sm">{copy.noDomainAssets}</p>
      </div>
    );
  }
  const allChecked =
    entities.length > 0 && checkedEntityIds.length === entities.length;
  return (
    <div className="grid min-h-[34rem] border-y lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="border-b lg:border-r lg:border-b-0">
        <label className="flex h-10 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
          <Checkbox
            aria-label={copy.selectedCount}
            checked={allChecked}
            onCheckedChange={(checked) =>
              onCheckedChange(checked ? entities.map((entity) => entity.id) : [])
            }
          />
          {copy.selectedCount} · {checkedEntityIds.length}
        </label>
        <div className="max-h-72 overflow-y-auto p-1.5 lg:max-h-[calc(100dvh-18rem)]">
          {entities.map((entity) => {
            const task = latestEntityTask(entity, tasks);
            return (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1",
                  entity.id === selectedEntityId && "bg-muted",
                )}
                key={entity.id}
              >
                <Checkbox
                  aria-label={entity.name}
                  checked={checkedEntityIds.includes(entity.id)}
                  onCheckedChange={(checked) =>
                    onCheckedChange(
                      checked
                        ? [...new Set([...checkedEntityIds, entity.id])]
                        : checkedEntityIds.filter((id) => id !== entity.id),
                    )
                  }
                />
                <button
                  className="min-w-0 flex-1 px-1 py-2 text-left"
                  onClick={() => onSelectEntity(entity.id)}
                  type="button"
                >
                  <span className="block truncate text-sm font-medium">
                    {entity.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {entity.candidates.length} {copy.candidates}
                  </span>
                </button>
                {task ? (
                  <StatusIndicator
                    compact
                    locale={locale}
                    status={runtimeStatusToStageStatus(task.status)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </aside>

      {selectedEntity ? (
        <section className="min-w-0 p-4 sm:p-5">
          <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold">
                {selectedEntity.name}
              </h2>
              {selectedEntity.description ? (
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  {selectedEntity.description}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <input
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload(file);
                }}
                ref={uploadInputRef}
                type="file"
              />
              <Button
                disabled={isUploading}
                onClick={() => uploadInputRef.current?.click()}
                size="sm"
                type="button"
                variant="outline"
              >
                {isUploading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-4" />
                )}
                {copy.uploadImage}
              </Button>
              <GenerateAssetDialog
                locale={locale}
                models={imageModels}
                onCompleted={onRefresh}
                projectId={projectId}
                targets={[selectedEntity]}
                trigger={
                  <Button size="sm">
                    <Sparkles className="size-4" />
                    {copy.generateImage}
                  </Button>
                }
              />
            </div>
          </header>
          <div className="pt-5">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold">{copy.candidates}</h3>
              <Badge variant="outline">{selectedEntity.candidates.length}</Badge>
            </div>
            <AssetCandidateGrid
              entity={selectedEntity}
              isSelecting={isSelecting}
              locale={locale}
              onSelect={onSelectCandidate}
              tasks={tasks}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SourceAssetGrid({
  assets,
  locale,
  onSelectionChange,
  selectedIds,
}: {
  assets: ProjectMediaAsset[];
  locale: StudioLocale;
  onSelectionChange: (ids: string[]) => void;
  selectedIds: string[];
}) {
  const copy = getStudioCopy(locale);
  if (!assets.length) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center gap-3 border-y text-center text-muted-foreground">
        <Boxes className="size-5" />
        <p className="text-sm">{copy.noSourceAssets}</p>
      </div>
    );
  }
  return (
    <div className="grid gap-3 border-y py-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {assets.map((asset) => {
        const selected = selectedIds.includes(asset.id);
        return (
          <label
            className={cn(
              "relative cursor-pointer overflow-hidden rounded-lg border bg-card",
              selected && "border-foreground/40 ring-1 ring-foreground/15",
            )}
            key={asset.id}
          >
            <Checkbox
              aria-label={copy.selectSources}
              checked={selected}
              className="absolute top-2 left-2 z-10 bg-background"
              onCheckedChange={(checked) =>
                onSelectionChange(
                  checked
                    ? [...new Set([...selectedIds, asset.id])]
                    : selectedIds.filter((id) => id !== asset.id),
                )
              }
            />
            <div className="aspect-4/3 bg-muted/35">
              {asset.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={copy.sourceAssets}
                  className="size-full object-contain"
                  src={asset.url}
                />
              ) : null}
            </div>
            <div className="flex h-10 items-center border-t px-2.5 text-xs text-muted-foreground">
              <StatusIndicator
                locale={locale}
                status={runtimeStatusToStageStatus(asset.taskStatus)}
              />
              {asset.url ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <a
                        aria-label={copy.download}
                        className={cn(
                          buttonVariants({ size: "icon-sm", variant: "ghost" }),
                          "ml-auto",
                        )}
                        download
                        href={asset.url}
                        onClick={(event) => event.stopPropagation()}
                      />
                    }
                  >
                    <Download className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>{copy.download}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </label>
        );
      })}
    </div>
  );
}

function latestEntityTask(entity: StudioAssetEntity, tasks: MediaTask[]) {
  const targetIds = new Set([
    entity.id,
    ...entity.candidates.map((candidate) => candidate.id),
  ]);
  return tasks
    .filter(
      (task) =>
        task.kind === "image" &&
        Boolean(task.targetId && targetIds.has(task.targetId)),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}
