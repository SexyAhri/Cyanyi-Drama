"use client";
import { useState } from "react";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import type { StoryboardProgress } from "@/lib/novel/storyboard-progress";
import type { StudioLocale } from "../types";

export function StoryboardProgressPanel({
  progress,
  locale,
}: {
  progress: StoryboardProgress;
  locale: StudioLocale;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const t = (zh: string, en: string) => (locale === "en" ? en : zh);
  const panel =
    progress.panels.find((item) => item.previewId === selectedId) ??
    progress.panels[0];
  const running = ["queued", "running", "canceling"].includes(progress.status);
  const percent = progress.totalScenes
    ? Math.min(
        100,
        Math.round((progress.completedScenes / progress.totalScenes) * 100),
      )
    : progress.totalPanels
      ? Math.min(
          100,
          Math.round((progress.completedPanels / progress.totalPanels) * 100),
        )
      : undefined;
  return (
    <section
      aria-label={t("已完成分镜", "Completed shots")}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div
        className="shrink-0 space-y-2 border-b pb-4"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="font-medium">
            {t("已完成", "Completed")} {progress.completedPanels}
            {progress.totalPanels !== null
              ? ` / ${progress.totalPanels}`
              : ""}{" "}
            {t("个镜头", "shots")}
          </span>
          <span className="text-xs text-muted-foreground">
            {progress.totalScenes !== null
              ? progress.completedScenes
              : progress.completedBatches}
            {(progress.totalScenes ?? progress.totalBatches) !== null
              ? ` / ${progress.totalScenes ?? progress.totalBatches}`
              : ""}{" "}
            {progress.totalScenes !== null
              ? t("场", "scenes")
              : t("批", "batches")}{" "}
            · {t("最近结果", "Latest result")}{" "}
            {new Date(progress.updatedAt).toLocaleTimeString(
              locale === "en" ? "en-US" : "zh-CN",
              { hour: "2-digit", minute: "2-digit", second: "2-digit" },
            )}
          </span>
        </div>
        {percent !== undefined && (
          <div
            role="progressbar"
            aria-label={t("分镜进度", "Storyboard progress")}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-[width] motion-reduce:transition-none"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
        <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          {running && (
            <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
          )}
          <span>
            {running
              ? progress.totalScenes !== null
                ? progress.phase === "reviewing"
                  ? t(
                      "镜头已生成，正在汇总审核剧情覆盖、表演与镜头衔接。",
                      "Shots generated. Reviewing story coverage, performance and continuity.",
                    )
                  : progress.phase === "repairing"
                    ? t(
                        "正在修复审核发现的问题，其他场次结果保留。",
                        "Repairing review findings. Other scene results are retained.",
                      )
                    : progress.phase === "saving"
                      ? t(
                          "正在保存正式分镜与台词关联。",
                          "Saving production shots and dialogue links.",
                        )
                      : t(
                          "正在按场次并行拆镜，完成一场就展示一场；镜头总数会随拆镜确定。",
                          "Planning scenes in parallel. Each completed scene appears immediately; shot count is determined during planning.",
                        )
                : progress.totalBatches &&
                    progress.completedBatches >= progress.totalBatches
                  ? t(
                      "所有批次已完成，正在保存正式分镜与台词关联。",
                      "All batches completed. Saving production shots and dialogue links.",
                    )
                  : t(
                      `正在处理第 ${progress.completedBatches + 1} 批。完成的镜头会自动追加，全部结束后可编辑。`,
                      `Processing batch ${progress.completedBatches + 1}. Completed shots appear automatically; editing opens when the run finishes.`,
                    )
              : progress.status === "paused"
                ? t(
                    "任务已暂停，完成的分镜保留在下方。",
                    "Paused. Completed shots are retained below.",
                  )
                : t(
                    "任务已停止，已完成分镜保留在下方；重试会复用有效结果，尚未保存为正式分镜。",
                    "The run stopped. Completed shots are retained below; retry reuses valid results. Production shots have not been saved yet.",
                  )}
          </span>
        </div>
      </div>
      {!panel ? (
        <div className="flex min-h-60 flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          {t(
            "正在根据结构化剧本拆镜，首个场次完成后会显示在这里。",
            "Planning shots from the structured screenplay. The first completed scene will appear here.",
          )}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 border-b lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav
            aria-label={t("已完成镜头列表", "Completed shot list")}
            className="max-h-72 overflow-y-auto border-b p-1.5 lg:max-h-none lg:border-b-0 lg:border-r xl:min-h-0"
          >
            {progress.panels.map((item) => (
              <button
                key={item.previewId}
                type="button"
                aria-current={
                  item.panelIndex === panel.panelIndex ? "true" : undefined
                }
                onClick={() => setSelectedId(item.previewId)}
                className={`flex w-full items-start gap-2 rounded-md px-3 py-2.5 text-left focus-visible:ring-2 focus-visible:ring-ring ${item.panelIndex === panel.panelIndex ? "bg-muted" : "hover:bg-muted/50"}`}
              >
                {item.needsReview ? (
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                ) : item.reviewState === "pending" ? (
                  <LoaderCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">
                    {t("镜头", "Shot")}{" "}
                    {String(item.panelIndex + 1).padStart(2, "0")} ·{" "}
                    {item.locationName || t("场景未设定", "No location")}
                  </span>
                  <span className="mt-1 block line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {item.description}
                  </span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    {item.needsReview
                      ? t("已生成 · 待复核", "Generated · needs review")
                      : item.reviewState === "pending"
                        ? t("已生成 · 待汇总审核", "Generated · review pending")
                        : t("已生成 · 审核通过", "Generated · reviewed")}
                  </span>
                </span>
              </button>
            ))}
          </nav>
          <div className="min-w-0 space-y-5 overflow-y-auto p-4 sm:p-6 xl:min-h-0">
            <div>
              <h2 className="text-base font-semibold">
                {t("镜头", "Shot")} {panel.panelIndex + 1}
              </h2>
              <p className="mt-2 text-xs text-muted-foreground">
                {[
                  panel.locationName,
                  panel.shotType,
                  panel.durationSeconds
                    ? `${panel.durationSeconds}s`
                    : undefined,
                  ...panel.characters,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-7">
              {panel.description}
            </p>
            {panel.lipSyncText && (
              <div>
                <h3 className="mb-2 text-xs font-medium">
                  {t("台词", "Dialogue")}
                </h3>
                <p className="text-sm leading-6">
                  {panel.speakingCharacter}：{panel.lipSyncText}
                </p>
              </div>
            )}
            {[
              {
                label: t("图片提示词", "Image prompt"),
                value: panel.imagePrompt,
              },
              {
                label: t("视频提示词", "Video prompt"),
                value: panel.videoPrompt,
              },
            ].map((item) => (
              <details key={item.label} className="border-t pt-3">
                <summary className="cursor-pointer text-xs font-medium">
                  {item.label}
                </summary>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
                  {item.value}
                </p>
              </details>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
