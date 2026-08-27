import { planPanelDialogue } from "@/lib/media/dialogue-timeline";

export type EditorTimelineTrack = {
  clipId: string | null;
  duration: number;
  end: number;
  id: string;
  imageAssetId: string | null;
  lipSyncAssetId: string | null;
  shotIndex: number;
  start: number;
  type: "image" | "video";
  videoAssetId: string | null;
};

export function buildSequentialTimeline(
  input: Array<{
    clipId?: string | null;
    duration?: number | null;
    id: string;
    imageAssetId?: string | null;
    lipSyncAssetId?: string | null;
    shotIndex: number;
    videoAssetId?: string | null;
  }>,
) {
  let cursor = 0;
  const tracks = input.map((item) => {
    const duration = normalizeDuration(item.duration);
    const track: EditorTimelineTrack = {
      clipId: item.clipId ?? null,
      duration,
      end: cursor + duration,
      id: item.id,
      imageAssetId: item.imageAssetId ?? null,
      lipSyncAssetId: item.lipSyncAssetId ?? null,
      shotIndex: item.shotIndex,
      start: cursor,
      type: item.lipSyncAssetId || item.videoAssetId ? "video" : "image",
      videoAssetId: item.videoAssetId ?? null,
    };
    cursor = track.end;
    return track;
  });
  return { duration: cursor, tracks, version: 1 as const };
}

export function parseTimelineSequence(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.tracks)) return [];
  const seen = new Set<string>();
  return value.tracks.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    const id = entry.id.trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ id, duration: normalizeDuration(entry.duration) }];
  });
}

export function buildPanelSubtitleTimings(input: {
  lineDurations: number[];
  trackDuration: number;
  trackStart: number;
}) {
  const plan = planPanelDialogue({
    lineDurations: input.lineDurations,
    requestedDurationSeconds: input.trackDuration,
    maxDurationSeconds: Math.max(1, Math.ceil(input.trackDuration)),
  });
  return plan.timings.map((timing) => ({
    start: input.trackStart + timing.startSeconds,
    end: Math.min(
      input.trackStart + input.trackDuration,
      input.trackStart + timing.endSeconds,
    ),
  }));
}

function normalizeDuration(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(30, Math.max(0.5, value))
    : 5;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
