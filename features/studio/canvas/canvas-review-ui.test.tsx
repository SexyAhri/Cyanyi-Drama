import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectAssetCatalog, StudioStoryboardPanel } from "../types";
import { CanvasNode } from "./canvas-node";
import { CanvasPromptDifference } from "./canvas-prompt-difference";
import { CanvasReferencePreview, canvasReviewReferences } from "./canvas-reference-preview";
import { buildEpisodeCanvasGraph } from "./canvas-layout";

describe("canvas review labels and draft comparison", () => {
  it("shows connection purposes without claiming they are all model references", () => {
    const html = renderToStaticMarkup(<CanvasNode node={{ id: "shot", kind: "panel", title: "镜头2", text: "", x: 0, y: 0 }} selected={false} connecting={false} target={false} locale="zh-CN"
      onSelect={() => {}} onDrag={() => {}} onConnect={() => {}} onComplete={() => {}} onBranch={() => {}} busy={false} inputs={["镜头顺序 · 镜头1", "剧情资产 · 钥匙"]} />);
    expect(html).toContain("关系："); expect(html).toContain("镜头顺序 · 镜头1"); expect(html).toContain("剧情资产 · 钥匙"); expect(html).not.toContain("引用：");
  });
  it("renders actual server reference versions and keeps missing details distinct from no references", () => {
    const references = canvasReviewReferences([{ assetId: "actual-version", url: "/actual.png", role: "first_frame", secretExtra: "discard" }, null]);
    expect(references).toEqual([{ assetId: "actual-version", url: "/actual.png", role: "first_frame" }]);
    const html = renderToStaticMarkup(<CanvasReferencePreview references={references} locale="zh-CN" />);
    expect(html).toContain("实际模型图片参考"); expect(html).toContain("actual-version"); expect(html).toContain("/actual.png"); expect(html).toContain("首帧");
    expect(renderToStaticMarkup(<CanvasReferencePreview references={[]} locale="en" />)).toContain("This request has no image references.");
    expect(renderToStaticMarkup(<CanvasReferencePreview locale="en" />)).toContain("did not return media details");
  });
  it("exposes both retained user draft and latest official template with an explicit replacement action", () => {
    const catalog = { assets: [], characters: [], props: [], locations: [{ id: "court", name: "庭院", summary: "最新庭院设定", images: [] }] } as unknown as ProjectAssetCatalog;
    const doc = buildEpisodeCanvasGraph({ nodes: [], edges: [], viewport: { x: 0, y: 0, k: 1 } }, [{ id: "shot", panelIndex: 0, characters: [], props: [], locationName: "庭院" }] as unknown as StudioStoryboardPanel[], catalog);
    const node = doc.nodes.find(node => node.episodeLayer === "asset_image")!;
    node.text = "保留我的草稿"; delete node.assetPromptBase;
    const html = renderToStaticMarkup(<CanvasPromptDifference node={node} document={doc} catalog={catalog} locale="zh-CN" busy onPatch={() => {}} />);
    expect(html).toContain("保留我的草稿"); expect(html).toContain("最新庭院设定"); expect(html).toContain("旧节点没有模板基线");
    expect(html).toContain("将草稿替换为最新设定"); expect(html).toMatch(/<button[^>]*disabled/);
  });
});
