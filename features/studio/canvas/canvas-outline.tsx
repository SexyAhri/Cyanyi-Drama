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
  const grouped = new Set(
    document.branchGroups?.flatMap((group) => group.nodeIds) ?? [],
  );
  const neighbors = new Map(
    document.nodes.map((node) => [node.id, new Set<string>()]),
  );
  for (const edge of document.edges) {
    if (!neighbors.has(edge.from) || !neighbors.has(edge.to)) continue;
    neighbors.get(edge.from)!.add(edge.to);
    neighbors.get(edge.to)!.add(edge.from);
  }
  const chains: { id: string; label: string; nodes: typeof document.nodes }[] =
    [];
  for (const node of document.nodes) {
    if (grouped.has(node.id) || !neighbors.get(node.id)?.size) continue;
    const ids = new Set([node.id]);
    const queue = [node.id];
    for (let i = 0; i < queue.length; i++) {
      for (const id of neighbors.get(queue[i]) ?? []) {
        if (ids.has(id)) continue;
        ids.add(id);
        queue.push(id);
      }
    }
    ids.forEach((id) => grouped.add(id));
    const nodes = document.nodes
      .filter((item) => ids.has(item.id))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    const root =
      nodes.find(
        (item) =>
          !document.edges.some(
            (edge) => edge.to === item.id && ids.has(edge.from),
          ),
      ) ?? nodes[0];
    chains.push({ id: `chain-${root.id}`, label: root.title, nodes });
  }
  const sections = [
    ...(document.branchGroups ?? []).map((group) => ({
      id: group.id,
      label: group.label,
      nodes: document.nodes.filter((node) => group.nodeIds.includes(node.id)),
    })),
    ...chains,
    {
      id: "other",
      label: t("独立内容", "Unconnected content"),
      nodes: document.nodes.filter((node) => !grouped.has(node.id)),
    },
  ].filter((section) => section.nodes.length);
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
        {t("节点", "Nodes")}
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
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {sections.map((section) => {
          const nodes = section.nodes.filter((node) =>
            `${node.title} ${kindLabel(node.kind, locale)}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          );
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
                        {document.edges.some((edge) => edge.to === node.id) && (
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
          !document.nodes.some((node) =>
            `${node.title} ${kindLabel(node.kind, locale)}`
              .toLowerCase()
              .includes(query.toLowerCase()),
          ) && (
            <p className="px-3 py-6 text-xs text-muted-foreground">
              {t("没有匹配的节点", "No matching nodes")}
            </p>
          )}
      </nav>
    </aside>
  );
}
