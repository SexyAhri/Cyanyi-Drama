import { describe, expect, it } from "vitest";

import type { StudioStoryboardPanel } from "../types";
import {
  getPrevisReadiness,
  parseActingDirections,
  parsePhotographyRules,
  serializeActingDirections,
  serializePhotographyRules,
} from "./previs-view-model";

describe("previs view model", () => {
  it("reads structured and legacy photography rules safely", () => {
    expect(
      parsePhotographyRules(
        JSON.stringify({
          camera: "eye level",
          cameraPosition: "two meters in front",
          focalLength: "50mm",
        }),
      ),
    ).toMatchObject({
      camera: "eye level",
      cameraPosition: "two meters in front",
      focalLength: "50mm",
    });
    expect(parsePhotographyRules("legacy camera note").camera).toBe(
      "legacy camera note",
    );
  });

  it("normalizes acting directions and ignores invalid entries", () => {
    expect(
      parseActingDirections({
        characters: [
          {
            name: "Lin",
            emotion: "contained",
            action: "turns away",
            expression: "avoids eye contact",
          },
          null,
        ],
      }),
    ).toEqual([
      {
        name: "Lin",
        emotion: "contained",
        action: "turns away",
        expression: "avoids eye contact",
      },
    ]);
    expect(
      serializeActingDirections(["Lin", "Qiao"], {
        Lin: { emotion: "calm", action: "waits", expression: "still" },
        Qiao: { emotion: "", action: "", expression: "" },
      }),
    ).toEqual({
      characters: [
        { name: "Lin", emotion: "calm", action: "waits", expression: "still" },
      ],
    });
  });

  it("reports missing executable shot specifications", () => {
    const panel = storyboardPanel({
      cameraMove: "locked",
      durationSeconds: 2.5,
      photographyRules: serializePhotographyRules({
        camera: "eye level",
        cameraPosition: "two meters in front",
        focalLength: "50mm",
        lighting: "soft side light",
        composition: "balanced two-shot",
        depthOfField: "shallow",
        colorTone: "cool",
      }),
      actingNotes: {
        characters: [
          { name: "Lin", emotion: "calm", action: "waits", expression: "still" },
        ],
      },
    });
    expect(getPrevisReadiness(panel, [])).toEqual({
      complete: 8,
      isReady: true,
      missing: [],
      total: 8,
    });
    expect(
      getPrevisReadiness(panel, [
        {
          code: "AXIS_BREAK",
          severity: "error",
          clipId: "clip-1",
          panelIndex: 0,
          entityType: "camera",
          entityName: null,
          message: "Axis break",
          suggestedFix: null,
        },
      ]).missing,
    ).toContain("continuity");
    expect(
      getPrevisReadiness(
        storyboardPanel({
          characters: ["Lin", "Qiao"],
          actingNotes: {
            characters: [
              {
                name: "Lin",
                emotion: "calm",
                action: "waits",
                expression: "still",
              },
            ],
          },
        }),
        [],
      ).missing,
    ).toContain("performance");
  });
});

function storyboardPanel(
  overrides: Partial<StudioStoryboardPanel> = {},
): StudioStoryboardPanel {
  return {
    id: "panel-1",
    storyboardId: "storyboard-1",
    clipId: "clip-1",
    clipPanelIndex: 0,
    panelIndex: 0,
    shotType: "medium",
    cameraMove: null,
    description: "Lin waits",
    locationName: "room",
    characters: ["Lin"],
    props: [],
    imagePrompt: null,
    videoPrompt: null,
    sourceEvidence: ["Lin waits"],
    imageAssetId: null,
    videoAssetId: null,
    lipSyncAssetId: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
    sceneNumber: overrides.sceneNumber ?? null,
    speakingCharacter: overrides.speakingCharacter ?? null,
    lipSyncText: overrides.lipSyncText ?? null,
    voiceoverText: overrides.voiceoverText ?? null,
    startState: overrides.startState ?? {},
    endState: overrides.endState ?? {},
    motionBeats: overrides.motionBeats ?? [],
    worldContext: overrides.worldContext ?? {},
    vfxCues: overrides.vfxCues ?? [],
    sfxCues: overrides.sfxCues ?? [],
  };
}
