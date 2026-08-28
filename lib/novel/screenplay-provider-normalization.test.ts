import { describe, expect, it } from "vitest";

import { screenplayConversionSchema } from "@/lib/prompts/schemas";
import { normalizeScreenplayProviderPayload } from "./screenplay-provider-normalization";

describe("screenplay provider normalization", () => {
  it("repairs known action-design shape deviations before strict parsing", () => {
    const source = "海宏赡施展静海观潮，海潮向九炎天龙席卷而去。";
    const normalized = normalizeScreenplayProviderPayload(
      {
        clipId: "clip-1",
        originalText: source,
        ignoredRootField: true,
        scenes: [
          {
            sceneNumber: 0,
            heading: { intExt: "EXT", location: "虚空", time: "日" },
            description: "",
            characters: ["海宏赡", "九炎天龙"],
            ignoredSceneField: true,
            content: [
              {
                type: "action",
                text: source,
                origin: "source",
                sfxPlan: [
                  {
                    phase: "impact",
                    type: "impact",
                    description: "海潮冲击声",
                  },
                ],
                ignoredContentField: true,
                actionDesign: {
                  kind: "skill",
                  performer: null,
                  target: "九炎天龙",
                  realm: null,
                  technique: "静海观潮",
                  choreography: [],
                  impact: "海潮席卷",
                  environmentResponse: null,
                  vfxPlan: [
                    {
                      phase: "release",
                      category: "invalid_category",
                      description: "海潮成形",
                    },
                    {
                      phase: "travel",
                      category: "elemental_spell",
                      description: "海潮推进",
                      ignoredCueField: true,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      { clipText: source, characters: ["海宏赡", "九炎天龙"] },
    );

    const parsed = screenplayConversionSchema.parse(normalized);
    const content = parsed.scenes[0].content[0];
    expect(content.type).toBe("action");
    if (content.type !== "action") throw new Error("Expected action");
    expect(content).not.toHaveProperty("sfxPlan");
    expect(content.actionDesign).toMatchObject({
      performer: "海宏赡",
      choreography: [source],
      evidence: [source],
      vfxPlan: [
        {
          phase: "travel",
          category: "elemental_spell",
          description: "海潮推进",
        },
      ],
      sfxPlan: [
        {
          phase: "impact",
          type: "impact",
          description: "海潮冲击声",
        },
      ],
    });
  });

  it("drops an optional action design that cannot be grounded", () => {
    const source = "海潮翻涌。";
    const normalized = normalizeScreenplayProviderPayload(
      {
        clipId: "clip-1",
        originalText: source,
        scenes: [
          {
            sceneNumber: 0,
            heading: { intExt: "EXT", location: "虚空", time: "日" },
            description: "",
            characters: [],
            content: [
              {
                type: "action",
                text: source,
                actionDesign: {
                  kind: "skill",
                  performer: null,
                  choreography: [],
                },
              },
            ],
          },
        ],
      },
      { clipText: source, characters: [] },
    );

    const parsed = screenplayConversionSchema.parse(normalized);
    expect(parsed.scenes[0].content[0]).toEqual({
      type: "action",
      text: source,
    });
  });
});
