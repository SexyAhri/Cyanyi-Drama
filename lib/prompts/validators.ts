import { z } from "zod";

import type { StructuredValidationIssue } from "@/lib/llm/structured-output";
import {
  actingDirectionSchema,
  characterAnalysisSchema,
  cinematographySchema,
  clipSegmentationSchema,
  continuityReviewSchema,
  locationPropAnalysisSchema,
  screenplayConversionSchema,
  storyboardPlanningSchema,
  storyboardRefinementSchema,
  voiceAnalysisSchema,
} from "./schemas";

type CharacterAnalysis = z.infer<typeof characterAnalysisSchema>;
type LocationPropAnalysis = z.infer<typeof locationPropAnalysisSchema>;
type ClipSegmentation = z.infer<typeof clipSegmentationSchema>;
type ScreenplayConversion = z.infer<typeof screenplayConversionSchema>;
type StoryboardPlanning = z.infer<typeof storyboardPlanningSchema>;
type Cinematography = z.infer<typeof cinematographySchema>;
type ActingDirection = z.infer<typeof actingDirectionSchema>;
type StoryboardRefinement = z.infer<typeof storyboardRefinementSchema>;
type VoiceAnalysis = z.infer<typeof voiceAnalysisSchema>;
type ContinuityReview = z.infer<typeof continuityReviewSchema>;

type CanonicalContext = {
  characters: readonly string[];
  locations: readonly string[];
  props: readonly string[];
};

export function validateCharacterAnalysis(
  data: CharacterAnalysis,
  sourceText: string,
) {
  const issues: StructuredValidationIssue[] = [];
  validateUniqueNames(
    data.characters.map((item) => item.name),
    "characters",
    issues,
  );
  data.characters.forEach((character, index) =>
    validateEvidence(
      character.evidence,
      sourceText,
      `characters.${index}.evidence`,
      issues,
    ),
  );
  return issues;
}

export function validateLocationPropAnalysis(
  data: LocationPropAnalysis,
  sourceText: string,
) {
  const issues: StructuredValidationIssue[] = [];
  validateUniqueNames(
    data.locations.map((item) => item.name),
    "locations",
    issues,
  );
  validateUniqueNames(
    data.props.map((item) => item.name),
    "props",
    issues,
  );
  data.locations.forEach((location, index) =>
    validateEvidence(
      location.evidence,
      sourceText,
      `locations.${index}.evidence`,
      issues,
    ),
  );
  data.props.forEach((prop, index) =>
    validateEvidence(
      prop.evidence,
      sourceText,
      `props.${index}.evidence`,
      issues,
    ),
  );
  return issues;
}

export function validateClipSegmentation(
  data: ClipSegmentation,
  input: { sourceText: string; canonical: CanonicalContext },
) {
  const issues: StructuredValidationIssue[] = [];
  if (data.clips.map((clip) => clip.text).join("") !== input.sourceText)
    issues.push(
      issue(
        "clips",
        "SOURCE_COVERAGE_MISMATCH",
        "Concatenated clip text must reproduce the complete source exactly",
      ),
    );
  data.clips.forEach((clip, index) => {
    if (!clip.text.startsWith(clip.start))
      issues.push(
        issue(
          `clips.${index}.start`,
          "CLIP_START_MISMATCH",
          "start must be the exact opening excerpt of text",
        ),
      );
    if (!clip.text.endsWith(clip.end))
      issues.push(
        issue(
          `clips.${index}.end`,
          "CLIP_END_MISMATCH",
          "end must be the exact closing excerpt of text",
        ),
      );
    validateCanonicalNames(
      clip.characters,
      input.canonical.characters,
      `clips.${index}.characters`,
      issues,
    );
    validateCanonicalNames(
      clip.props,
      input.canonical.props,
      `clips.${index}.props`,
      issues,
    );
    if (
      clip.location !== null &&
      !nameSet(input.canonical.locations).has(normalizeName(clip.location))
    )
      issues.push(
        issue(
          `clips.${index}.location`,
          "UNKNOWN_LOCATION",
          `Unknown canonical location: ${clip.location}`,
        ),
      );
  });
  return issues;
}

