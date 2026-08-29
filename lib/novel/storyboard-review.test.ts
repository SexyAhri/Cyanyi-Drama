import { describe, expect, it } from "vitest";

import type { StoryboardRecord } from "./domain-types";
import { buildStoryboardContentReview } from "./storyboard-review";
import { buildSourceEvents } from "@/lib/prompts/validators";

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

  it("accepts one source event reconstructed from adjacent exact evidence fragments", () => {
    const source = "龙炎掀起骇浪，虚空随之震荡。";
    const screenplay = screenplayFor(source, [
      { type: "action", text: source, origin: "source" },
    ]);

    const review = buildStoryboardContentReview(
      storyboardFromPanels([
        { sourceEvidence: ["龙炎掀起骇浪，"] },
        { sourceEvidence: ["虚空随之震荡。"] },
      ]),
      [{ id: "clip-1", screenplay }],
    );

    expect(review).toMatchObject({
      status: "clear",
      blockingIssueCount: 0,
      coverage: { total: 1, covered: 1, missingEventIds: [] },
    });
  });

  it("normalizes stale action-shaped dialogue before reviewing delivery", () => {
    const source = "本命龙炎流转全身，一股灼热气息迸发而出。";
    const screenplay = screenplayFor(source, [
      {
        type: "dialogue",
        character: "九炎天龙",
        parenthetical: null,
        lines: source,
      },
    ]);

    const review = buildStoryboardContentReview(storyboard(source), [
      { id: "clip-1", screenplay },
    ]);

    expect(review.issues).toEqual([]);
  });

  it("does not mistake a short dialogue suffix for a second speaker", () => {
    const source = "“此龙，可是没有肉体的形态啊！”海丹麟惨叫：“啊！”";
    const events = buildSourceEvents(source);
    const screenplay = JSON.stringify({
      clipId: "clip-1",
      originalText: source,
      coverage: events.map((event) => ({
        ...event,
        modes: ["dialogue"],
        reason: null,
      })),
      scenes: [
        {
          sceneNumber: 0,
          heading: { intExt: "EXT", location: "虚空", time: "日" },
          description: "",
          characters: ["海宏赡", "海丹麟"],
          content: [
            {
              type: "dialogue",
              character: "海宏赡",
              parenthetical: null,
              lines: "此龙，可是没有肉体的形态啊！",
            },
            {
              type: "dialogue",
              character: "海丹麟",
              parenthetical: null,
              lines: "啊！",
            },
          ],
        },
      ],
    });

    const review = buildStoryboardContentReview(
      storyboardFromPanels([
        {
          sourceEvidence: events.map((event) => event.evidence),
          speakingCharacter: "海宏赡",
          lipSyncText: "此龙，可是没有肉体的形态啊！",
          durationSeconds: 20,
        },
        {
          sourceEvidence: [],
          speakingCharacter: "海丹麟",
          lipSyncText: "啊！",
          durationSeconds: 3,
        },
      ]),
      [{ id: "clip-1", screenplay }],
    );

    expect(review.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MULTI_SPEAKER_SHOT" }),
      ]),
    );
  });

  it("reports a missing source-backed action only once", () => {
    const source = "修者仓皇后退。";
    const screenplay = screenplayFor(source, [
      { type: "action", text: source, origin: "source" },
    ]);

    const review = buildStoryboardContentReview(storyboard("天空阴沉。"), [
      { id: "clip-1", screenplay },
    ]);

    expect(review.issues.map((issue) => issue.code)).toEqual([
      "SOURCE_EVENT_MISSING",
    ]);
  });
});

function storyboard(evidence: string): StoryboardRecord {
  return storyboardFromPanels([{ sourceEvidence: [evidence] }]);
}

function screenplayFor(
  source: string,
  content: Array<Record<string, unknown>>,
) {
  return JSON.stringify({
    clipId: "clip-1",
    originalText: source,
    coverage: buildSourceEvents(source).map((event) => ({
      ...event,
      modes: ["visual"],
      reason: null,
    })),
    scenes: [
      {
        sceneNumber: 0,
        heading: { intExt: "EXT", location: "虚空", time: "日" },
        description: "",
        characters: ["九炎天龙"],
        content,
      },
    ],
  });
}

function storyboardFromPanels(
  panels: Array<{
    sourceEvidence: string[];
    speakingCharacter?: string | null;
    lipSyncText?: string | null;
    voiceoverText?: string | null;
    durationSeconds?: number | null;
  }>,
): StoryboardRecord {
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
    panels: panels.map((panel, index) =>
      ({
        id: `panel-${index + 1}`,
        storyboardId: "storyboard-1",
        clipId: "clip-1",
        clipPanelIndex: index,
        panelIndex: index,
        sceneNumber: 0,
        shotType: "近景",
        cameraMove: "缓慢推近",
        description: "韩宇攥紧衣角，眼眶泛红。",
        locationName: "卧房",
        characters: ["韩宇"],
        props: [],
        imagePrompt: null,
        videoPrompt: "韩宇保持克制",
        durationSeconds: panel.durationSeconds ?? 20,
        speakingCharacter: panel.speakingCharacter ?? null,
        lipSyncText: panel.lipSyncText ?? null,
        voiceoverText: panel.voiceoverText ?? null,
        startState: {},
        endState: {},
        motionBeats: [],
        worldContext: {},
        vfxCues: [],
        sfxCues: [],
        sourceEvidence: panel.sourceEvidence,
        imageAssetId: null,
        videoAssetId: null,
        lipSyncAssetId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    ),
  };
}
