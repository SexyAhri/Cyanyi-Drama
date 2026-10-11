"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Check, Image as ImageIcon, Pencil, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  buildCustomProjectArtStyle,
  CUSTOM_PROJECT_ART_STYLE_ID,
  getCustomProjectArtStyleDescription,
  isCustomProjectArtStyle,
  MAX_CUSTOM_PROJECT_ART_STYLE_LENGTH,
  PROJECT_ART_STYLES,
  type ProjectArtStyleLocale,
} from "@/lib/projects/art-style";

const previewPalettes = [
  "from-rose-300/80 via-amber-700/50 to-indigo-950",
  "from-cyan-300/80 via-blue-700/50 to-slate-950",
  "from-stone-300/80 via-amber-700/50 to-zinc-950",
  "from-violet-300/70 via-fuchsia-950 to-black",
  "from-sky-300/70 via-indigo-700/60 to-slate-950",
  "from-amber-200/80 via-orange-800/60 to-stone-950",
  "from-orange-200/80 via-red-900/50 to-stone-950",
  "from-stone-300/70 via-emerald-950 to-slate-950",
  "from-white via-slate-200 to-slate-500",
  "from-amber-200/80 via-red-800/60 to-stone-950",
  "from-cyan-300/80 via-fuchsia-700/50 to-indigo-950",
  "from-slate-200/80 via-blue-900/60 to-slate-950",
  "from-zinc-300/70 via-red-950 to-black",
  "from-violet-300/80 via-blue-800/60 to-indigo-950",
  "from-slate-300/70 via-emerald-950 to-zinc-950",
  "from-amber-200/80 via-orange-900/60 to-stone-950",
  "from-rose-300/80 via-amber-800/60 to-slate-950",
  "from-slate-300/80 via-sky-950 to-zinc-950",
  "from-gray-200/80 via-blue-900/50 to-slate-950",
  "from-pink-200/80 via-rose-700/50 to-amber-950",
  "from-sky-200/80 via-indigo-700/50 to-violet-950",
];

export function ProjectArtStylePicker({
  locale,
  onChange,
  trigger,
  value,
}: {
  locale: ProjectArtStyleLocale;
  onChange: (value: string) => void;
  trigger: ReactElement;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [customDraft, setCustomDraft] = useState("");
  const en = locale === "en";
  const customSelected = isCustomProjectArtStyle(value);
  const customDescription = getCustomProjectArtStyleDescription(value);
  const customLabel = en ? "Custom" : "自定义";
  const showCustom =
    !query.trim() ||
    `${customLabel} custom 自定义画风`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase());
  const styles = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return PROJECT_ART_STYLES;
    return PROJECT_ART_STYLES.filter((style) =>
      `${style.label[en ? "en" : "zh"]} ${style.direction[en ? "en" : "zh"]}`
        .toLocaleLowerCase()
        .includes(search),
    );
  }, [en, query]);

  useEffect(() => {
    setCustomDraft(customDescription);
  }, [customDescription]);

  return (
    <Popover
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
      open={open}
    >
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="center"
        className="w-[min(38rem,calc(100vw-2rem))] p-3 sm:p-4"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold">{en ? "Art style" : "画风"}</h3>
            <span className="text-[10px] text-muted-foreground">
              {en ? "Single select" : "单选"}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {en ? `${PROJECT_ART_STYLES.length + 1} styles` : `共 ${PROJECT_ART_STYLES.length + 1} 种`}
          </span>
        </div>
        <label className="relative mb-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-9 text-xs"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={en ? "Search art styles..." : "搜索画风..."}
            value={query}
          />
        </label>
        <div className="grid max-h-[min(55dvh,420px)] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
          {showCustom ? (
            <StyleCard
              active={customSelected}
              icon={<Pencil className="size-5" />}
              label={customLabel}
              onClick={() => onChange(CUSTOM_PROJECT_ART_STYLE_ID)}
              preview="from-neutral-700 via-neutral-800 to-neutral-950"
            />
          ) : null}
          {styles.map((style, index) => (
            <StyleCard
              active={value === style.id}
              icon={<ImageIcon className="size-5" />}
              key={style.id}
              label={style.label[en ? "en" : "zh"]}
              onClick={() => {
                onChange(style.id);
                setOpen(false);
              }}
              preview={previewPalettes[index % previewPalettes.length]}
            />
          ))}
          {styles.length === 0 && query.trim() && !showCustom ? (
            <p className="col-span-full py-8 text-center text-xs text-muted-foreground">
              {en ? "No matching styles" : "没有找到匹配的画风"}
            </p>
          ) : null}
        </div>
        {customSelected ? (
          <label className="mt-3 grid gap-1.5 border-t pt-3 text-xs font-medium">
            {en ? "Custom visual direction" : "自定义画风描述"}
            <Textarea
              className="min-h-20 resize-y text-xs leading-5"
              maxLength={MAX_CUSTOM_PROJECT_ART_STYLE_LENGTH}
              onBlur={() => onChange(buildCustomProjectArtStyle(customDraft))}
              onChange={(event) => setCustomDraft(event.target.value)}
              placeholder={
                en
                  ? "Describe the rendering style, palette, materials, and lighting. This will be used throughout the project."
                  : "描述渲染风格、配色、材质与光线；该画风会统一用于整个项目。"
              }
              value={customDraft}
            />
          </label>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function StyleCard({
  active,
  icon,
  label,
  onClick,
  preview,
}: {
  active: boolean;
  icon: ReactElement;
  label: string;
  onClick: () => void;
  preview: string;
}) {
  return (
    <button
      aria-pressed={active}
      className={`group overflow-hidden rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-primary ring-1 ring-primary" : "hover:border-primary/50"}`}
      onClick={onClick}
      type="button"
    >
      <span
        className={`relative flex aspect-[1.7] items-center justify-center overflow-hidden bg-gradient-to-br ${preview} text-white`}
      >
        <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" />
        <span className="relative drop-shadow-md transition-transform group-hover:scale-110">
          {icon}
        </span>
        {active ? (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-background/90 p-1 text-foreground">
            <Check className="size-3" />
          </span>
        ) : null}
      </span>
      <span className="block truncate px-2 py-1.5 text-center text-[10px] font-medium sm:text-[11px]">
        {label}
      </span>
    </button>
  );
}
