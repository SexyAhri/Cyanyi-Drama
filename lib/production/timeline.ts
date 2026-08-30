import { planPanelDialogue } from "@/lib/media/dialogue-timeline";

export type EditorTimelineTrack = {
  clipId: string | null;
  duration: number;
  end: number;
  id: string;
  imageAssetId: string | null;
  lipSyncAssetId: string | null;
  sourceStart: number;
  shotIndex: number;
  start: number;
  transition: "cut" | "fade";
  transitionDuration: number;
  type: "image" | "video";
  videoAssetId: string | null;
  volume: number;
};

export type TimelineSubtitleCue = {
  id: string;
  index: number;
  start: number;
  end: number;
  speaker: string;
  text: string;
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
      sourceStart: 0,
      shotIndex: item.shotIndex,
      start: cursor,
      transition: "cut",
      transitionDuration: 0.35,
      type: item.lipSyncAssetId || item.videoAssetId ? "video" : "image",
      videoAssetId: item.videoAssetId ?? null,
      volume: 1,
    };
    cursor = track.end;
    return track;
  });
  return { duration: cursor, tracks, version: 2 as const };
}

export function parseTimelineSequence(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.tracks)) return [];
  const seen = new Set<string>();
  return value.tracks.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    const id = entry.id.trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      duration: normalizeDuration(entry.duration),
      sourceStart: normalizeSourceStart(entry.sourceStart),
      transition: entry.transition === "fade" ? ("fade" as const) : ("cut" as const),
      transitionDuration: normalizeTransitionDuration(entry.transitionDuration),
      volume: normalizeVolume(entry.volume),
    }];
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

export function buildTimelineSubtitles(
  lines: readonly {
    id: string;
    lineIndex: number;
    speaker: string;
    content: string;
    matchedPanelId?: string | null;
    durationSeconds?: number | null;
  }[],
  tracks: readonly { id: string; duration: number }[],
): TimelineSubtitleCue[] {
  const orderedLines = [...lines].sort(
    (left, right) => left.lineIndex - right.lineIndex,
  );
  let trackStart = 0;
  const cues: TimelineSubtitleCue[] = [];
  for (const track of tracks) {
    const trackDuration = normalizeDuration(track.duration);
    const matchedLines = orderedLines.filter(
      (line) => line.matchedPanelId === track.id && line.content.trim(),
    );
    if (matchedLines.length) {
      const fallbackDuration = trackDuration / matchedLines.length;
      const timings = buildPanelSubtitleTimings({
        lineDurations: matchedLines.map(
          (line) => line.durationSeconds ?? fallbackDuration,
        ),
        trackDuration,
        trackStart,
      });
      matchedLines.forEach((line, index) =>
        cues.push({
          id: line.id,
          index: line.lineIndex,
          ...timings[index],
          speaker: line.speaker,
          text: line.content.trim(),
        }),
      );
    }
    trackStart += trackDuration;
  }
  return cues.sort(
    (left, right) => left.start - right.start || left.index - right.index,
  );
}

function normalizeDuration(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(30, Math.max(0.5, value))
    : 5;
}

function normalizeSourceStart(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(300, Math.max(0, value))
    : 0;
}

function normalizeVolume(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(2, Math.max(0, value))
    : 1;
}

function normalizeTransitionDuration(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(2, Math.max(0.1, value))
    : 0.35;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
