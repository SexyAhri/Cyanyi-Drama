import { describe, expect, it } from "vitest";

import type { StoryboardRecord } from "./domain-types";
import { buildStoryboardContentReview } from "./storyboard-review";

describe("storyboard content review", () => {
  it("surfaces grounded inference without treating it as a blocking omission", () => {
    const source = "韩宇听见父亲病情加重，强忍着没有落泪。";
    const screenplay = JSON.stringify({
      clipId: "clip-1",
      originalText: source,
      coverage: [
        { eventId: "E001", evidence: source, modes: ["visual"], reason: null },
      ],
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "INT", location: "卧房", time: "夜" },
          description: "",
          characters: ["韩宇"],
          content: [
            {
              type: "action",
              text: "韩宇攥紧衣角，眼眶泛红。",
              origin: "inferred",
              inferenceType: "performance",
              evidence: [source],
              rationale: "将明确的克制悲伤转为可见表演。",
              confidence: 0.85,
            },
          ],
        },
      ],
    });
    const review = buildStoryboardContentReview(
      storyboard(source),
      [{ id: "clip-1", screenplay }],
    );

    expect(review).toMatchObject({
      status: "needs_review",
      blockingIssueCount: 0,
      coverage: { total: 1, covered: 1, missingEventIds: [] },
    });
    expect(review.inferences).toEqual([
      expect.objectContaining({
        inferenceType: "performance",
        text: "韩宇攥紧衣角，眼眶泛红。",
      }),
    ]);
  });
});

function storyboard(evidence: string): StoryboardRecord {
  const timestamp = "2026-08-28T00:00:00.000Z";
  return {
    id: "storyboard-1",
    projectId: "project-1",
    episodeId: "episode-1",
    status: "review_required",
    version: 1,
    sourceHash: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    panels: [
      {
        id: "panel-1",
        storyboardId: "storyboard-1",
        clipId: "clip-1",
        clipPanelIndex: 0,
        panelIndex: 0,
        sceneNumber: 0,
        shotType: "近景",
        cameraMove: "缓慢推近",
        description: "韩宇攥紧衣角，眼眶泛红。",
        locationName: "卧房",
        characters: ["韩宇"],
        props: [],
        imagePrompt: null,
        videoPrompt: "韩宇保持克制",
        speakingCharacter: null,
        lipSyncText: null,
        voiceoverText: null,
        startState: {},
        endState: {},
        motionBeats: [],
        worldContext: {},
        vfxCues: [],
        sfxCues: [],
        sourceEvidence: [evidence],
        imageAssetId: null,
        videoAssetId: null,
        lipSyncAssetId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
}
