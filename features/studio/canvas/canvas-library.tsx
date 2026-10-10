"use client";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useState } from "react";
import { X, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ProjectAssetCatalog,
  StudioLocale,
  StudioStoryboardPanel,
} from "../types";
import type { CanvasCard } from "./types";
import {
  kindLabel,
  panelCard,
  nodeMedia,
  canvasAssetCards,
} from "./canvas-view-model";

export function CanvasLibrary({
  catalog,
  panels,
  locale,
  onAdd,
  onClose,
}: {
  catalog?: ProjectAssetCatalog;
  panels: StudioStoryboardPanel[];
  locale: StudioLocale;
  onAdd: (card: CanvasCard) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const cards: CanvasCard[] = [
    ...panels.map(panelCard),
    ...canvasAssetCards(catalog),
    ...(catalog?.assets ?? [])
      .filter(
        (asset) =>
          asset.url &&
          asset.taskStatus === "succeeded" &&
          ["image", "video", "audio"].includes(asset.kind),
      )
      .map((asset) => ({
        id: `asset-${asset.id}`,
        kind: asset.kind as "image" | "video" | "audio",
        title:
          typeof asset.metadata.title === "string"
            ? asset.metadata.title
            : `${kindLabel(asset.kind as "image", locale)} · ${asset.createdAt.slice(5, 16).replace("T", " ")}`,
        text: "",
        assetId: asset.id,
        entityId:
          asset.sourceTargetType === "voice_line"
            ? (asset.sourceTargetId ?? undefined)
            : undefined,
        x: 0,
        y: 0,
      })),
  ];
  const visible = cards.filter(
    (card) =>
      (filter === "all" || card.kind === filter) &&
      card.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <aside
      aria-label={t("项目素材库", "Project library")}
      className="flex h-[45%] w-full shrink-0 flex-col overflow-hidden border-b bg-background sm:h-full sm:w-52 sm:max-w-[45%] sm:border-b-0 sm:border-r xl:w-60"
      data-canvas-no-zoom
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b px-3 text-sm font-medium">
        {t("项目素材", "Project assets")}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("关闭素材库", "Close library")}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="space-y-2 border-b p-3">
        <label className="flex items-center gap-2 rounded-md border px-2">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            aria-label={t("搜索素材", "Search assets")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 w-full bg-transparent text-xs outline-none"
            placeholder={t("搜索角色、场景和素材", "Search assets")}
          />
        </label>
        <NativeSelect
          aria-label={t("素材类型", "Asset type")}
          className="h-8 w-full rounded border bg-background px-2 text-xs"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <NativeSelectOption value="all">
            {t("全部", "All")}
          </NativeSelectOption>
          {(
            [
              "panel",
              "character",
              "location",
              "prop",
              "image",
              "video",
              "audio",
            ] as const
          ).map((kind) => (
            <NativeSelectOption key={kind} value={kind}>
              {kindLabel(kind, locale)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-2 gap-2">
          {visible.map((card) => {
            const asset = nodeMedia(card, catalog, panels);
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onAdd(card)}
                title={`${card.title} · ${t("添加到画布", "Add to canvas")}`}
                className="min-w-0 overflow-hidden rounded-lg border bg-card text-left hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex aspect-video items-center justify-center overflow-hidden bg-muted text-[10px] text-muted-foreground">
                  {asset?.kind === "image" && asset.url ? (
                    <img
                      src={asset.url}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    kindLabel(card.kind, locale)
                  )}
                </div>
                <span className="block min-w-0 p-2">
                  <span className="block truncate text-xs font-medium">
                    {card.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {kindLabel(card.kind, locale)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {!visible.length && (
          <p className="p-4 text-xs leading-6 text-muted-foreground">
            {t(
              "没有匹配素材。可在资产或声音工作台创建后添加。",
              "No matching assets. Create assets in the production workspace first.",
            )}
          </p>
        )}
      </div>
    </aside>
  );
}
