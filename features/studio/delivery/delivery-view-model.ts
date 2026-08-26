import type {
  EditorSubtitle,
  EditorTimeline,
  ProjectMediaAsset,
  VoiceLineRecord,
} from "../types";

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
