"use client";

import { Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { fallbackComposerTemplates } from "./composer-data";
import type { AgentComposerTemplate } from "./types";

type TemplateGalleryProps = {
  isLoading?: boolean;
  onSelect: (template: AgentComposerTemplate) => void;
  selectedTemplateId: string;
  templates: AgentComposerTemplate[];
};

export function TemplateGallery({
  isLoading,
  onSelect,
  selectedTemplateId,
  templates,
}: TemplateGalleryProps) {
  return (
    <div className="mb-2 w-full rounded-2xl border bg-background p-2 shadow-sm">
      <div className="thin-scrollbar max-h-[440px] columns-2 gap-2 overflow-y-auto pr-1 sm:columns-3 lg:columns-4">
        {templates.map((template, index) => (
          <TemplateCard
            index={index}
            key={template.id}
            onSelect={onSelect}
            selected={template.id === selectedTemplateId}
            template={template}
          />
        ))}
      </div>
      {isLoading ? (
        <div className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          正在加载模板
        </div>
      ) : null}
    </div>
  );
}

function TemplateCard({
  index,
  onSelect,
  selected,
  template,
}: {
  index: number;
  onSelect: (template: AgentComposerTemplate) => void;
  selected: boolean;
  template: AgentComposerTemplate;
}) {
  const [imageSrc, setImageSrc] = useState(template.imageUrl);
  const fallbackImage =
    fallbackComposerTemplates[index % fallbackComposerTemplates.length]
      ?.imageUrl;

  return (
    <Button
      className={cn(
        "group relative mb-2 block h-auto w-full break-inside-avoid overflow-hidden rounded-lg border bg-muted p-0 text-left shadow-none",
        getTemplateSpanClass(index),
        selected && "border-primary ring-2 ring-primary/25",
      )}
      onClick={() => onSelect(template)}
      type="button"
      variant="ghost"
    >
      {/* Provider/template URLs are dynamic; host apps can swap this for next/image when domains are fixed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={template.title}
        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        onError={() => {
          if (fallbackImage && imageSrc !== fallbackImage) {
            setImageSrc(fallbackImage);
          }
        }}
        src={imageSrc}
      />
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/75 to-transparent p-2 text-white">
        <p className="line-clamp-1 text-xs font-medium">{template.title}</p>
        <p className="line-clamp-1 text-[11px] text-white/75">
          {template.description}
        </p>
      </div>
      {selected ? (
        <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" />
        </span>
      ) : null}
    </Button>
  );
}

function getTemplateSpanClass(index: number) {
  const pattern = [
    "aspect-[4/3]",
    "aspect-square",
    "aspect-[3/4]",
    "aspect-[4/5]",
    "aspect-square",
    "aspect-[3/4]",
    "aspect-[4/3]",
    "aspect-square",
  ];

  return pattern[index % pattern.length];
}
