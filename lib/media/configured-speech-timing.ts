import { planPanelDialogue } from "./dialogue-timeline";
export function planConfiguredSpeechTiming(
  lines: Array<{
    durationSeconds: number;
    startSeconds?: number;
    endSeconds?: number;
  }>,
  durationSeconds: number,
) {
  const base = planPanelDialogue({
    lineDurations: lines.map((line) => line.durationSeconds),
    requestedDurationSeconds: durationSeconds,
  });
  if (
    lines.every(
      (line) =>
        line.startSeconds === undefined && line.endSeconds === undefined,
    )
  )
    return base;
  let cursor = 0;
  const timings = lines.map((line, index) => {
    const startSeconds = line.startSeconds ?? cursor;
    const natural = base.timings[index].durationSeconds;
    const endSeconds = line.endSeconds ?? startSeconds + natural;
    if (endSeconds <= startSeconds || endSeconds > durationSeconds + 0.01)
      throw new Error(
        `AUDIO_MERGE_SPEECH_TIMING_INVALID:${index}: 台词时序超出镜头，请调整时序或拆分镜头`,
      );
    const playbackRate = line.durationSeconds / (endSeconds - startSeconds);
    if (playbackRate > 1.2 || playbackRate < 0.8)
      throw new Error(
        `AUDIO_MERGE_SPEECH_TIMING_RATE:${index}: 配音时长与指定区间不匹配，请调整时序或重新配音`,
      );
    cursor = endSeconds;
    return {
      lineIndex: index,
      startSeconds,
      endSeconds,
      durationSeconds: endSeconds - startSeconds,
      playbackRate,
    };
  });
  return { ...base, durationSeconds, timings };
}
