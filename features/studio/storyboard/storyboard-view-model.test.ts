import { describe, expect, it } from "vitest";

import type { StoryboardContinuityIssue } from "@/lib/novel/continuity-store";

import type { StudioStoryboardPanel } from "../types";
import {
  getPanelContinuityIssues,
  mergeStoryboardPanelWithNext,
  replaceStoryboardPanel,
  splitStoryboardPanel,
} from "./storyboard-view-model";

describe("storyboard view model", () => {
  it("matches clip-local continuity issues to the persisted panel identity", () => {
    const panel = createPanel({ clipId: "clip-1", clipPanelIndex: 2 });
    const issues: StoryboardContinuityIssue[] = [
      issue("clip-1", 2),
      issue("clip-1", 1),
      issue("clip-2", 2),
    ];

    expect(getPanelContinuityIssues(panel, issues)).toEqual([issues[0]]);
  });

  it("replaces only the edited panel", () => {
    const first = createPanel({ id: "panel-1" });
    const second = createPanel({ id: "panel-2", panelIndex: 1 });
    const edited = { ...second, description: "Updated" };

    expect(replaceStoryboardPanel([first, second], edited)).toEqual([
      first,
      edited,
    ]);
  });

  it("splits lip-sync text exactly and keeps global panel order", () => {
    const panel = createPanel({
      durationSeconds: 6,
      speakingCharacter: "甲",
      lipSyncText: "先把药拿来，再扶父亲坐好。",
      startState: { hands: "空手" },
      endState: { hands: "扶住父亲" },
      motionBeats: [
        { startSecond: 0, endSecond: 6, action: "说话", camera: "固定" },
      ],
    });
    const split = splitStoryboardPanel([panel], panel.id);

    expect(split).toHaveLength(2);
    expect(split?.map((item) => item.lipSyncText).join("")).toBe(
      panel.lipSyncText,
    );
    expect(split?.map((item) => item.panelIndex)).toEqual([0, 1]);
  });

  it("merges adjacent compatible shots and restores exact lip-sync text", () => {
    const first = createPanel({
      durationSeconds: 3,
      sceneNumber: 0,
      speakingCharacter: "甲",
      lipSyncText: "先把药拿来，",
    });
    const second = createPanel({
      id: "panel-2",
      panelIndex: 1,
      clipPanelIndex: 1,
      durationSeconds: 3,
      sceneNumber: 0,
      speakingCharacter: "甲",
      lipSyncText: "再扶父亲坐好。",
    });
    const merged = mergeStoryboardPanelWithNext([first, second], first.id);

    expect(merged).toHaveLength(1);
    expect(merged?.[0]).toMatchObject({
      durationSeconds: 6,
      lipSyncText: "先把药拿来，再扶父亲坐好。",
    });
  });

  it("splits and re-merges VFX and SFX cues without losing their timing", () => {
    const panel = createPanel({
      durationSeconds: 6,
      vfxCues: [
        { atSecond: 1, phase: "charge", description: "蓄力" },
        { atSecond: 4, phase: "impact", description: "命中" },
      ],
      sfxCues: [
        { startSecond: 2, endSecond: 5, type: "energy", description: "能量持续" },
      ],
    });
    const split = splitStoryboardPanel([panel], panel.id);
    expect(split?.[0].vfxCues).toHaveLength(1);
    expect(split?.[1].vfxCues[0]).toMatchObject({ atSecond: 1 });
    expect(split?.[0].sfxCues[0]).toMatchObject({ startSecond: 2, endSecond: 3 });
    expect(split?.[1].sfxCues[0]).toMatchObject({ startSecond: 0, endSecond: 2 });

    const merged = split && mergeStoryboardPanelWithNext(split, split[0].id);
    expect(merged?.[0].vfxCues.map((cue) => cue.atSecond)).toEqual([1, 4]);
    expect(merged?.[0].sfxCues).toHaveLength(2);
  });
});

function issue(
  clipId: string,
  panelIndex: number,
): StoryboardContinuityIssue {
  return {
    clipId,
    code: "TEST",
    severity: "warning",
    panelIndex,
    entityType: null,
    entityName: null,
    message: "Issue",
    suggestedFix: null,
  };
}

function createPanel(
  input: Partial<StudioStoryboardPanel> = {},
): StudioStoryboardPanel {
  return {
    id: "panel-1",
    storyboardId: "storyboard-1",
    clipId: "clip-1",
    clipPanelIndex: 0,
    panelIndex: 0,
    shotType: null,
    cameraMove: null,
    description: null,
    locationName: null,
    characters: [],
    props: [],
    imagePrompt: null,
    videoPrompt: null,
    sourceEvidence: [],
    imageAssetId: null,
    videoAssetId: null,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
    ...input,
    sceneNumber: input.sceneNumber ?? null,
    speakingCharacter: input.speakingCharacter ?? null,
    lipSyncText: input.lipSyncText ?? null,
    voiceoverText: input.voiceoverText ?? null,
    startState: input.startState ?? {},
    endState: input.endState ?? {},
    motionBeats: input.motionBeats ?? [],
    worldContext: input.worldContext ?? {},
    vfxCues: input.vfxCues ?? [],
    sfxCues: input.sfxCues ?? [],
    lipSyncAssetId: input.lipSyncAssetId ?? null,
  };
}
