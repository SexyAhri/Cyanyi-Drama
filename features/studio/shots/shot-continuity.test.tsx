import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectMediaAsset, StudioStoryboardPanel } from "../types";
import { buildShotContinuityFrames, continuityStateText } from "./shot-continuity";
import { ShotContinuitySheet } from "./shot-continuity-sheet";

function panel(input: Partial<StudioStoryboardPanel> = {}): StudioStoryboardPanel {
  return { id: "one", storyboardId: "storyboard", clipId: null, clipPanelIndex: null, panelIndex: 0, sceneNumber: 0,
    shotType: "中景", cameraMove: "固定机位", description: "递出钥匙", locationName: "修伞铺", characters: ["老周", "阿宁"], props: ["钥匙"],
    imagePrompt: "画面提示", videoPrompt: "动作提示", sourceEvidence: [], imageAssetId: "adopted", videoAssetId: null, videoSegments: [], lipSyncAssetId: null,
    speakingCharacter: null, lipSyncText: null, voiceoverText: null, startState: { screenDirection: "阿宁在左", props: "钥匙在桌上" }, endState: { screenDirection: "阿宁在左", props: "钥匙在阿宁手里" },
    motionBeats: [], worldContext: { keyframeMoment: "start" }, vfxCues: [], sfxCues: [], createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z", ...input };
}
function asset(id: string, input: Partial<ProjectMediaAsset> = {}): ProjectMediaAsset {
  return { id, kind: "image", url: `/${id}.png`, mimeType: "image/png", metadata: {}, references: [], sourceTargetId: "one", sourceTargetType: "storyboard_panel", taskStatus: "succeeded", createdAt: "2026-10-15T00:00:00Z", ...input };
}

describe("shot continuity contact sheet", () => {
  it("sorts neighboring shots and shows only their actual adopted images", () => {
    const source = [panel({ id: "two", panelIndex: 1, sceneNumber: 1, imageAssetId: null }), panel()];
    const assets = [asset("newer-unadopted", { createdAt: "2026-10-16T00:00:00Z" }), asset("adopted")];
    const frames = buildShotContinuityFrames(source, assets);
    expect(frames.map(frame => frame.panel.id)).toEqual(["one", "two"]);
    expect(frames[0].image?.id).toBe("adopted"); expect(frames[1].image).toBeUndefined();
    expect(frames[0].next?.id).toBe("two"); expect(frames[1].previous?.id).toBe("one");
    expect(frames.map(frame => frame.sceneNumber)).toEqual([1, 2]);
    expect(source[0].id).toBe("two"); expect(assets).toHaveLength(2);
  });
  it("does not substitute wrong media, failed media or a newer candidate for an unavailable adopted frame", () => {
    for (const unusable of [asset("adopted", { kind: "video" }), asset("adopted", { taskStatus: "failed" }), asset("adopted", { url: null })])
      expect(buildShotContinuityFrames([panel()], [unusable, asset("newer")])[0].image).toBeUndefined();
  });
  it("keeps unknown state explicit and does not invent screen positions from prompt text", () => {
    const frame = buildShotContinuityFrames([panel({ startState: {}, endState: {}, imagePrompt: "角色在左" })], [])[0];
    expect(frame.missingState).toBe(true); expect(continuityStateText(frame.panel.startState, "screenDirection")).toBe("");
    expect(continuityStateText({ props: ["旧伞放桌上", " 钥匙在手里 "] }, "props")).toBe("旧伞放桌上；钥匙在手里");
  });
  it("renders actual versions, neighboring end states and reachable local edit/repair actions", () => {
    const html = renderToStaticMarkup(<ShotContinuitySheet panels={[panel(), panel({ id: "two", panelIndex: 1, imageAssetId: null, startState: {}, endState: {} })]} assets={[asset("adopted")]} locale="zh-CN" onOpenShot={() => {}} onSavePanel={() => {}} />);
    for (const content of ["/adopted.png", "已采用版本：", "阿宁在左", "钥匙在桌上", "钥匙在阿宁手里", "对照上一镜结束状态", "候选与局部修复", "待人工审阅", "尚未采用关键帧", "尚未记录起止状态"])
      expect(html).toContain(content);
    expect(html).toContain('aria-label="连续性联系表"'); expect(html).toContain("md:grid-cols-2");
    expect(html).not.toContain("审核通过");
  });
  it("renders English labels and an honest empty state", () => {
    const html = renderToStaticMarkup(<ShotContinuitySheet panels={[]} assets={[]} locale="en" onOpenShot={() => {}} onSavePanel={() => {}} />);
    expect(html).toContain("Human review required"); expect(html).toContain("This episode has no production shots.");
  });
});