export function validateScreenplayConversion(
  data: ScreenplayConversion,
  input: {
    clipId: string;
    clipText: string;
    canonical: CanonicalContext;
  },
) {
  const issues: StructuredValidationIssue[] = [];
  if (data.clipId !== input.clipId)
    issues.push(issue("clipId", "CLIP_ID_CHANGED", "clipId must be unchanged"));
  if (data.originalText !== input.clipText)
    issues.push(
      issue(
        "originalText",
        "ORIGINAL_TEXT_CHANGED",
        "originalText must exactly equal the complete clip source",
      ),
    );
  data.scenes.forEach((scene, sceneIndex) => {
    if (scene.sceneNumber !== sceneIndex)
      issues.push(
        issue(
          `scenes.${sceneIndex}.sceneNumber`,
          "SCENE_NUMBER_NOT_SEQUENTIAL",
          `Expected sceneNumber ${sceneIndex}, received ${scene.sceneNumber}`,
        ),
      );
    validateCanonicalNames(
      scene.characters,
      input.canonical.characters,
      `scenes.${sceneIndex}.characters`,
      issues,
    );
    if (
      input.canonical.locations.length &&
      !nameSet(input.canonical.locations).has(normalizeName(scene.heading.location))
    )
      issues.push(
        issue(
          `scenes.${sceneIndex}.heading.location`,
          "UNKNOWN_LOCATION",
          `Unknown canonical location: ${scene.heading.location}`,
        ),
      );
    scene.content.forEach((content, contentIndex) => {
      const value =
        content.type === "dialogue" ? content.lines : content.text;
      const isGrounded =
        content.type === "action"
          ? isOrderedActionExcerpt(value, input.clipText)
          : !value || input.clipText.includes(value);
      if (!isGrounded)
        issues.push(
          issue(
            `scenes.${sceneIndex}.content.${contentIndex}`,
            content.type === "action"
              ? "ACTION_NOT_IN_SOURCE"
              : "SPOKEN_TEXT_NOT_IN_SOURCE",
            content.type === "action"
              ? "Action must consist of ordered source excerpts; punctuation may differ"
              : "Spoken content must be an exact source excerpt",
          ),
        );
      if (
        content.type === "dialogue" &&
        !isDirectSpeechExcerpt(content.lines, content.character, input.clipText)
      )
        issues.push(
          issue(
            `scenes.${sceneIndex}.content.${contentIndex}.lines`,
            "DIALOGUE_NOT_DIRECT_SPEECH",
            "Dialogue must be a direct utterance attributed to its listed speaker, not narration or unspoken thought",
          ),
        );
      if (
        content.type !== "action" &&
        content.character &&
        !nameSet(input.canonical.characters).has(
          normalizeName(content.character),
        )
      )
        issues.push(
          issue(
            `scenes.${sceneIndex}.content.${contentIndex}.character`,
            "UNKNOWN_SPEAKER",
            `Unknown canonical speaker: ${content.character}`,
          ),
        );
    });
  });
  return issues;
}

function isOrderedActionExcerpt(value: string, sourceText: string) {
  if (!value || sourceText.includes(value)) return true;
  const normalizedSource = normalizeActionText(sourceText);
  const fragments = value
    .split(/[。！？!?；;]+/u)
    .map(normalizeActionText)
    .filter(Boolean);
  if (!fragments.length) return false;
  let cursor = 0;
  for (const fragment of fragments) {
    const index = normalizedSource.indexOf(fragment, cursor);
    if (index < 0) return false;
    cursor = index + fragment.length;
  }
  return true;
}

function normalizeActionText(value: string) {
  return value.replace(/[\p{P}\p{S}\s]/gu, "");
}

export function validateStoryboardPlanning(
  data: StoryboardPlanning,
  input: { sourceText: string; canonical: CanonicalContext },
) {
  const issues = validateSequentialPanelIndices(data.panels, "panels");
  data.panels.forEach((panel, index) => {
    validateMotionTimeline(panel, `panels.${index}`, issues);
    validateEvidence(
      panel.sourceEvidence,
      input.sourceText,
      `panels.${index}.sourceEvidence`,
      issues,
    );
    validateCanonicalNames(
      panel.characters,
      input.canonical.characters,
      `panels.${index}.characters`,
      issues,
    );
    validateCanonicalNames(
      panel.props,
      input.canonical.props,
      `panels.${index}.props`,
      issues,
    );
    if (
      panel.locationName &&
      !nameSet(input.canonical.locations).has(normalizeName(panel.locationName))
    )
      issues.push(
        issue(
          `panels.${index}.locationName`,
          "UNKNOWN_LOCATION",
          `Unknown canonical location: ${panel.locationName}`,
        ),
      );
  });
  return issues;
}

export function validateCinematographyCoverage(
  data: Cinematography,
  expectedPanelIndices: readonly number[],
) {
  return validateExactPanelCoverage(
    data.rules.map((rule) => rule.panelIndex),
    expectedPanelIndices,
    "rules",
  );
}

