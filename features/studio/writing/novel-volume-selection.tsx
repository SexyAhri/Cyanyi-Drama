"use client";

import { useId, useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { NovelStructure } from "@/lib/episodes/novel-volumes";

import { getStudioCopy } from "../i18n";
import type { StudioLocale } from "../types";

export function NovelVolumeSelection({
  disabled,
  locale,
  onChange,
  selectedIndices,
  structure,
}: {
  disabled: boolean;
  locale: StudioLocale;
  onChange: (indices: number[]) => void;
  selectedIndices: number[];
  structure: NovelStructure;
}) {
  const copy = getStudioCopy(locale);
  const headingId = useId();
  const selected = useMemo(() => new Set(selectedIndices), [selectedIndices]);
  const selectedChapterCount = structure.volumes.reduce(
    (total, volume) =>
      total + (selected.has(volume.index) ? volume.chapters.length : 0),
    0,
  );
  const allSelected =
    structure.volumes.length > 0 &&
    selectedIndices.length === structure.volumes.length;

  return (
    <section aria-labelledby={headingId} className="border-y">
      <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-sm font-semibold" id={headingId}>
            {copy.splitVolumeSelection}
          </h3>
          <Badge variant="outline">
            {copy.splitDetectedVolumes
              .replace("{volumes}", String(structure.volumes.length))
              .replace("{chapters}", String(structure.totalChapters))}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            disabled={disabled || allSelected}
            onClick={() =>
              onChange(structure.volumes.map((volume) => volume.index))
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            {copy.splitSelectAllVolumes}
          </Button>
          <Button
            disabled={disabled || selectedIndices.length === 0}
            onClick={() => onChange([])}
            size="sm"
            type="button"
            variant="ghost"
          >
            {copy.splitClearVolumeSelection}
          </Button>
        </div>
      </div>

      <div className="max-h-52 divide-y overflow-y-auto border-t">
        {structure.volumes.map((volume) => {
          const firstChapter = volume.chapters[0]?.heading;
          const lastChapter = volume.chapters.at(-1)?.heading;
          return (
            <label
              className="flex cursor-pointer items-start gap-3 py-3 pr-2"
              key={`${volume.index}-${volume.startIndex}`}
            >
              <Checkbox
                checked={selected.has(volume.index)}
                disabled={disabled || volume.chapters.length === 0}
                onCheckedChange={(checked) =>
                  onChange(
                    checked
                      ? [...new Set([...selectedIndices, volume.index])].sort(
                          (left, right) => left - right,
                        )
                      : selectedIndices.filter((index) => index !== volume.index),
                  )
                }
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium">{volume.title}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {copy.splitVolumeChapterCount.replace(
                      "{count}",
                      String(volume.chapters.length),
                    )}
                  </span>
                </span>
                {firstChapter && lastChapter ? (
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {firstChapter} - {lastChapter}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>

      <div
        aria-live="polite"
        className="border-t py-2 text-xs text-muted-foreground"
      >
        {selectedIndices.length
          ? copy.splitSelectedVolumes
              .replace("{selected}", String(selectedIndices.length))
              .replace("{total}", String(structure.volumes.length))
              .replace("{chapters}", String(selectedChapterCount))
          : copy.splitNoVolumeSelected}
      </div>
    </section>
  );
}
