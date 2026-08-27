import {
  AudioLines,
  BookOpenText,
  Boxes,
  Film,
  PanelsTopLeft,
  UsersRound,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { getStageCopy, getStudioCopy } from "../i18n";
import type {
  StudioLocale,
  StudioStageId,
  StudioStageState,
} from "../types";
import { StatusIndicator } from "./status-indicator";

const NAVIGATION_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

const icons = {
  writing: BookOpenText,
  assets: UsersRound,
  storyboard: PanelsTopLeft,
  shots: Film,
  audio: AudioLines,
  delivery: Boxes,
} as const;

export function StageNavigation({
  activeStage,
  locale,
  onSelect,
  stages,
}: {
  activeStage: StudioStageId;
  locale: StudioLocale;
  onSelect: (stageId: StudioStageId) => void;
  stages: StudioStageState[];
}) {
  const copy = getStudioCopy(locale);
  return (
    <nav
      aria-label={copy.productionStages}
      className="shrink-0 overflow-x-auto border-b bg-background"
    >
      <div className="mx-auto flex h-14 min-w-max items-stretch px-2 sm:px-4">
        {stages.map((stage, index) => {
          const Icon = icons[stage.id];
          const label = getStageCopy(locale, stage.id);
          const active = activeStage === stage.id;
          return (
            <button
              aria-current={active ? "step" : undefined}
              className={cn(
                "relative flex min-w-24 items-center justify-center gap-2 border-b-2 px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:min-w-32",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent",
              )}
              key={stage.id}
              onClick={() => onSelect(stage.id)}
              onKeyDown={(event) => {
                if (!NAVIGATION_KEYS.has(event.key)) return;
                event.preventDefault();
                const targetIndex = getStageNavigationTarget(
                  index,
                  event.key,
                  stages.length,
                );
                const buttons =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    "button[data-stage-navigation-item]",
                  );
                buttons?.[targetIndex]?.focus();
                onSelect(stages[targetIndex].id);
              }}
              data-stage-navigation-item
              tabIndex={active ? 0 : -1}
              type="button"
            >
              <span className="text-[10px] text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <Icon className="size-4" />
              <span>{label.short}</span>
              <StatusIndicator
                compact
                locale={locale}
                status={stage.status}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function getStageNavigationTarget(
  currentIndex: number,
  key: string,
  itemCount: number,
) {
  if (itemCount <= 0) return 0;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowLeft") return (currentIndex - 1 + itemCount) % itemCount;
  if (key === "ArrowRight") return (currentIndex + 1) % itemCount;
  return currentIndex;
}