export function validateActingCoverage(
  data: ActingDirection,
  panels: ReadonlyArray<{ panelIndex: number; characters: readonly string[] }>,
) {
  const issues = validateExactPanelCoverage(
    data.directions.map((direction) => direction.panelIndex),
    panels.map((panel) => panel.panelIndex),
    "directions",
  );
  const directionByPanel = new Map(
    data.directions.map((direction) => [direction.panelIndex, direction]),
  );
  for (const panel of panels) {
    const direction = directionByPanel.get(panel.panelIndex);
    if (!direction) continue;
    validateExactNames(
      direction.characters.map((character) => character.name),
      panel.characters,
      `directions.panel_${panel.panelIndex}.characters`,
      issues,
    );
  }
  return issues;
}

export function validateStoryboardRefinement(
  data: StoryboardRefinement,
  basePanels: StoryboardPlanning["panels"],
) {
  const issues = validateExactPanelCoverage(
    data.panels.map((panel) => panel.panelIndex),
    basePanels.map((panel) => panel.panelIndex),
    "panels",
  );
  const refinedByIndex = new Map(
    data.panels.map((panel) => [panel.panelIndex, panel]),
  );
  for (const base of basePanels) {
    const refined = refinedByIndex.get(base.panelIndex);
    if (!refined) continue;
    validateMotionTimeline(
      refined,
      `panels.panel_${base.panelIndex}`,
      issues,
    );
    if (refined.shotType !== base.shotType)
      issues.push(
        issue(
          `panels.panel_${base.panelIndex}.shotType`,
          "SHOT_TYPE_CHANGED",
          "Refinement must preserve the planned shot type",
        ),
      );
    if (refined.cameraMove !== base.cameraMove)
      issues.push(
        issue(
          `panels.panel_${base.panelIndex}.cameraMove`,
          "CAMERA_MOVE_CHANGED",
          "Refinement must preserve the planned camera move",
        ),
      );
    if (refined.durationSeconds !== base.durationSeconds)
      issues.push(
        issue(
          `panels.panel_${base.panelIndex}.durationSeconds`,
          "SHOT_DURATION_CHANGED",
          "Refinement must preserve the planned shot duration",
        ),
      );
    if (!sameTimelineBoundaries(refined.motionTimeline, base.motionTimeline))
      issues.push(
        issue(
          `panels.panel_${base.panelIndex}.motionTimeline`,
          "MOTION_TIMELINE_BOUNDARIES_CHANGED",
          "Refinement may enrich each beat but must preserve every planned second boundary",
        ),
      );
    validateExactNames(
      refined.characters,
      base.characters,
      `panels.panel_${base.panelIndex}.characters`,
      issues,
    );
    validateExactNames(
      refined.props,
      base.props,
      `panels.panel_${base.panelIndex}.props`,
      issues,
    );
    if (refined.locationName !== base.locationName)
      issues.push(
        issue(
          `panels.panel_${base.panelIndex}.locationName`,
          "LOCATION_CHANGED",
          "Refinement must preserve the base location",
        ),
      );
    validateExactValues(
      refined.sourceEvidence,
      base.sourceEvidence,
      `panels.panel_${base.panelIndex}.sourceEvidence`,
      issues,
    );
  }
  return issues;
}

function validateMotionTimeline(
  panel: StoryboardPlanning["panels"][number],
  path: string,
  issues: StructuredValidationIssue[],
) {
  if (panel.motionTimeline.length !== panel.durationSeconds)
    issues.push(
      issue(
        `${path}.motionTimeline`,
        "MOTION_TIMELINE_SECOND_COUNT_MISMATCH",
        "motionTimeline must contain exactly one beat for every second of the shot",
      ),
    );
  panel.motionTimeline.forEach((beat, beatIndex) => {
    if (beat.startSecond !== beatIndex || beat.endSecond !== beatIndex + 1)
      issues.push(
        issue(
          `${path}.motionTimeline.${beatIndex}`,
          "MOTION_TIMELINE_NOT_CONTIGUOUS",
          `Expected a continuous ${beatIndex}-${beatIndex + 1}s beat`,
        ),
      );
  });
  const finalBeat = panel.motionTimeline.at(-1);
  if (finalBeat?.endSecond !== panel.durationSeconds)
    issues.push(
      issue(
        `${path}.motionTimeline`,
        "MOTION_TIMELINE_DURATION_MISMATCH",
        "The final motion beat must end at durationSeconds",
      ),
    );
}

