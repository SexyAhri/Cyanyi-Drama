import { describe, expect, it } from "vitest";

import type { EditorTimeline } from "../types";
import {
  alignTimelineSubtitles,
  buildPostMasterPackage,
  findTimelineAsset,
  moveTimelineTrack,
  reorderTimelineTrack,
  updateTimelineDuration,
  updateTimelineTrackSettings,
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

  it("supports direct drag reordering between arbitrary tracks", () => {
    const next = reorderTimelineTrack(timeline(), "panel-1", "panel-2");
    expect(next.tracks.map((track) => track.id)).toEqual([
      "panel-2",
      "panel-1",
    ]);
    expect(next.tracks[1]).toMatchObject({ start: 3, end: 5 });
  });

  it("stores bounded source, volume, and fade settings", () => {
    const next = updateTimelineTrackSettings(timeline(), "panel-1", {
      sourceStart: 2.5,
      volume: 3,
      transition: "fade",
      transitionDuration: 9,
    });
    expect(next.tracks[0]).toMatchObject({
      sourceStart: 2.5,
      volume: 2,
      transition: "fade",
      transitionDuration: 1,
    });
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

  it("does not overlap multiple dialogue lines in one track", () => {
    const subtitles = alignTimelineSubtitles(
      [
        {
          id: "line-1",
          lineIndex: 0,
          speaker: "A",
          content: "Hello",
          matchedPanelId: "panel-2",
          durationSeconds: 1,
        } as never,
        {
          id: "line-2",
          lineIndex: 1,
          speaker: "B",
          content: "World",
          matchedPanelId: "panel-2",
          durationSeconds: 2,
        } as never,
      ],
      timeline(),
    );

    expect(subtitles[0].start).toBe(2);
    expect(subtitles[0].end).toBe(subtitles[1].start);
    expect(subtitles[1].end).toBe(5);
  });

  it("converts the timeline to a millisecond EDL and QC report", () => {
    const result = buildPostMasterPackage({
      aspectRatio: "16:9",
      episodeId: "episode-1",
      frameRate: 24,
      language: "en",
      resolution: "1920x1080",
      subtitles: [],
      timeline: timeline(),
      title: "Episode 1",
    });
    expect(result.edl).toMatchObject({ durationMs: 5_000, frameRate: 24 });
    expect(result.edl.tracks[1]).toMatchObject({
      reel: "SHOT-002",
      inMs: 2_000,
      outMs: 5_000,
      sourceAssetId: "image-2",
    });
    expect(result.qc.frame_rate.status).toBe("pass");
    expect(result.qc.color_space.status).toBe("pending");
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
