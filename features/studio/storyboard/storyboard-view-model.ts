import type { StoryboardContinuityIssue } from "@/lib/novel/continuity-store";

import type { StudioStoryboardPanel } from "../types";

export function getPanelContinuityIssues(
  panel: StudioStoryboardPanel,
  issues: StoryboardContinuityIssue[],
) {
  return issues.filter(
    (issue) =>
      issue.clipId === panel.clipId &&
      issue.panelIndex !== null &&
      issue.panelIndex === panel.clipPanelIndex,
  );
}

export function replaceStoryboardPanel(
  panels: StudioStoryboardPanel[],
  next: StudioStoryboardPanel,
) {
  return panels.map((panel) => (panel.id === next.id ? next : panel));
}

export function splitStoryboardPanel(
  panels: StudioStoryboardPanel[],
  panelId: string,
) {
  const index = panels.findIndex((panel) => panel.id === panelId);
  const panel = panels[index];
  const duration = Math.floor(panel?.durationSeconds ?? 0);
  if (!panel || duration < 2 || panel.clipId === null) return null;
  const firstDuration = Math.max(1, Math.floor(duration / 2));
  const secondDuration = duration - firstDuration;
  const [firstLip, secondLip] = splitExactText(panel.lipSyncText);
  const [firstVoiceover, secondVoiceover] = splitExactText(panel.voiceoverText);
  const first: StudioStoryboardPanel = {
    ...panel,
    durationSeconds: firstDuration,
    lipSyncText: firstLip,
    voiceoverText: firstVoiceover,
    endState: { ...panel.startState },
    motionBeats: splitMotionBeats(panel.motionBeats, 0, firstDuration),
    vfxCues: splitPointCues(panel.vfxCues, 0, firstDuration),
    sfxCues: splitRangeCues(panel.sfxCues, 0, firstDuration),
    linkedToNextPanel: true,
  };
  const second: StudioStoryboardPanel = {
    ...panel,
    id: `client_${crypto.randomUUID()}`,
    panelIndex: panel.panelIndex + 1,
    clipPanelIndex: (panel.clipPanelIndex ?? 0) + 1,
    durationSeconds: secondDuration,
    lipSyncText: secondLip,
    voiceoverText: secondVoiceover,
    startState: { ...panel.startState },
    motionBeats: splitMotionBeats(panel.motionBeats, firstDuration, duration),
    vfxCues: splitPointCues(panel.vfxCues, firstDuration, duration),
    sfxCues: splitRangeCues(panel.sfxCues, firstDuration, duration),
  };
  return [
    ...panels.slice(0, index),
    first,
    second,
    ...panels.slice(index + 1),
  ].map((item, itemIndex) => ({
    ...item,
    panelIndex: itemIndex,
    clipPanelIndex:
      item.clipId === panel.clipId &&
      itemIndex > index + 1 &&
      item.clipPanelIndex !== null
        ? item.clipPanelIndex + 1
        : item.clipPanelIndex,
  }));
}

export function mergeStoryboardPanelWithNext(
  panels: StudioStoryboardPanel[],
  panelId: string,
) {
  const index = panels.findIndex((panel) => panel.id === panelId);
  const first = panels[index];
  const second = panels[index + 1];
  if (
    !first ||
    !second ||
    first.clipId !== second.clipId ||
    first.sceneNumber !== second.sceneNumber ||
    first.speakingCharacter !== second.speakingCharacter ||
    (first.durationSeconds ?? 0) + (second.durationSeconds ?? 0) > 15
  )
    return null;
  const firstDuration = first.durationSeconds ?? 0;
  const merged: StudioStoryboardPanel = {
    ...first,
    durationSeconds: firstDuration + (second.durationSeconds ?? 0),
    description: [first.description, second.description]
      .filter(Boolean)
      .join("\n"),
    lipSyncText: joinNullable(first.lipSyncText, second.lipSyncText),
    voiceoverText: joinNullable(first.voiceoverText, second.voiceoverText),
    endState: { ...second.endState },
    motionBeats: [
      ...first.motionBeats,
      ...second.motionBeats.map((beat) => shiftBeat(beat, firstDuration)),
    ],
    worldContext: mergeWorldContext(first.worldContext, second.worldContext),
    vfxCues: [
      ...first.vfxCues,
      ...second.vfxCues.map((cue) => shiftPointCue(cue, firstDuration)),
    ],
    sfxCues: [
      ...first.sfxCues,
      ...second.sfxCues.map((cue) => shiftRangeCue(cue, firstDuration)),
    ],
    linkedToNextPanel: second.linkedToNextPanel,
    sourceEvidence: [
      ...new Set([...first.sourceEvidence, ...second.sourceEvidence]),
    ],
  };
  return [...panels.slice(0, index), merged, ...panels.slice(index + 2)].map(
    (item, itemIndex) => ({
      ...item,
      panelIndex: itemIndex,
      clipPanelIndex:
        item.clipId === first.clipId &&
        itemIndex > index &&
        item.clipPanelIndex !== null
          ? item.clipPanelIndex - 1
          : item.clipPanelIndex,
    }),
  );
}