function sameTimelineBoundaries(
  left: StoryboardPlanning["panels"][number]["motionTimeline"],
  right: StoryboardPlanning["panels"][number]["motionTimeline"],
) {
  return (
    left.length === right.length &&
    left.every(
      (beat, index) =>
        beat.startSecond === right[index]?.startSecond &&
        beat.endSecond === right[index]?.endSecond,
    )
  );
}

export function validateVoiceAnalysis(
  data: VoiceAnalysis,
  input: {
    sourceText: string;
    characters: readonly string[];
    panelIndices: readonly number[];
  },
) {
  const issues: StructuredValidationIssue[] = [];
  const speakers = nameSet([...input.characters, "旁白", "Narrator"]);
  const panelIndices = new Set(input.panelIndices);
  let previousPanelIndex = -1;
  data.lines.forEach((line, index) => {
    if (!input.sourceText.includes(line.content))
      issues.push(
        issue(
          `lines.${index}.content`,
          "VOICE_CONTENT_NOT_IN_SOURCE",
          "Voice content must be an exact source excerpt",
        ),
      );
    if (
      line.delivery === "dialogue" &&
      line.speaker !== "旁白" &&
      line.speaker !== "Narrator" &&
      !isDirectSpeechExcerpt(line.content, line.speaker, input.sourceText)
    )
      issues.push(
        issue(
          `lines.${index}.content`,
          "VOICE_NOT_DIRECT_SPEECH",
          "Voice lines must be direct speech, not narration or unspoken thought",
        ),
      );
    if (!speakers.has(normalizeName(line.speaker)))
      issues.push(
        issue(
          `lines.${index}.speaker`,
          "UNKNOWN_SPEAKER",
          `Unknown canonical speaker: ${line.speaker}`,
        ),
      );
    if (
      line.matchedPanelIndex !== null &&
      !panelIndices.has(line.matchedPanelIndex)
    )
      issues.push(
        issue(
          `lines.${index}.matchedPanelIndex`,
          "UNKNOWN_PANEL",
          `Unknown panel index: ${line.matchedPanelIndex}`,
        ),
      );
    if (
      line.matchedPanelIndex !== null &&
      line.matchedPanelIndex < previousPanelIndex
    )
      issues.push(
        issue(
          `lines.${index}.matchedPanelIndex`,
          "PANEL_ORDER_REGRESSION",
          "Matched panel indices must not move backward in dialogue order",
        ),
      );
    if (line.matchedPanelIndex !== null)
      previousPanelIndex = line.matchedPanelIndex;
  });
  return issues;
}

export function isDirectSpeechExcerpt(
  content: string,
  speaker: string,
  sourceText: string,
) {
  const escapedContent = escapeRegex(content.trim());
  if (!escapedContent) return false;
  const quoted = new RegExp(`[“\\"]${escapedContent}[”\\"]`);
  if (quoted.test(sourceText)) return true;

  const escapedSpeaker = escapeRegex(speaker.trim());
  if (!escapedSpeaker) return false;
  const speechVerb =
    "说(?:道)?|问(?:道)?|答(?:道)?|回答|回应|喊(?:道)?|叫(?:道)?|喝(?:道)?|叹(?:道)?|笑(?:道)?|开口|低声(?:说)?|轻声(?:说)?|安慰|劝(?:说|慰)?|安抚|鼓励";
  return new RegExp(
    `${escapedSpeaker}[^。！？!?“”\\"]{0,32}(?:${speechVerb})[^。！？!?“”\\"]{0,24}[：:，,]\\s*${escapedContent}`,
  ).test(sourceText);
}

export function validateContinuityReview(
  data: ContinuityReview,
  input: { panelIndices: readonly number[]; canonical: CanonicalContext },
) {
  const issues: StructuredValidationIssue[] = [];
  const panelIndices = new Set(input.panelIndices);
  const entities = new Map([
    ["character", nameSet(input.canonical.characters)],
    ["location", nameSet(input.canonical.locations)],
    ["prop", nameSet(input.canonical.props)],
  ]);
  data.issues.forEach((item, index) => {
    if (item.panelIndex !== null && !panelIndices.has(item.panelIndex))
      issues.push(
        issue(
          `issues.${index}.panelIndex`,
          "UNKNOWN_PANEL",
          `Unknown panel index: ${item.panelIndex}`,
        ),
      );
    const names = item.entityType ? entities.get(item.entityType) : undefined;
    if (names && item.entityName && !names.has(normalizeName(item.entityName)))
      issues.push(
        issue(
          `issues.${index}.entityName`,
          "UNKNOWN_ENTITY",
          `Unknown canonical ${item.entityType}: ${item.entityName}`,
        ),
      );
  });
  return issues;
}

