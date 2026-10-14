"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { StudioLocale } from "../types";
import { canvasEpisodeNavigation, type CanvasEpisodeOption } from "./canvas-episode-navigation";

export function CanvasEpisodeSwitcher({ episodes, episodeId, locale, disabled, onSelect }: {
  episodes: CanvasEpisodeOption[];
  episodeId: string;
  locale: StudioLocale;
  disabled: boolean;
  onSelect: (episodeId: string) => Promise<void>;
}) {
  const { ordered, previous, next } = canvasEpisodeNavigation(episodes, episodeId);
  const [switching, setSwitching] = useState(false);
  const switchingRef = useRef(false);
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  async function select(id?: string) {
    if (!id || id === episodeId || disabled || switchingRef.current || !ordered.some(episode => episode.id === id)) return;
    switchingRef.current = true;
    setSwitching(true);
    try { await onSelect(id); }
    catch (error) { toast.error(error instanceof Error ? error.message : t("切换剧集失败，请重试", "Could not switch episodes. Try again.")); }
    finally { switchingRef.current = false; setSwitching(false); }
  }
  return (
    <nav aria-label={t("画布剧集切换", "Canvas episode navigation")}
      className="order-last flex w-full min-w-0 items-center justify-center gap-1 border-t pt-1.5 sm:order-none sm:w-auto sm:justify-start sm:border-t-0 sm:pt-0">
      <Button size="icon-sm" variant="ghost" aria-label={t("上一集", "Previous episode")} title={t("上一集", "Previous episode")}
        disabled={disabled || switching || !previous} onClick={() => void select(previous?.id)}>
        <ChevronLeft className="size-4" />
      </Button>
      <NativeSelect size="sm" className="h-8 w-48 max-w-[calc(100vw-7rem)] text-xs xl:w-56"
        aria-label={t("选择剧集", "Select episode")} value={episodeId} disabled={disabled || switching || !ordered.length}
        onChange={event => void select(event.target.value)}>
        {ordered.map(episode => (
          <NativeSelectOption key={episode.id} value={episode.id}>
            {t(`第 ${episode.episodeNumber} 集`, `Episode ${episode.episodeNumber}`)}{episode.name ? ` · ${episode.name}` : ""}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button size="icon-sm" variant="ghost" aria-label={t("下一集", "Next episode")} title={t("下一集", "Next episode")}
        disabled={disabled || switching || !next} onClick={() => void select(next?.id)}>
        {switching ? <LoaderCircle className="size-4 animate-spin" /> : <ChevronRight className="size-4" />}
      </Button>
    </nav>
  );
}
