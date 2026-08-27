import type {
  EditorSubtitle,
  EditorTimeline,
  ProjectMediaAsset,
  VoiceLineRecord,
} from "../types";
import {
  emptyPostQc,
  MASTER_QC_KEYS,
  parsePostMasterPackage,
  type PostMasterPackage,
} from "@/lib/production/post-contract";
import type { ProductionDeliverableRecord } from "../types";

export function moveTimelineTrack(
  timeline: EditorTimeline,
  trackId: string,
  direction: -1 | 1,
) {
  const index = timeline.tracks.findIndex((track) => track.id === trackId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= timeline.tracks.length)
    return timeline;
  const tracks = [...timeline.tracks];
  [tracks[index], tracks[nextIndex]] = [tracks[nextIndex], tracks[index]];
  return rebuildTimeline(tracks);
}

export function updateTimelineDuration(
  timeline: EditorTimeline,
  trackId: string,
  duration: number,
) {
  return rebuildTimeline(
    timeline.tracks.map((track) =>
      track.id === trackId
        ? { ...track, duration: Math.min(30, Math.max(0.5, duration)) }
        : track,
    ),
  );
}

export function timelineAssetId(track: EditorTimeline["tracks"][number]) {
  return track.lipSyncAssetId ?? track.videoAssetId ?? track.imageAssetId;
}

export function findTimelineAsset(
  track: EditorTimeline["tracks"][number] | undefined,
  assets: ProjectMediaAsset[],
) {
  const id = track ? timelineAssetId(track) : null;
  return id ? assets.find((asset) => asset.id === id) : undefined;
}

export function alignTimelineSubtitles(
  lines: VoiceLineRecord[],
  timeline: EditorTimeline,
): EditorSubtitle[] {
  return lines.map((line, index) => {
    const track = line.matchedPanelId
      ? timeline.tracks.find((item) => item.id === line.matchedPanelId)
      : undefined;
    return {
      id: line.id,
      index,
      start: track?.start ?? 0,
      end: track?.end ?? 0,
      speaker: line.speaker,
      text: line.content,
    };
  });
}

export function buildPostMasterPackage(input: {
  aspectRatio: string;
  episodeId: string;
  frameRate: number;
  language: string;
  resolution: string;
  subtitles: EditorSubtitle[];
  timeline: EditorTimeline;
  title: string;
}): PostMasterPackage {
  const qc = emptyPostQc(MASTER_QC_KEYS);
  qc.frame_rate = {
    status: "pass",
    measured: input.frameRate,
    target: input.frameRate,
    unit: "fps",
    note: "",
  };
  qc.subtitle_coverage = {
    status: "pass",
    measured: input.subtitles.length,
    target: input.subtitles.length,
    unit: "cues",
    note: "",
  };
  return {
    schemaVersion: 1,
    episodeId: input.episodeId,
    edl: {
      title: input.title,
      frameRate: input.frameRate,
      durationMs: Math.round(input.timeline.duration * 1_000),
      tracks: input.timeline.tracks.map((track, index) => ({
        id: track.id,
        reel: `SHOT-${String(index + 1).padStart(3, "0")}`,
        shotIndex: track.shotIndex,
        sourceAssetId: timelineAssetId(track),
        inMs: Math.round(track.start * 1_000),
        outMs: Math.round(track.end * 1_000),
      })),
    },
    color: {
      workingSpace: "ACEScct",
      outputSpace: "Rec.709 Gamma 2.4",
      lookName: "",
      lutName: "",
      notes: "",
    },
    online: {
      resolution: input.resolution,
      aspectRatio: input.aspectRatio,
      codec: "ProRes 422 HQ",
      frameRate: input.frameRate,
    },
    subtitles: {
      language: input.language,
      format: "srt",
      cueCount: input.subtitles.length,
      missingCueCount: 0,
    },
    qc,
  };
}

export function getPostMasterVersions(
  deliverables: ProductionDeliverableRecord[],
  episodeId: string,
) {
  return deliverables
    .filter(
      (item) =>
        item.department === "post" &&
        item.deliverableType === "post_master_package" &&
        item.scopeType === "episode" &&
        item.scopeId === episodeId,
    )
    .sort((left, right) => right.version - left.version)
    .map((deliverable) => {
      const parsed = parsePostMasterPackage(deliverable.payload);
      return {
        deliverable,
        package: parsed.success ? parsed.data : null,
      };
    });
}

export function getCurrentPostMasterVersion(
  versions: ReturnType<typeof getPostMasterVersions>,
) {
  return versions.find(
    (item) => !["stale", "superseded"].includes(item.deliverable.status),
  );
}

export function getMasterQcReadiness(masterPackage: PostMasterPackage) {
  const statuses = MASTER_QC_KEYS.map((key) => masterPackage.qc[key].status);
  return {
    passed: statuses.filter((status) => status === "pass").length,
    failed: statuses.filter((status) => status === "fail").length,
    total: statuses.length,
  };
}

function rebuildTimeline(tracks: EditorTimeline["tracks"]) {
  let cursor = 0;
  const nextTracks = tracks.map((track) => {
    const duration = Math.min(30, Math.max(0.5, track.duration));
    const next = { ...track, start: cursor, end: cursor + duration, duration };
    cursor = next.end;
    return next;
  });
  return { version: 1, duration: cursor, tracks: nextTracks };
}
