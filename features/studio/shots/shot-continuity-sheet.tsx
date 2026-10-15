"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MediaPreviewDialog } from "@/components/ui/media-preview-dialog";
import { PanelEditorDialog } from "../storyboard/panel-editor-dialog";
import type {
  ProjectMediaAsset,
  StudioLocale,
  StudioStoryboardPanel,
} from "../types";
import {
  buildShotContinuityFrames,
  continuityStateFields,
  continuityStateText,
} from "./shot-continuity";

export function ShotContinuitySheet({
  panels,
  assets,
  locale,
  onOpenShot,
  onSavePanel,
  onSelectPanel,
}: {
  panels: StudioStoryboardPanel[];
  assets: ProjectMediaAsset[];
  locale: StudioLocale;
  onOpenShot: (panelId: string) => void;
  onSavePanel: (panel: StudioStoryboardPanel) => Promise<unknown> | void;
  onSelectPanel?: (panelId: string) => void;
}) {
  const frames = useMemo(
    () => buildShotContinuityFrames(panels, assets),
    [panels, assets],
  );
  const [preview, setPreview] = useState<{
    url: string;
    title: string;
    assetId: string;
  }>();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const shotTitle = (panel: StudioStoryboardPanel) =>
    `${t("镜头", "Shot")} ${panel.panelIndex + 1}`;
  return (
    <section
      aria-label={t("连续性联系表", "Continuity contact sheet")}
      className="space-y-4"
    >
      <div className="space-y-2 border-b pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            {t("逐镜对照已采用画面", "Compare adopted frames in shot order")}
          </h2>
          <Badge variant="outline">
            {t("待人工审阅", "Human review required")}
          </Badge>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {t(
            "对照相邻画面的机位、人物站位与道具位置。下方起止状态来自分镜设定，不代表画面已通过检查。编辑单镜或打开候选进行局部修复，原有图片版本保留。",
            "Compare camera direction, character positions and prop placement between adjacent frames. Start/end states are storyboard settings, not verified image observations. Edit a shot or open its candidates for a local repair; existing image versions remain available.",
          )}
        </p>
      </div>
      {!frames.length ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("本集还没有正式镜头。", "This episode has no production shots.")}
        </p>
      ) : null}
      <div className="grid min-w-0 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {frames.map(
          ({ panel, image, previous, next, missingState, sceneNumber }) => (
            <article
              key={panel.id}
              data-continuity-panel={panel.id}
              className="min-w-0 overflow-hidden rounded-lg border"
            >
              <header className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                <h3 className="text-sm font-semibold">{shotTitle(panel)}</h3>
                <span className="text-xs text-muted-foreground">
                  {sceneNumber != null
                    ? `${t("场次", "Scene")} ${sceneNumber} · `
                    : ""}
                  {panel.locationName ||
                    t("场景未记录", "Location not recorded")}
                  {panel.durationSeconds != null
                    ? ` · ${panel.durationSeconds}s`
                    : ""}
                </span>
              </header>
              <div className="relative flex aspect-video items-center justify-center bg-muted/30">
                {image?.url ? (
                  <button
                    type="button"
                    className="flex size-full items-center justify-center focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={`${t("放大已采用关键帧", "Preview adopted frame")} · ${shotTitle(panel)}`}
                    onClick={() =>
                      setPreview({
                        url: image.url!,
                        title: shotTitle(panel),
                        assetId: image.id,
                      })
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt={`${shotTitle(panel)} · ${t("已采用关键帧", "Adopted keyframe")}`}
                      src={image.url}
                      loading="lazy"
                      className="size-full object-contain"
                    />
                  </button>
                ) : (
                  <div className="space-y-2 p-6 text-center text-sm text-muted-foreground">
                    <Images className="mx-auto size-6" />
                    <p>
                      {panel.imageAssetId
                        ? t(
                            "已采用素材暂不可用，请打开候选检查。",
                            "The adopted asset is unavailable. Open candidates to inspect it.",
                          )
                        : t("尚未采用关键帧", "No keyframe adopted")}
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-3 p-3 text-xs">
                <div className="flex flex-wrap justify-between gap-2 text-muted-foreground">
                  <span>
                    {previous
                      ? `${t("上一镜", "Previous")}: ${previous.panelIndex + 1}`
                      : t("本集开场", "Episode opening")}
                  </span>
                  <span>
                    {next
                      ? `${t("下一镜", "Next")}: ${next.panelIndex + 1}`
                      : t("本集结尾", "Episode ending")}
                  </span>
                </div>
                <p className="leading-5">
                  <span className="font-medium">
                    {t("人物：", "Characters: ")}
                  </span>
                  {panel.characters.join("、") || t("未记录", "Not recorded")}
                </p>
                <p className="leading-5">
                  <span className="font-medium">
                    {t("机位 / 运镜：", "Camera: ")}
                  </span>
                  {[panel.shotType, panel.cameraMove]
                    .filter(Boolean)
                    .join(" · ") || t("未记录", "Not recorded")}
                </p>
                <p className="leading-5">
                  <span className="font-medium">
                    {t("关键帧时刻：", "Keyframe moment: ")}
                  </span>
                  {panel.worldContext.keyframeMoment === "start"
                    ? t("动作开始", "Start of action")
                    : panel.worldContext.keyframeMoment === "end"
                      ? t("动作结束", "End of action")
                      : t("未记录", "Not recorded")}
                </p>
                {panel.description && (
                  <p className="whitespace-pre-wrap leading-5 text-muted-foreground">
                    {panel.description}
                  </p>
                )}
                {missingState && (
                  <p
                    role="status"
                    className="rounded border p-2 text-muted-foreground"
                  >
                    {t(
                      "尚未记录起止状态；请补充人物方向、道具位置等，再与实图对照。",
                      "Start/end states are not recorded. Add character direction and prop positions, then compare them with the actual image.",
                    )}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <ContinuityState
                    title={t("起始状态", "Start state")}
                    state={panel.startState}
                    locale={locale}
                  />
                  <ContinuityState
                    title={t("结束状态", "End state")}
                    state={panel.endState}
                    locale={locale}
                  />
                </div>
                {previous && (
                  <details className="rounded border p-2">
                    <summary className="cursor-pointer font-medium">
                      {t(
                        "对照上一镜结束状态",
                        "Compare previous shot's end state",
                      )}
                    </summary>
                    <div className="mt-2">
                      <ContinuityState
                        title={shotTitle(previous)}
                        state={previous.endState}
                        locale={locale}
                      />
                    </div>
                  </details>
                )}
                <details className="rounded border p-2">
                  <summary className="cursor-pointer font-medium">
                    {t(
                      "当前素材版本与提示词",
                      "Current media version and prompts",
                    )}
                  </summary>
                  <div className="mt-2 space-y-2 leading-5">
                    <p className="break-all">
                      {t("已采用版本：", "Adopted version: ")}
                      {panel.imageAssetId || t("无", "None")}
                    </p>
                    {image?.createdAt && (
                      <p>
                        {new Date(image.createdAt).toLocaleString(
                          locale === "en" ? "en-US" : "zh-CN",
                        )}
                      </p>
                    )}
                    <p className="font-medium">
                      {t("图片提示词", "Image prompt")}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-muted-foreground">
                      {panel.imagePrompt || t("未记录", "Not recorded")}
                    </p>
                    <p className="font-medium">
                      {t("动态提示词", "Motion prompt")}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-muted-foreground">
                      {panel.videoPrompt || t("未记录", "Not recorded")}
                    </p>
                  </div>
                </details>
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <PanelEditorDialog
                    key={`${panel.id}-${panel.updatedAt}`}
                    panel={panel}
                    locale={locale}
                    onSave={onSavePanel}
                    onOpenChange={(open) => {
                      if (open) onSelectPanel?.(panel.id);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenShot(panel.id)}
                  >
                    <ArrowUpRight className="size-3.5" />
                    {t("候选与局部修复", "Candidates / local repair")}
                  </Button>
                </div>
              </div>
            </article>
          ),
        )}
      </div>
      {preview && (
        <MediaPreviewDialog
          kind="image"
          open
          onOpenChange={(open) => {
            if (!open) setPreview(undefined);
          }}
          title={preview.title}
          description={`${t("素材版本", "Media version")} · ${preview.assetId}`}
          alt={preview.title}
          url={preview.url}
        />
      )}
    </section>
  );
}

function ContinuityState({
  title,
  state,
  locale,
}: {
  title: string;
  state: Record<string, unknown>;
  locale: StudioLocale;
}) {
  return (
    <section className="min-w-0 space-y-2">
      <h4 className="font-medium">{title}</h4>
      <dl className="space-y-2">
        {continuityStateFields.map((field) => (
          <div key={field.key}>
            <dt className="text-muted-foreground">
              {locale === "en" ? field.en : field.zh}
            </dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words leading-5">
              {continuityStateText(state, field.key) ||
                (locale === "en" ? "Not recorded" : "未记录")}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
