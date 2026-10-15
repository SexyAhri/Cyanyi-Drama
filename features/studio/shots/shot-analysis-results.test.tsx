import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VideoVisualReviewResult } from "@/lib/media/visual-review-contract";
import { ShotSpatialAudit, ShotVideoDiagnosis } from "./shot-analysis-results";

const result: VideoVisualReviewResult = { videoAssetId: "old-video", referenceAssetIds: ["image"], frames: [{ frameNumber: 1, second: 0 }, { frameNumber: 2, second: 5.75 }], durationSeconds: 6, coverage: "sampled_frames_only", audio: "not_checked", continuousMotion: "not_checked",
  review: { summary: "sample-scoped", findings: [{ category: "space", frameNumbers: [2], observation: "hand crosses wall", minimalRepair: "keep hand in front" }], limitations: ["not audio"] } };
describe("shot analysis result presentation", () => {
  it("shows not-inspected rather than claiming an absent audit passed", () => {
    expect(renderToStaticMarkup(<ShotSpatialAudit locale="zh-CN" />)).toContain("尚未审计");
    expect(renderToStaticMarkup(<ShotSpatialAudit locale="en" />)).toContain("Not inspected");
  });
  it("renders source identity and makes stale diagnosis suggestions inapplicable", () => {
    const html = renderToStaticMarkup(<ShotVideoDiagnosis review={result} pending={false} locale="zh-CN" busy={false} promptLength={0} currentVideoAssetId="new-video" onAppend={() => undefined} />);
    expect(html).toContain("old-video"); expect(html).toContain("不是对当前版本的诊断");
    expect(html).toContain("不检查声音、口型同步或连续运动"); expect(html).toContain("≈5.75s"); expect(html).toContain('disabled=""');
  });
  it("keeps no-findings conclusions sample-scoped and displays real pending state", () => {
    const html = renderToStaticMarkup(<ShotVideoDiagnosis review={{ ...result, review: { ...result.review, findings: [] } }} pending={false} locale="en" busy={false} promptLength={0} currentVideoAssetId="old-video" onAppend={() => undefined} />);
    expect(html).toContain("not a whole-clip pass");
    const pending = renderToStaticMarkup(<ShotVideoDiagnosis review={null} pending locale="zh-CN" busy promptLength={0} currentVideoAssetId="old-video" onAppend={() => undefined} />);
    expect(pending).toContain("正在抽帧并诊断"); expect(pending).not.toContain("sample-scoped");
  });
});
