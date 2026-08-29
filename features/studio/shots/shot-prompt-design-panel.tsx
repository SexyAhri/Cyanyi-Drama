"use client";

import { Edit3, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type {
  StudioLocale,
  StudioModelOption,
  StudioStoryboardPanel,
} from "../types";
import {
  parseActingDirections,
  parsePhotographyRules,
} from "../storyboard/previs-view-model";
import {
  ShotPromptDesignDialog,
  type PromptDesignVideoMode,
} from "./shot-prompt-design-dialog";
import { nextStoryboardPanel, type ShotMediaKind } from "./shot-view-model";

const text = {
  "zh-CN": {
    imageTitle: "关键帧提示词设计",
    videoTitle: "视频提示词设计",
    designed: "已设计",
    notDesigned: "未设计",
    edit: "编辑设计",
    generate: "AI 设计",
    promptSummary: "生成提示词",
    imageComposition: "镜头与构图",
    videoPerformance: "动作与表演",
    continuity: "连续性",
    startState: "开始",
    endState: "结束",
    linkedToNext: "与下一镜连续衔接",
    notAvailable: "暂无",
    noDesign: "尚未完成提示词设计",
    reference: "参考图",
    firstLast: "首尾帧",
  },
  en: {
    imageTitle: "Keyframe prompt design",
    videoTitle: "Video prompt design",
    designed: "Designed",
    notDesigned: "Not designed",
    edit: "Edit design",
    generate: "AI design",
    promptSummary: "Generation prompt",
    imageComposition: "Shot & composition",
    videoPerformance: "Action & performance",
    continuity: "Continuity",
    startState: "Start",
    endState: "End",
    linkedToNext: "Linked continuously to the next shot",
    notAvailable: "Not available",
    noDesign: "No prompt design has been completed",
    reference: "Reference image",
    firstLast: "First and last frame",
  },
} as const;

export function ShotPromptDesignPanel({
  analysisModels,
  episodeId,
  kind,
  locale,
  onSave,
  panel,
  panels,
  projectId,
}: {
  analysisModels: StudioModelOption[];
  episodeId: string;
  kind: ShotMediaKind;
  locale: StudioLocale;
  onSave: (input: {
    mode: PromptDesignVideoMode;
    prompt: string;
  }) => Promise<unknown> | void;
  panel: StudioStoryboardPanel;
  panels: StudioStoryboardPanel[];
  projectId: string;
}) {
  const copy = text[locale];
  const [mode, setMode] = useState<PromptDesignVideoMode>("reference");
  const nextPanel = nextStoryboardPanel(panel, panels);
  const canUseFirstLast = Boolean(panel.imageAssetId && nextPanel?.imageAssetId);
  const prompt =
    kind === "image"
      ? panel.imagePrompt
      : mode === "first-last"
        ? panel.firstLastFramePrompt
        : panel.videoPrompt;
  const designSummary = summarizeDesign(panel, kind, copy.notAvailable);
  const continuitySummary = summarizeContinuity(panel, {
    endState: copy.endState,
    linkedToNext: copy.linkedToNext,
    notAvailable: copy.notAvailable,
    startState: copy.startState,
  });

  useEffect(() => {
    if (!canUseFirstLast && mode === "first-last") setMode("reference");
  }, [canUseFirstLast, mode]);

  return (
    <section className="border-b py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">
            {kind === "image" ? copy.imageTitle : copy.videoTitle}
          </h3>
          <Badge variant={prompt ? "secondary" : "outline"}>
            {prompt ? copy.designed : copy.notDesigned}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {kind === "video" ? (
            <div className="inline-flex rounded-md border p-0.5">
              <Button
                aria-pressed={mode === "reference"}
                onClick={() => setMode("reference")}
                size="sm"
                type="button"
                variant={mode === "reference" ? "secondary" : "ghost"}
              >
                {copy.reference}
              </Button>
              <Button
                aria-pressed={mode === "first-last"}
                disabled={!canUseFirstLast}
                onClick={() => setMode("first-last")}
                size="sm"
                type="button"
                variant={mode === "first-last" ? "secondary" : "ghost"}
              >
                {copy.firstLast}
              </Button>
            </div>
          ) : null}
          <ShotPromptDesignDialog
            analysisModels={analysisModels}
            episodeId={episodeId}
            kind={kind}
            locale={locale}
            mode={mode}
            onSave={onSave}
            panel={panel}
            projectId={projectId}
            trigger={
              <Button size="sm" type="button" variant="outline">
                {prompt ? (
                  <Edit3 className="size-4" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {prompt ? copy.edit : copy.generate}
              </Button>
            }
          />
        </div>
      </div>

      {prompt ? (
        <div className="mt-4 grid gap-x-8 gap-y-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(14rem,0.8fr)]">
          <ProfileValue label={copy.promptSummary} value={prompt} />
          <ProfileValue
            label={
              kind === "image"
                ? copy.imageComposition
                : copy.videoPerformance
            }
            value={designSummary}
          />
          <ProfileValue label={copy.continuity} value={continuitySummary} />
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{copy.noDesign}</p>
      )}
    </section>
  );
}

function ProfileValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 line-clamp-3 text-sm leading-6">{value}</p>
    </div>
  );
}

function summarizeDesign(
  panel: StudioStoryboardPanel,
  kind: ShotMediaKind,
  fallback: string,
) {
  if (kind === "image") {
    const photography = parsePhotographyRules(panel.photographyRules);
    return joinSummary([
      panel.shotType,
      panel.cameraMove,
      photography.composition,
      photography.cameraPosition,
      photography.focalLength,
      photography.lighting,
    ]) || fallback;
  }

  const motion = panel.motionBeats.flatMap((beat) => recordText(beat));
  const acting = parseActingDirections(panel.actingNotes).map((direction) =>
    [direction.name, direction.emotion, direction.action, direction.expression]
      .filter(Boolean)
      .join(": "),
  );
  return joinSummary([...motion, ...acting]) || panel.description || fallback;
}

function summarizeContinuity(
  panel: StudioStoryboardPanel,
  copy: {
    endState: string;
    linkedToNext: string;
    notAvailable: string;
    startState: string;
  },
) {
  const start = joinSummary(recordText(panel.startState));
  const end = joinSummary(recordText(panel.endState));
  return (
    joinSummary([
      start ? `${copy.startState}: ${start}` : "",
      end ? `${copy.endState}: ${end}` : "",
      panel.linkedToNextPanel ? copy.linkedToNext : "",
    ]) || copy.notAvailable
  );
}

function recordText(record: Record<string, unknown>): string[] {
  return Object.values(record).flatMap((value) => {
    if (typeof value === "string") return value.trim() ? [value.trim()] : [];
    if (Array.isArray(value)) {
      return value.flatMap((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? recordText(item as Record<string, unknown>)
          : typeof item === "string" && item.trim()
            ? [item.trim()]
            : [],
      );
    }
    if (value && typeof value === "object") {
      return recordText(value as Record<string, unknown>);
    }
    return [];
  });
}

function joinSummary(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean))].join(
    " · ",
  );
}
