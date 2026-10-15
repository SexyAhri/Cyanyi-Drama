"use client";

import { Button } from "@/components/ui/button";
import type { SpatialAudit, VideoVisualReviewResult } from "@/lib/media/visual-review-contract";
import type { StudioLocale } from "../types";

export function ShotSpatialAudit({ audit, locale }: { audit?: SpatialAudit; locale: StudioLocale }) {
  const en = locale === "en";
  if (!audit) return <p className="text-sm text-muted-foreground">{en ? "Not inspected. Run video prompt design with adopted keyframes and a vision-capable Agent." : "尚未审计。采用关键帧后，使用支持视觉的 Agent 设计视频提示词。"}</p>;
  return <>
    <p className="wrap-break-word text-xs text-muted-foreground">{en ? "Audited asset IDs (may differ from today's adoption): " : "审计依据素材 ID（可能不同于当前采用版本）："}{audit.referenceAssetIds.join(" · ")}</p>
    <PromptList empty="—" values={audit.observations} />
    <h4 className="text-sm font-medium">{en ? "Feasible motion" : "可行路径与运镜"}</h4>
    <PromptList empty="—" values={audit.allowedMotion} />
    <h4 className="text-sm font-medium">{en ? "Unsupported additions / conflicts" : "禁止新增与冲突"}</h4>
    <PromptList empty={en ? "None reported" : "未报告"} values={[...audit.forbiddenAdditions, ...audit.conflicts]} />
    <p className="text-sm leading-6">{audit.timeBudget}</p>
  </>;
}

export function ShotVideoDiagnosis({ review, pending, locale, busy, promptLength, currentVideoAssetId, onAppend }: {
  review: VideoVisualReviewResult | null; pending: boolean; locale: StudioLocale; busy: boolean;
  promptLength: number; currentVideoAssetId: string | null; onAppend: (suggestion: string) => void;
}) {
  const en = locale === "en";
  const stale = review && review.videoAssetId !== currentVideoAssetId;
  return <>
    <p className="text-sm leading-6 text-muted-foreground">{en ? "Sampled stills only. Audio, lip sync and continuous motion are NOT checked. Suggestions do not regenerate media. Saved in workflow history." : "仅检查离散静帧，不检查声音、口型同步或连续运动。建议不会触发重生成；结果保存在执行历史。"}</p>
    {pending ? <p role="status" className="text-sm">{en ? "Sampling and diagnosing…" : "正在抽帧并诊断…"}</p> : null}
    {review ? <>
      <p className="wrap-break-word text-xs text-muted-foreground">{en ? "Reviewed video: " : "被诊断视频："}{review.videoAssetId} · {review.frames.map((frame) => `#${frame.frameNumber} ≈${frame.second.toFixed(2)}s`).join(" · ")}</p>
      {stale ? <p role="status" className="text-sm text-destructive">{en ? "This result refers to a previously adopted video; it is not a diagnosis of the current selection." : "此结果针对先前采用的视频，不是对当前版本的诊断。"}</p> : null}
      <p className="text-sm leading-6">{review.review.summary}</p>
      {!review.review.findings.length ? <p className="text-sm">{en ? "No visible issues reported in these samples; not a whole-clip pass." : "采样帧未报告可见问题，不代表全片通过。"}</p> : null}
      {review.review.findings.map((finding, index) => <div className="space-y-2 rounded-md border p-3 text-sm leading-6" key={index}>
        <p className="text-xs text-muted-foreground">{finding.frameNumbers.map((number) => `#${number}`).join(" · ")}</p>
        <p className="wrap-break-word">{finding.observation}</p><p className="wrap-break-word">{finding.minimalRepair}</p>
        <Button disabled={busy || Boolean(stale) || promptLength + finding.minimalRepair.length + 70 > 12000} onClick={() => onAppend(finding.minimalRepair)} size="sm" type="button" variant="outline">{en ? "Append to editable draft" : "加入可编辑草稿"}</Button>
      </div>)}
      <PromptList empty="—" values={review.review.limitations} />
    </> : !pending ? <p className="text-sm text-muted-foreground">{en ? "No diagnosis in this session. Use the button above to run a paid vision request." : "本次尚无诊断。点击上方按钮，经费用确认后请求视觉模型。"}</p> : null}
  </>;
}

export function PromptList({ empty, values }: { empty: string; values: string[] }) {
  if (!values.length) return <p className="py-6 text-sm text-muted-foreground">{empty}</p>;
  return <ol className="divide-y border-y">{values.map((value, index) => <li className="grid gap-2 py-3 sm:grid-cols-[2rem_minmax(0,1fr)]" key={`${index}-${value}`}>
    <span className="font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
    <span className="wrap-break-word text-sm leading-6">{value}</span>
  </li>)}</ol>;
}
