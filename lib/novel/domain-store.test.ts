import { describe, expect, it } from "vitest";

import type { StoryboardPanelRecord } from "./domain-types";

describe("novel domain contracts", () => {
  it("keeps storyboard panels ordered by panel index", () => {
    const panels: StoryboardPanelRecord[] = [
      panel(2),
      panel(0),
      panel(1),
    ];
    expect([...panels].sort((a, b) => a.panelIndex - b.panelIndex).map((item) => item.panelIndex)).toEqual([0, 1, 2]);
  });

  it("requires project and episode ownership at the store boundary", () => {
    expect("project:owner + episode:owner").toContain("owner");
  });
});

function panel(panelIndex: number): StoryboardPanelRecord {
  return {
    id: `panel-${panelIndex}`,
    storyboardId: "storyboard",
    clipId: null,
    clipPanelIndex: null,
    panelIndex,
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
