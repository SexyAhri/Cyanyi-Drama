import { describe, expect, it } from "vitest";

import type { AssetVisualProfileSpec } from "./visual-profile";
import {
  buildAssetStoryWorldContext,
  findStoryWorldTextConflicts,
  findVisualProfileStoryWorldConflicts,
  getStoryWorldDirective,
} from "./story-world";

describe("asset story world", () => {
  it("locks cultivation fiction to its premodern world independently of art style", () => {
    const context = cultivationContext();

    expect(context.lock).toMatchObject({
      setting: "premodern_cultivation",
      evidence: expect.arrayContaining(["修炼", "淬体", "王朝", "古籍"]),
    });
    expect(getStoryWorldDirective(context.lock, "zh")).toContain(
      "画风只决定如何呈现，不能改变故事时代",
    );
    expect(getStoryWorldDirective(context.lock, "zh")).toContain("禁止西装");
  });

  it("rejects a modern character design in a premodern cultivation project", () => {
    const modernSpec: AssetVisualProfileSpec = {
      visualIdentity: "成熟稳重的中年男性",
      shapeAndStructure: "椭圆脸型，短直发型，中等身高",
      surfaceAndStyling: "棉质衬衫搭配深色呢质外套和西裤",
      colorPalette: "深灰、海军蓝和米白",
      lightingAndPresentation: "现代室内空间中的柔和电影侧光",
      signatureDetails: ["短发发型", "商务皮鞋"],
      consistencyRules: ["保持五官", "保持服装配色"],
      negativePrompt: "避免西装、现代服装和现代科技",
      inferenceNotes: ["根据父亲身份推断为日常商务服饰"],
    };

    expect(
      findVisualProfileStoryWorldConflicts(modernSpec, cultivationContext()),
    ).toEqual(
      expect.arrayContaining([
        "现代商务服装",
        "现代短发造型",
        "现代建筑或室内",
      ]),
    );
  });

  it("does not treat explicitly excluded modern terms as positive conflicts", () => {
    const context = cultivationContext();
    const prompt = [
      "造型与材质：交领长袍、布靴、旧皮护腕",
      "排除项：西装、衬衫、领带、现代短发、现代室内和汽车",
    ].join("\n");

    expect(findStoryWorldTextConflicts(prompt, context)).toEqual([]);
  });

  it("allows a project-level contemporary adaptation to override an ancient source era", () => {
    const sourceContext = cultivationContext();
    const contemporaryContext = buildAssetStoryWorldContext({
      projectName: sourceContext.projectName,
      manuscripts: sourceContext.manuscripts,
      relatedSourceEvidence: sourceContext.relatedSourceEvidence,
      visualEra: "contemporary",
    });

    expect(contemporaryContext.lock).toMatchObject({
      mode: "contemporary",
      setting: "contemporary",
    });
    expect(
      findStoryWorldTextConflicts(
        "短直发型，白色衬衫搭配现代西装，站在办公室",
        contemporaryContext,
      ),
    ).toEqual([]);
    expect(getStoryWorldDirective(contemporaryContext.lock, "zh")).toContain(
      "当代世界",
    );
  });
});

function cultivationContext() {
  return buildAssetStoryWorldContext({
    projectName: "专项测试",
    manuscripts: [
      {
        title: "玄天战尊",
        synopsis:
          "大秦王朝的少年偶得灵珠认主，凭借秘籍修炼得道，踏破九重天。",
      },
    ],
    relatedSourceEvidence: [
      "韩子枫从古籍旁起身。他曾是韩家庄的天才，如今身受重伤。",
      "韩宇只有淬体五重，却立志成为真正的修者。",
    ],
  });
}
