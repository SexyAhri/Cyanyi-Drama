import { z } from "zod";

import { storyboardPlanningSchema } from "@/lib/prompts/schemas";
import { estimateSpeechDurationSeconds } from "@/lib/prompts/validators";

type StoryboardPlanning = z.infer<typeof storyboardPlanningSchema>;
type StoryboardPanel = StoryboardPlanning["panels"][number];

export const STORYBOARD_DIALOGUE_TIMING_VERSION = 1;
export const MAX_STORYBOARD_SHOT_SECONDS = 15;

export function normalizeStoryboardDialogueTiming(
  planning: StoryboardPlanning,
): StoryboardPlanning {
  const panels = planning.panels.flatMap((panel) => normalizePanel(panel));
  return {
    ...planning,
    panels: panels.map((panel, panelIndex) => ({ ...panel, panelIndex })),
  };
}

export function splitSpokenTextForShots(
  value: string,
  maxDurationSeconds = MAX_STORYBOARD_SHOT_SECONDS,
) {
  if (estimateSpeechDurationSeconds(value) <= maxDurationSeconds)
    return [value];

  const chunks: string[] = [];
  let current = "";
  for (const unit of naturalSpeechUnits(value)) {
    if (estimateSpeechDurationSeconds(unit) > maxDurationSeconds) {
      if (current) chunks.push(current);
      chunks.push(...splitOversizedUnit(unit, maxDurationSeconds));
      current = "";
      continue;
    }
    if (
      current &&
      estimateSpeechDurationSeconds(current + unit) > maxDurationSeconds
    ) {
      chunks.push(current);
      current = unit;
    } else current += unit;
  }
  if (current) chunks.push(current);
  return chunks;
}

function normalizePanel(panel: StoryboardPanel): StoryboardPanel[] {
  const spokenField = panel.lipSyncText
    ? ("lipSyncText" as const)
    : panel.voiceoverText
      ? ("voiceoverText" as const)
      : null;
  if (!spokenField) return [panel];

  const spokenText = panel[spokenField]!;
  const segments = splitSpokenTextForShots(spokenText);
  if (segments.length === 1) {
    const durationSeconds = Math.max(
      panel.durationSeconds,
      estimateSpeechDurationSeconds(spokenText),
    );
    if (durationSeconds === panel.durationSeconds) return [panel];
    return [retimePanel(panel, durationSeconds)];
  }

  const holdingState = panel.startState ?? panel.endState;
  return segments.map((segment, segmentIndex) => {
    const durationSeconds = estimateSpeechDurationSeconds(segment);
    const isFirst = segmentIndex === 0;
    const isLast = segmentIndex === segments.length - 1;
    const splitPanel: StoryboardPanel = {
      ...panel,
      durationSeconds,
      [spokenField]: segment,
      startState: isFirst ? panel.startState : holdingState,
      endState: isLast ? panel.endState : holdingState,
      motionTimeline: buildSpokenMotionTimeline(
        panel,
        segment,
        durationSeconds,
        segmentIndex,
        segments.length,
      ),
      vfxCues: isFirst ? normalizeVfxCues(panel.vfxCues, durationSeconds) : [],
      sfxCues: isFirst ? normalizeSfxCues(panel.sfxCues, durationSeconds) : [],
      videoPrompt: replaceSpokenText(panel.videoPrompt, spokenText, segment),
    };
    return splitPanel;
  });
}

function retimePanel(panel: StoryboardPanel, durationSeconds: number) {
  return {
    ...panel,
    durationSeconds,
    motionTimeline: retimeMotionTimeline(panel.motionTimeline, durationSeconds),
    vfxCues: normalizeVfxCues(panel.vfxCues, durationSeconds),
    sfxCues: normalizeSfxCues(panel.sfxCues, durationSeconds),
  };
}

function naturalSpeechUnits(value: string) {
  const units: string[] = [];
  let current = "";
  for (const character of Array.from(value)) {
    current += character;
    if (/[，,。.!！？?；;：:…]/u.test(character)) {
      units.push(current);
      current = "";
    }
  }
  if (current) units.push(current);
  return units;
}

function splitOversizedUnit(value: string, maxDurationSeconds: number) {
  const chunks: string[] = [];
  let current = "";
  for (const character of Array.from(value)) {
    if (
      current &&
      estimateSpeechDurationSeconds(current + character) > maxDurationSeconds
    ) {
      chunks.push(current);
      current = character;
    } else current += character;
  }
  if (current) chunks.push(current);
  return chunks;
}

function retimeMotionTimeline(
  timeline: StoryboardPanel["motionTimeline"],
  durationSeconds: number,
) {
  const beatCount = Math.min(timeline.length, durationSeconds);
  return timeline.slice(0, beatCount).map((beat, index) => ({
    ...beat,
    startSecond: Math.floor((durationSeconds * index) / beatCount),
    endSecond: Math.floor((durationSeconds * (index + 1)) / beatCount),
  }));
}

function buildSpokenMotionTimeline(
  panel: StoryboardPanel,
  segment: string,
  durationSeconds: number,
  segmentIndex: number,
  segmentCount: number,
) {
  const beatCount = durationSeconds <= 4 ? 1 : durationSeconds <= 9 ? 2 : 3;
  const performer = panel.speakingCharacter ?? "画外音表演者";
  return Array.from({ length: beatCount }, (_, beatIndex) => ({
    startSecond: Math.floor((durationSeconds * beatIndex) / beatCount),
    endSecond: Math.floor((durationSeconds * (beatIndex + 1)) / beatCount),
    action:
      beatIndex === 0
        ? `${performer}从上一镜状态自然承接第 ${segmentIndex + 1}/${segmentCount} 段口播：${segment}`
        : beatIndex === beatCount - 1
          ? `${performer}保持原情绪与语速完成本段口播并自然停顿`
          : `${performer}保持呼吸、表情和视线连续地推进本段口播`,
    camera:
      beatIndex === beatCount - 1
        ? "保持轴线与构图连续并自然停稳"
        : `${panel.cameraMove}，承接上一节拍的机位与速度`,
  }));
}

function normalizeVfxCues(
  cues: StoryboardPanel["vfxCues"],
  durationSeconds: number,
) {
  return cues.map((cue) => ({
    ...cue,
    atSecond: Math.min(cue.atSecond, durationSeconds),
  }));
}

function normalizeSfxCues(
  cues: StoryboardPanel["sfxCues"],
  durationSeconds: number,
) {
  return cues
    .filter((cue) => cue.startSecond < durationSeconds)
    .map((cue) => ({
      ...cue,
      endSecond: Math.max(
        cue.startSecond + 1,
        Math.min(cue.endSecond, durationSeconds),
      ),
    }));
}

function replaceSpokenText(prompt: string, fullText: string, segment: string) {
  return prompt.includes(fullText)
    ? prompt.replace(fullText, segment)
    : `${prompt}\n本镜头口播片段：${segment}`;
}
