export type DialogueTiming = {
  durationSeconds: number;
  lineIndex: number;
  playbackRate: number;
  startSeconds: number;
  endSeconds: number;
};

export function planPanelDialogue(input: {
  lineDurations: number[];
  requestedDurationSeconds?: number | null;
  maxDurationSeconds?: number;
  maxPlaybackRate?: number;
}) {
  const maxDuration = input.maxDurationSeconds ?? 15;
  const requestedDuration = clamp(
    Math.ceil(input.requestedDurationSeconds ?? 1),
    1,
    maxDuration,
  );
  const lineDurations = input.lineDurations.map((duration, index) => {
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error(`DIALOGUE_DURATION_INVALID:${index}`);
    return duration;
  });
  const rawDuration = lineDurations.reduce(
    (total, duration) => total + duration,
    0,
  );
  const durationSeconds = Math.min(
    maxDuration,
    Math.max(requestedDuration, Math.ceil(rawDuration)),
  );
  const playbackRate =
    rawDuration > durationSeconds ? rawDuration / durationSeconds : 1;
  if (playbackRate > (input.maxPlaybackRate ?? 1.2))
    throw new Error(
      `DIALOGUE_REQUIRES_SHOT_SPLIT:${rawDuration.toFixed(2)}:${durationSeconds}`,
    );

  let cursor = 0;
  const timings: DialogueTiming[] = lineDurations.map((duration, lineIndex) => {
    const adjustedDuration = duration / playbackRate;
    const timing = {
      durationSeconds: adjustedDuration,
      lineIndex,
      playbackRate,
      startSeconds: cursor,
      endSeconds: cursor + adjustedDuration,
    };
    cursor = timing.endSeconds;
    return timing;
  });
  return { durationSeconds, playbackRate, rawDuration, timings };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