function validateEvidence(
  quotes: readonly string[],
  sourceText: string,
  path: string,
  issues: StructuredValidationIssue[],
) {
  quotes.forEach((quote, index) => {
    if (!sourceText.includes(quote))
      issues.push(
        issue(
          `${path}.${index}`,
          "EVIDENCE_NOT_IN_SOURCE",
          "Evidence must be an exact unchanged source excerpt",
        ),
      );
  });
}

function validateSequentialPanelIndices(
  rows: ReadonlyArray<{ panelIndex: number }>,
  path: string,
) {
  const issues: StructuredValidationIssue[] = [];
  rows.forEach((row, index) => {
    if (row.panelIndex !== index)
      issues.push(
        issue(
          `${path}.${index}.panelIndex`,
          "PANEL_INDEX_NOT_SEQUENTIAL",
          `Expected panelIndex ${index}, received ${row.panelIndex}`,
        ),
      );
  });
  return issues;
}

function validateExactPanelCoverage(
  actual: readonly number[],
  expected: readonly number[],
  path: string,
) {
  const issues: StructuredValidationIssue[] = [];
  const actualCounts = counts(actual);
  for (const panelIndex of expected) {
    const count = actualCounts.get(panelIndex) ?? 0;
    if (count !== 1)
      issues.push(
        issue(
          path,
          count === 0 ? "PANEL_OUTPUT_MISSING" : "PANEL_OUTPUT_DUPLICATE",
          `Expected exactly one output for panelIndex ${panelIndex}, received ${count}`,
        ),
      );
  }
  const expectedSet = new Set(expected);
  for (const panelIndex of actualCounts.keys())
    if (!expectedSet.has(panelIndex))
      issues.push(
        issue(
          path,
          "UNKNOWN_PANEL",
          `Output references unknown panelIndex ${panelIndex}`,
        ),
      );
  return issues;
}

function validateCanonicalNames(
  actual: readonly string[],
  canonical: readonly string[],
  path: string,
  issues: StructuredValidationIssue[],
) {
  const allowed = nameSet(canonical);
  const seen = new Set<string>();
  for (const value of actual) {
    const normalized = normalizeName(value);
    if (!allowed.has(normalized))
      issues.push(
        issue(path, "UNKNOWN_CANONICAL_NAME", `Unknown canonical name: ${value}`),
      );
    if (seen.has(normalized))
      issues.push(issue(path, "DUPLICATE_NAME", `Duplicate name: ${value}`));
    seen.add(normalized);
  }
}

function validateExactNames(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
  issues: StructuredValidationIssue[],
) {
  const actualCounts = stringCounts(actual);
  const expectedCounts = stringCounts(expected);
  const names = new Set([...actualCounts.keys(), ...expectedCounts.keys()]);
  for (const name of names) {
    const actualCount = actualCounts.get(name) ?? 0;
    const expectedCount = expectedCounts.get(name) ?? 0;
    if (actualCount !== expectedCount)
      issues.push(
        issue(
          path,
          actualCount < expectedCount
            ? "ENTITY_OUTPUT_MISSING"
            : expectedCount === 0
              ? "UNKNOWN_ENTITY"
              : "DUPLICATE_ENTITY",
          `Expected ${expectedCount} occurrence(s) of ${name}, received ${actualCount}`,
        ),
      );
  }
}

function validateExactValues(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
  issues: StructuredValidationIssue[],
) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  )
    issues.push(
      issue(
        path,
        "SOURCE_EVIDENCE_CHANGED",
        "Refinement must preserve source evidence exactly and in order",
      ),
    );
}

function validateUniqueNames(
  values: readonly string[],
  path: string,
  issues: StructuredValidationIssue[],
) {
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeName(value);
    if (seen.has(normalized))
      issues.push(issue(path, "DUPLICATE_CANONICAL_NAME", value));
    seen.add(normalized);
  }
}

function nameSet(values: readonly string[]) {
  return new Set(values.map(normalizeName));
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function counts(values: readonly number[]) {
  const result = new Map<number, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function stringCounts(values: readonly string[]) {
  const result = new Map<string, number>();
  for (const value of values) {
    const normalized = normalizeName(value);
    result.set(normalized, (result.get(normalized) ?? 0) + 1);
  }
  return result;
}

function issue(path: string, code: string, message: string) {
  return { path, code, message } satisfies StructuredValidationIssue;
}
