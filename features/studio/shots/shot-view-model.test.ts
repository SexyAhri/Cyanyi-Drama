import { describe, expect, it } from "vitest";

import type { MediaTask } from "@/lib/media/task-contract";

import type {
  ProjectMediaAsset,
  StudioStoryboardPanel,
} from "../types";
import {
  buildShotMediaCandidates,
  latestPanelTasks,
  nextStoryboardPanel,
} from "./shot-view-model";

describe("shot view model", () => {
  it("scopes candidates to the panel and marks the persisted baseline", () => {
    const panel = createPanel({ imageAssetId: "asset-1" });
    const candidates = buildShotMediaCandidates(
      panel,
      "image",
      [asset("asset-1", "panel-1"), asset("foreign", "panel-2")],
      [task("task-1", "panel-1", "succeeded", "asset-1")],
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      assetId: "asset-1",
      selected: true,
      url: "https://media.test/asset-1.png",
    });
  });

  it("keeps only the latest task per selected panel for bulk controls", () => {
    const tasks = [
      task("old", "panel-1", "failed", undefined, "2026-08-26T01:00:00Z"),
      task("new", "panel-1", "running", undefined, "2026-08-26T02:00:00Z"),
      task("other", "panel-2", "failed", undefined, "2026-08-26T03:00:00Z"),
    ];

    expect(latestPanelTasks(["panel-1", "panel-2"], "image", tasks).map((item) => item.id)).toEqual([
      "other",
      "new",
    ]);
  });

  it("resolves only an explicitly linked next panel", () => {
    const first = createPanel({ linkedToNextPanel: true });
    const second = createPanel({ id: "panel-2", panelIndex: 1 });

    expect(nextStoryboardPanel(first, [second, first])?.id).toBe("panel-2");
    expect(nextStoryboardPanel({ ...first, linkedToNextPanel: false }, [first, second])).toBeUndefined();
  });
});

function asset(id: string, panelId: string): ProjectMediaAsset {
  return {
    id,
    kind: "image",
    url: `https://media.test/${id}.png`,
    mimeType: "image/png",
    metadata: {},
    references: [],
    sourceTargetId: panelId,
    sourceTargetType: "storyboard_panel",
    taskStatus: "succeeded",
    createdAt: "2026-08-26T02:00:00Z",
  };
}

function task(
  id: string,
  panelId: string,
  status: MediaTask["status"],
  assetId?: string,
  updatedAt = "2026-08-26T02:00:00Z",
): MediaTask {
  return {
    id,
    traceId: `${id}-trace`,
    spanId: `${id}-span`,
    projectId: "project-1",
    episodeId: "episode-1",
    targetType: "storyboard_panel",
    targetId: panelId,
    kind: "image",
    status,
    provider: "test",
    protocol: "openai-compatible",
    model: "test",
    request: {},
    output: assetId
      ? [{ id: assetId, kind: "image", url: `https://media.test/${assetId}.png` }]
      : undefined,
    retryCount: 0,
    maxRetries: 2,
    progress: status === "succeeded" ? 100 : 0,
    createdAt: updatedAt,
    updatedAt,
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
    createdAt: "2026-08-26T00:00:00Z",
    updatedAt: "2026-08-26T00:00:00Z",
    ...input,
    lipSyncAssetId: input.lipSyncAssetId ?? null,
  };
}
