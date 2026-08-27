import type { StoryboardContinuityIssue } from "@/lib/novel/continuity-store";

import type { StudioStoryboardPanel } from "../types";

export type PrevisSpecKey =
  | "composition"
  | "focalLength"
  | "cameraPosition"
  | "cameraMovement"
  | "lighting"
  | "duration"
  | "performance"
  | "continuity";

export type PhotographyRules = {
  camera: string;
  cameraPosition: string;
  focalLength: string;
  lighting: string;
  composition: string;
  depthOfField: string;
  colorTone: string;
};

export type ActingDirection = {
  name: string;
  emotion: string;
  action: string;
  expression: string;
};

export function parsePhotographyRules(
  value: string | null | undefined,
): PhotographyRules {
  const record = parseRecord(value);
  return {
    camera: text(record.camera),
    cameraPosition: text(record.cameraPosition),
    focalLength: text(record.focalLength),
    lighting: text(record.lighting),
    composition: text(record.composition),
    depthOfField: text(record.depthOfField),
    colorTone: text(record.colorTone),
  };
}

export function parseActingDirections(
  value: Record<string, unknown> | undefined,
): ActingDirection[] {
  if (!Array.isArray(value?.characters)) return [];
  return value.characters.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const name = text(record.name);
    if (!name) return [];
    return [
      {
        name,
        emotion: text(record.emotion),
        action: text(record.action),
        expression: text(record.expression),
      },
    ];
  });
}

export function getPrevisReadiness(
  panel: StudioStoryboardPanel,
  issues: StoryboardContinuityIssue[],
) {
  const photography = parsePhotographyRules(panel.photographyRules);
  const acting = parseActingDirections(panel.actingNotes);
  const missing: PrevisSpecKey[] = [];
  if (!photography.composition) missing.push("composition");
  if (!photography.focalLength) missing.push("focalLength");
  if (!photography.cameraPosition) missing.push("cameraPosition");
  if (!panel.cameraMove) missing.push("cameraMovement");
  if (!photography.lighting) missing.push("lighting");
  if (!panel.durationSeconds || panel.durationSeconds <= 0)
    missing.push("duration");
  if (
    panel.characters.some((name) => {
      const direction = acting.find((item) => item.name === name);
      return (
        !direction ||
        ![direction.emotion, direction.action, direction.expression].every(
          Boolean,
        )
      );
    })
  )
    missing.push("performance");
  if (issues.some((issue) => issue.severity === "error"))
    missing.push("continuity");
  return {
    complete: 8 - missing.length,
    isReady: missing.length === 0,
    missing,
    total: 8,
  };
}

export function serializePhotographyRules(value: PhotographyRules) {
  const entries = Object.entries(value).filter(([, item]) => item.trim());
  return entries.length ? JSON.stringify(Object.fromEntries(entries)) : null;
}

export function serializeActingDirections(
  characters: string[],
  values: Record<string, Omit<ActingDirection, "name">>,
) {
  const directions = characters.flatMap((name) => {
    const value = values[name];
    if (
      !value ||
      ![value.emotion, value.action, value.expression].some((item) =>
        item.trim(),
      )
    )
      return [];
    return [{ name, ...value }];
  });
  return directions.length ? { characters: directions } : {};
}

function parseRecord(value: string | null | undefined) {
  if (!value) return {} as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return { camera: value };
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
