import { describe, expect, it } from "vitest";

import type { EditorTimeline } from "../types";
import {
  alignTimelineSubtitles,
  findTimelineAsset,
  moveTimelineTrack,
  updateTimelineDuration,
} from "./delivery-view-model";

describe("delivery view model", () => {
  it("recalculates boundaries after reordering tracks", () => {
    const next = moveTimelineTrack(timeline(), "panel-2", -1);
    expect(
      next.tracks.map((track) => [track.id, track.start, track.end]),
    ).toEqual([
      ["panel-2", 0, 3],
      ["panel-1", 3, 5],
    ]);
  });

  it("updates and limits a track duration", () => {
    const next = updateTimelineDuration(timeline(), "panel-1", 40);
    expect(next.tracks.map((track) => track.duration)).toEqual([30, 3]);
    expect(next.duration).toBe(33);
  });

  it("uses lip sync media before video and image", () => {
    const assets = [{ id: "lip", url: "/lip.mp4" }] as never[];
    expect(findTimelineAsset(timeline().tracks[0], assets)?.id).toBe("lip");
  });

  it("realigns subtitles to reordered panel boundaries", () => {
    const moved = moveTimelineTrack(timeline(), "panel-2", -1);
    const subtitles = alignTimelineSubtitles(
      [
        {
          id: "line-1",
          lineIndex: 0,
          speaker: "A",
          content: "Hello",
          matchedPanelId: "panel-1",
        } as never,
      ],
      moved,
    );
    expect(subtitles[0]).toMatchObject({ start: 3, end: 5 });
  });
});

function timeline(): EditorTimeline {
  return {
    version: 1,
    duration: 5,
    tracks: [
      {
        id: "panel-1",
        clipId: null,
        shotIndex: 0,
        start: 0,
        end: 2,
        duration: 2,
        type: "video",
        imageAssetId: "image",
        videoAssetId: "video",
        lipSyncAssetId: "lip",
      },
      {
        id: "panel-2",
        clipId: null,
        shotIndex: 1,
        start: 2,
        end: 5,
        duration: 3,
        type: "image",
        imageAssetId: "image-2",
        videoAssetId: null,
        lipSyncAssetId: null,
      },
    ],
  };
}