function splitExactText(value: string | null) {
  if (!value) return [null, null] as const;
  const midpoint = Math.floor(value.length / 2);
  const candidates = Array.from(value.matchAll(/[，,。.!！？?；;：:]/g))
    .map((match) => (match.index ?? 0) + match[0].length)
    .filter((position) => position > 0 && position < value.length)
    .sort(
      (left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint),
    );
  const splitAt = candidates[0] ?? midpoint;
  return [
    value.slice(0, splitAt) || null,
    value.slice(splitAt) || null,
  ] as const;
}

function splitMotionBeats(
  beats: Array<Record<string, unknown>>,
  start: number,
  end: number,
) {
  const selected = beats.flatMap((beat) => {
    const beatStart = numberField(beat.startSecond);
    const beatEnd = numberField(beat.endSecond);
    if (
      beatStart === null ||
      beatEnd === null ||
      beatEnd <= start ||
      beatStart >= end
    )
      return [];
    return [
      {
        ...beat,
        startSecond: Math.max(start, beatStart) - start,
        endSecond: Math.min(end, beatEnd) - start,
      },
    ];
  });
  return selected.length
    ? selected
    : [
        {
          startSecond: 0,
          endSecond: end - start,
          action: "保持原镜头动作连续",
          camera: "保持原镜头轴线与运动",
        },
      ];
}

function shiftBeat(beat: Record<string, unknown>, offset: number) {
  const startSecond = numberField(beat.startSecond);
  const endSecond = numberField(beat.endSecond);
  return {
    ...beat,
    ...(startSecond === null ? {} : { startSecond: startSecond + offset }),
    ...(endSecond === null ? {} : { endSecond: endSecond + offset }),
  };
}

function splitPointCues(
  cues: Array<Record<string, unknown>>,
  start: number,
  end: number,
) {
  return cues.flatMap((cue) => {
    const atSecond = numberField(cue.atSecond);
    if (atSecond === null || atSecond < start || atSecond >= end) return [];
    return [{ ...cue, atSecond: atSecond - start }];
  });
}

function splitRangeCues(
  cues: Array<Record<string, unknown>>,
  start: number,
  end: number,
) {
  return cues.flatMap((cue) => {
    const cueStart = numberField(cue.startSecond);
    const cueEnd = numberField(cue.endSecond);
    if (
      cueStart === null ||
      cueEnd === null ||
      cueEnd <= start ||
      cueStart >= end
    )
      return [];
    return [
      {
        ...cue,
        startSecond: Math.max(start, cueStart) - start,
        endSecond: Math.min(end, cueEnd) - start,
      },
    ];
  });
}

function shiftPointCue(cue: Record<string, unknown>, offset: number) {
  const atSecond = numberField(cue.atSecond);
  return {
    ...cue,
    ...(atSecond === null ? {} : { atSecond: atSecond + offset }),
  };
}

function shiftRangeCue(cue: Record<string, unknown>, offset: number) {
  const startSecond = numberField(cue.startSecond);
  const endSecond = numberField(cue.endSecond);
  return {
    ...cue,
    ...(startSecond === null ? {} : { startSecond: startSecond + offset }),
    ...(endSecond === null ? {} : { endSecond: endSecond + offset }),
  };
}

function mergeWorldContext(
  first: Record<string, unknown>,
  second: Record<string, unknown>,
) {
  const evidence = [
    ...new Set([
      ...stringArray(first.evidence),
      ...stringArray(second.evidence),
    ]),
  ];
  return {
    ...first,
    ...second,
    ...(evidence.length ? { evidence } : {}),
  };
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberField(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function joinNullable(left: string | null, right: string | null) {
  return left || right ? `${left ?? ""}${right ?? ""}` : null;
}
