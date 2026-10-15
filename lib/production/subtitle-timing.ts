export type SubtitleCue = {
  id: string;
  index: number;
  start: number;
  end: number;
  text: string;
  speaker: string;
};
export type SubtitleTimingIssue = {
  id: string;
  code: "invalid" | "duplicate" | "overlap" | "order" | "too_short";
  message: string;
};
export type SubtitleAudioSource = { id: string; audioAssetId?: string | null };

/** Reading estimates are editable editorial defaults, never measured speech duration. */
export function subtitleReadingSeconds(text: string) {
  const words = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z]+)*/g)?.length ?? 0;
  const other = Array.from(
    text.replace(/[A-Za-z0-9\s\p{P}\p{S}]/gu, ""),
  ).length;
  return Math.max(1, words / 3 + other / 5 + 0.35);
}

export function planSilentSubtitles(
  texts: readonly string[],
  duration: number,
) {
  if (!texts.length) return [];
  const readings = texts.map(subtitleReadingSeconds);
  const required = readings.reduce((sum, value) => sum + value, 0);
  if (required > duration + 0.01)
    throw new Error(
      "SUBTITLE_READING_TIME_INSUFFICIENT: 字幕阅读时间不足，请延长镜头或精简文字",
    );
  // Leave up to 35% of a silent shot for action and expression. Longer text gets
  // more reading time; a one-character reply no longer occupies half the shot.
  const spare = duration - required;
  const pauseTotal = Math.min(spare, Math.max(0.6, duration * 0.35));
  const holdExtra = Math.min(spare - pauseTotal, required * 0.3);
  const gap = pauseTotal / (texts.length + 1);
  let cursor = gap;
  return readings.map((reading) => {
    const start = cursor;
    const end = start + reading + (holdExtra * reading) / required;
    cursor = end + gap;
    return {
      start: Math.round(start * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
    };
  });
}

export function inspectSubtitleTimings(
  cues: readonly SubtitleCue[],
  duration: number,
  voiceLines: readonly SubtitleAudioSource[] = [],
): SubtitleTimingIssue[] {
  const issues: SubtitleTimingIssue[] = [];
  const seen = new Set<string>();
  const audioLineIds = new Set(
    voiceLines
      .filter(
        (line) =>
          typeof line.audioAssetId === "string" && line.audioAssetId.trim(),
      )
      .map((line) => line.id),
  );
  let previous: SubtitleCue | undefined;
  for (const cue of cues) {
    if (seen.has(cue.id))
      issues.push({
        id: cue.id,
        code: "duplicate",
        message: "字幕标识重复 / Duplicate subtitle",
      });
    seen.add(cue.id);
    if (
      !cue.id ||
      !cue.text.trim() ||
      !Number.isFinite(cue.start) ||
      !Number.isFinite(cue.end) ||
      cue.start < 0 ||
      cue.end <= cue.start ||
      cue.end > duration + 0.001
    )
      issues.push({
        id: cue.id,
        code: "invalid",
        message: "字幕入出点无效或超出片长 / Invalid or out-of-range timing",
      });
    if (previous && cue.start < previous.start)
      issues.push({
        id: cue.id,
        code: "order",
        message: "字幕顺序倒置 / Subtitle order reversed",
      });
    if (previous && cue.start < previous.end - 0.001)
      issues.push({
        id: cue.id,
        code: "overlap",
        message: "字幕时间重叠 / Subtitles overlap",
      });
    if (
      !audioLineIds.has(cue.id) &&
      cue.end - cue.start + 0.001 < subtitleReadingSeconds(cue.text)
    )
      issues.push({
        id: cue.id,
        code: "too_short",
        message: "字幕阅读时间不足 / Insufficient reading time",
      });
    previous = cue;
  }
  return issues;
}

export function parseSavedSubtitles(value: unknown): SubtitleCue[] {
  if (!Array.isArray(value)) throw new Error("TIMELINE_SUBTITLES_INVALID");
  return value.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      typeof item.text !== "string" ||
      typeof item.speaker !== "string" ||
      !Number.isInteger(item.index) ||
      typeof item.start !== "number" ||
      typeof item.end !== "number"
    )
      throw new Error("TIMELINE_SUBTITLES_INVALID");
    return {
      id: item.id,
      index: item.index,
      start: item.start,
      end: item.end,
      text: item.text,
      speaker: item.speaker,
    };
  });
}
