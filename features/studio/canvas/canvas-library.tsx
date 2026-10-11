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
import { groupCanvasCards } from "./canvas-categories";
import {
  kindLabel,
  panelCard,
  nodeMedia,
  canvasAssetCards,
  linkedCanvasAsset,
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
  const entities = canvasAssetCards(catalog);
  const assetOwners = new Map(entities.flatMap(card => {
    const entity = linkedCanvasAsset(card, catalog);
    return [...(entity?.candidates ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).flatMap((candidate, index) => candidate.assetId
      ? [[candidate.assetId, { name: card.title, selected: candidate.selected, version: index + 1 }] as const]
      : []);
  }));
  const baselineIds = new Set([...assetOwners].filter(([, owner]) => owner.selected).map(([id]) => id));
  const cards: CanvasCard[] = [
    ...panels.map(panelCard),
    ...entities,
    ...(catalog?.assets ?? [])
      .filter(
        (asset) =>
          asset.url &&
          asset.taskStatus === "succeeded" &&
          ["image", "video", "audio"].includes(asset.kind),
      )
      .map((asset) => {
        const owner = assetOwners.get(asset.id);
        const sourceEntity = entities.find(card => asset.references.some(ref => ref.entityId === card.entityId));
        const sourcePanel = panels.find(panel => asset.sourceTargetId === panel.id || asset.references.some(ref => ref.entityId === panel.id));
        const sourceName = owner?.name ?? sourceEntity?.title ?? (sourcePanel ? t(`镜头 ${sourcePanel.panelIndex + 1}`, `Shot ${sourcePanel.panelIndex + 1}`) : undefined);
        return {
          id: `asset-${asset.id}`,
          kind: asset.kind as "image" | "video" | "audio",
          title: sourceName
            ? `${sourceName} · ${kindLabel(asset.kind as "image", locale)}${owner ? t(` · 版本 ${owner.version}`, ` · Version ${owner.version}`) : ""}`
            : typeof asset.metadata.title === "string"
              ? asset.metadata.title
              : `${kindLabel(asset.kind as "image", locale)} · ${asset.createdAt.slice(5, 16).replace("T", " ")}`,
          text: "",
          assetId: asset.id,
          entityId: asset.sourceTargetType === "voice_line"
            ? (asset.sourceTargetId ?? undefined)
            : undefined,
          x: 0,
          y: 0,
        };
      }),
  ];
  const visible = cards.filter(
    (card) =>
      (filter === "all" || card.kind === filter) &&
      // The entity card already shows its adopted image in the All view.
      !(filter === "all" && card.assetId && baselineIds.has(card.assetId)) &&
      `${card.title} ${kindLabel(card.kind, locale)}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const sections = groupCanvasCards(visible, locale);
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
          size="default"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <NativeSelectOption value="all">
            {t("全部", "All")}
          </NativeSelectOption>
          {groupCanvasCards(cards, locale).map((section) => (
            <NativeSelectOption key={section.id} value={section.id}>
              {section.label} ({section.nodes.length})
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto p-2">
        {sections.map(section => (
          <section key={section.id} className="mb-4">
            <h3 className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
              <span>{section.label}</span><span>{section.nodes.length}</span>
            </h3>
            <div className="grid grid-cols-2 gap-2">
          {section.nodes.map((card) => {
            const asset = nodeMedia(card, catalog, panels);
            const entity = linkedCanvasAsset(card, catalog);
            const owner = card.assetId ? assetOwners.get(card.assetId) : undefined;
            const subtitle = entity ? (entity.candidates.some(candidate => candidate.selected && candidate.url)
              ? t("已采用基准", "Baseline adopted") : t("待生成基准", "Baseline needed"))
              : owner?.selected ? t("基准图", "Baseline image") : kindLabel(card.kind, locale);
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
                  <span className="block break-words text-xs font-medium leading-5">
                    {card.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {subtitle}
                  </span>
                </span>
              </button>
            );
          })}
            </div>
          </section>
        ))}
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
