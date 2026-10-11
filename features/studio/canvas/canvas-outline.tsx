"use client";
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Clapperboard,
  ImageIcon,
  FileText,
  Video,
  AudioLines,
  UserRound,
  MapPin,
  Package,
} from "lucide-react";
import type { CanvasDocument } from "./types";
import type { StudioLocale } from "../types";
import { kindLabel } from "./canvas-view-model";
import { groupCanvasCards } from "./canvas-categories";

export function CanvasOutline({
  document,
  selected,
  locale,
  onSelect,
}: {
  document: CanvasDocument;
  selected: Set<string>;
  locale: StudioLocale;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const sections = groupCanvasCards(document.nodes, locale);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = (node: typeof document.nodes[number], label: string) =>
    `${label} ${node.title} ${kindLabel(node.kind, locale)} ${document.edges
      .filter(edge => edge.to === node.id)
      .map(edge => document.nodes.find(source => source.id === edge.from)?.title ?? "")
      .join(" ")}`.toLocaleLowerCase().includes(normalizedQuery);
  const icons = {
    panel: Clapperboard,
    text: FileText,
    image: ImageIcon,
    video: Video,
    audio: AudioLines,
    character: UserRound,
    location: MapPin,
    prop: Package,
  };
  return (
    <aside
      aria-label={t("画布节点导航", "Canvas outline")}
      className="hidden w-52 shrink-0 flex-col border-r bg-background lg:flex xl:w-60"
    >
      <header className="flex h-12 shrink-0 items-center justify-between px-4 text-sm font-medium">
        {t("节点目录", "Node outline")}
        <span className="text-xs font-normal text-muted-foreground">
          {document.nodes.length}
        </span>
      </header>
      <label className="mx-3 mb-3 flex items-center gap-2 rounded-lg border bg-muted/20 px-2.5">
        <Search className="size-3.5 text-muted-foreground" />
        <input
          aria-label={t("搜索节点", "Search nodes")}
          placeholder={t("搜索镜头、角色…", "Search shots, characters…")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
      </label>
      <nav className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {sections.map((section) => {
          const nodes = section.nodes.filter(node => matches(node, section.label));
          if (!nodes.length) return null;
          const closed = !query && collapsed.has(section.id);
          return (
            <section key={section.id} className="mb-2">
              <button
                type="button"
                aria-expanded={!closed}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
                onClick={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(section.id)) next.delete(section.id);
                    else next.add(section.id);
                    return next;
                  })
                }
              >
                {closed ? (
                  <ChevronRight className="size-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="size-3.5 shrink-0" />
                )}
                <span className="flex-1 truncate">{section.label}</span>
                <span>{nodes.length}</span>
              </button>
              {!closed &&
                nodes.map((node) => {
                  const Icon = icons[node.kind];
                  return (
                    <button
                      key={node.id}
                      type="button"
                      aria-current={selected.has(node.id) ? "true" : undefined}
                      title={node.title}
                      onClick={() => onSelect(node.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs focus-visible:ring-2 focus-visible:ring-primary ${selected.has(node.id) ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                    >
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{node.title}</span>
                        {["image", "video", "audio"].includes(node.kind) && document.edges.some((edge) => edge.to === node.id) && (
                          <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                            ←{" "}
                            {document.edges
                              .filter((edge) => edge.to === node.id)
                              .map(
                                (edge) =>
                                  document.nodes.find(
                                    (item) => item.id === edge.from,
                                  )?.title,
                              )
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
            </section>
          );
        })}
        {!document.nodes.length && (
          <p className="px-3 py-6 text-xs text-muted-foreground">
            {t(
              "添加内容后在这里定位节点",
              "Add content to navigate nodes here",
            )}
          </p>
        )}
        {query &&
          !sections.some(section => section.nodes.some(node => matches(node, section.label))) && (
            <p className="px-3 py-6 text-xs text-muted-foreground">
              {t("没有匹配的节点", "No matching nodes")}
            </p>
          )}
      </nav>
    </aside>
  );
}
