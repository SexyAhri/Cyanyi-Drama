import { describe, expect, it } from "vitest";

import {
  assertStoryboardApprovedForMedia,
  compileStoryboardEventBlueprint,
  parseGenerationIterationDiagnostics,
  ProjectAssetTaskError,
} from "./project-asset-tasks";

describe("storyboard media task contract", () => {
  it("allows advisory review states and blocks only unfinished storyboards", () => {
    expect(() => assertStoryboardApprovedForMedia("ready")).not.toThrow();
    expect(() =>
      assertStoryboardApprovedForMedia("review_required"),
    ).not.toThrow();
    expect(() =>
      assertStoryboardApprovedForMedia("continuity_warning"),
    ).not.toThrow();
    let error: unknown;
    try {
      assertStoryboardApprovedForMedia("draft");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ProjectAssetTaskError);
    expect(error).toMatchObject({ status: 409 });
  });

  it("compiles ordered image production layers without dumping raw JSON", () => {
    const prompt = compileStoryboardEventBlueprint(
      "保持克制",
      {
        description: "林澈格挡顾言的剑",
        charactersJson: JSON.stringify(["林澈", "顾言"]),
        propsJson: JSON.stringify(["长剑"]),
        startStateJson: JSON.stringify({
          body: "两人相对",
          environmentState: {
            keyLightSource: "窗光",
            lightDirection: "画左至画右",
            weather: "雨",
            damageState: [],
            particles: ["雨雾"],
          },
        }),
        endStateJson: JSON.stringify({ body: "剑刃相抵后停稳" }),
        worldContextJson: JSON.stringify({
          shotIntent: {
            audienceTakeaway: "林澈勉强守住",
            primaryVisibleEvent: "双剑相抵",
            endBeat: "林澈退半步停稳",
          },
          constraints: {
            mustHold: ["仅两名角色"],
            changesHere: ["林澈退半步"],
            mustNotAppear: ["第三人"],
          },
          riskFocus: ["interaction_physics"],
        }),
        motionBeatsJson: JSON.stringify([
          {
            startSecond: 0,
            endSecond: 2,
            trigger: "顾言挥剑",
            preparation: "林澈沉肩举剑",
            forceSource: "后腿蹬地",
            action: "双剑相抵",
            contactMaterial: "金属剑刃",
            settle: "林澈退半步停稳",
          },
        ]),
        photographyRules: JSON.stringify({
          cameraPath: { primaryMovement: "track", direction: "向画右" },
        }),
      },
    );

    expect(prompt).toContain("1. 镜头意图");
    expect(prompt).toContain("唯一主要可见事件：双剑相抵");
    expect(prompt).toContain("唯一主运镜路径：primaryMovement=track");
    expect(prompt).toContain("不得出现：第三人");
    expect(prompt).toContain("静态首帧边界");
    expect(prompt).not.toContain('{"');
  });

  it("persists complete iteration diagnostics and escalates after two flat rounds", () => {
    expect(
      parseGenerationIterationDiagnostics({
        failureCode: "CONTACT_SLIDES",
        responsibilityLayer: "action_physics",
        changedVariables: ["contactPoint", "settle"],
        hypothesis: "接触与收势不够明确",
        expectedImprovement: "剑刃接触稳定且不滑移",
        mustRemainUnchanged: ["角色身份", "镜头轴线"],
        noImprovementCount: 1,
      }),
    ).toEqual(
      expect.objectContaining({
        failureCode: "CONTACT_SLIDES",
        responsibilityLayer: "action_physics",
        noImprovementCount: 1,
      }),
    );

    expect(() =>
      parseGenerationIterationDiagnostics({
        failureCode: "CONTACT_SLIDES",
        responsibilityLayer: "action_physics",
        changedVariables: ["contactPoint"],
        hypothesis: "继续同一假设",
        expectedImprovement: "接触更稳定",
        mustRemainUnchanged: ["角色身份"],
        noImprovementCount: 2,
      }),
    ).toThrow("连续两轮无改善");
  });
});
