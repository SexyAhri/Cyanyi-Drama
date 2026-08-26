import { describe, expect, it } from "vitest";

import type { StoryboardContinuityIssue } from "@/lib/novel/continuity-store";

import type { StudioStoryboardPanel } from "../types";
import {
  getPanelContinuityIssues,
  replaceStoryboardPanel,
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
    lipSyncAssetId: input.lipSyncAssetId ?? null,
  };
}
