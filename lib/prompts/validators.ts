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

type ScreenplaySourceContract = {
  clipId: string;
  clipText: string;
  sourceEvents?: readonly SourceEvent[];
  knowledgeText?: string;
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
  input: {
    sourceUnits: readonly { id: string; text: string }[];
    canonical: CanonicalContext;
  },
) {
  const issues: StructuredValidationIssue[] = [];
  const unitIndexes = new Map(
    input.sourceUnits.map((unit, index) => [unit.id, index]),
  );
  let previousEndIndex = -1;
  data.clips.forEach((clip, index) => {
    const endIndex = unitIndexes.get(clip.endUnitId);
    if (endIndex === undefined)
      issues.push(
        issue(
          `clips.${index}.endUnitId`,
          "CLIP_BOUNDARY_UNKNOWN",
          `Unknown source unit boundary: ${clip.endUnitId}`,
        ),
      );
    else if (endIndex <= previousEndIndex)
      issues.push(
        issue(
          `clips.${index}.endUnitId`,
          "CLIP_BOUNDARY_NOT_SEQUENTIAL",
          "Clip boundaries must advance through source units in order",
        ),
      );
    else previousEndIndex = endIndex;
  });
  const expectedLastUnitId = input.sourceUnits.at(-1)?.id;
  if (data.clips.at(-1)?.endUnitId !== expectedLastUnitId)
    issues.push(
      issue(
        "clips.last.endUnitId",
        "SOURCE_COVERAGE_MISMATCH",
        "The final clip boundary must include the final source unit",
      ),
    );
  data.clips.forEach((clip, index) => {
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
    sourceEvents?: readonly SourceEvent[];
    knowledgeText?: string;
  },
) {
  const issues: StructuredValidationIssue[] = [];
  const sourceBackedSpeakers = nameSet(
    data.scenes.flatMap((scene) =>
      scene.content.flatMap((content) =>
        content.type === "dialogue" &&
        isSourceBackedTemporarySpeaker(
          content.lines,
          content.character,
          input.clipText,
        )
          ? [content.character]
          : [],
      ),
    ),
  );
  const allowedCharacters = [
    ...input.canonical.characters,
    ...sourceBackedSpeakers,
  ];
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
  if (input.sourceEvents)
    validateSourceEventCoverage(data, input.sourceEvents, issues);
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
      allowedCharacters,
      `scenes.${sceneIndex}.characters`,
      issues,
    );
    if (
      input.canonical.locations.length &&
      !nameSet(input.canonical.locations).has(
        normalizeName(scene.heading.location),
      ) &&
      !input.clipText.includes(scene.heading.location)
    )
      issues.push(
        issue(
          `scenes.${sceneIndex}.heading.location`,
          "UNKNOWN_LOCATION",
          `Unknown canonical location: ${scene.heading.location}`,
        ),
      );
    scene.content.forEach((content, contentIndex) => {
      const value = content.type === "dialogue" ? content.lines : content.text;
      const isGrounded =
        content.type === "action"
          ? content.origin === "bridge" || content.origin === "inferred"
            ? isGroundedInferredAction(content, input.clipText)
            : isOrderedActionExcerpt(value, input.clipText) ||
              isImplicitVisualBridgeAction(value, input.clipText)
          : !value || input.clipText.includes(value);
      if (!isGrounded)
        issues.push(
          issue(
            `scenes.${sceneIndex}.content.${contentIndex}`,
            content.type === "action"
              ? content.origin === "bridge" || content.origin === "inferred"
                ? "INFERRED_ACTION_NOT_GROUNDED"
                : "ACTION_NOT_IN_SOURCE"
              : "SPOKEN_TEXT_NOT_IN_SOURCE",
            content.type === "action"
              ? content.origin === "bridge" || content.origin === "inferred"
                ? "A bridge or inferred action must cite exact source evidence and cannot introduce spoken dialogue"
                : "Action must consist of ordered source excerpts; punctuation may differ"
              : "Spoken content must be an exact source excerpt",
          ),
        );
      if (content.type === "action")
        validateActionProvenance(
          content,
          input.clipText,
          `scenes.${sceneIndex}.content.${contentIndex}`,
          issues,
        );
      if (content.type === "action" && content.actionDesign)
        validateActionDesign(
          content.actionDesign,
          `${input.clipText}\n${input.knowledgeText ?? ""}`,
          `scenes.${sceneIndex}.content.${contentIndex}.actionDesign`,
          issues,
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
        !nameSet(input.canonical.characters).has(normalizeName(content.character)) &&
        !(
          content.type === "dialogue" &&
          sourceBackedSpeakers.has(normalizeName(content.character))
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

export function normalizeScreenplaySourceContract(
  data: ScreenplayConversion,
  input: ScreenplaySourceContract,
): ScreenplayConversion {
  const expectedEvidence = new Map(
    (input.sourceEvents ?? buildSourceEvents(input.clipText)).map((event) => [
      event.eventId,
      event.evidence,
    ]),
  );
  const groundedKnowledge = `${input.clipText}\n${input.knowledgeText ?? ""}`;
  return {
    ...data,
    clipId: input.clipId,
    originalText: input.clipText,
    coverage: data.coverage?.map((item) => ({
      ...item,
      evidence: expectedEvidence.get(item.eventId) ?? item.evidence,
    })),
    scenes: data.scenes.map((scene) => {
      const content = scene.content.flatMap((item) => {
        if (
          item.type === "action" &&
          (item.origin === "bridge" || item.origin === "inferred") &&
          !isGroundedInferredAction(item, input.clipText)
        ) {
          const sourceEvidence = item.evidence?.find((quote) =>
            input.clipText.includes(quote),
          );
          return sourceEvidence
            ? [{ type: "action" as const, text: sourceEvidence, origin: "source" as const }]
            : [];
        }
        if (item.type !== "action" || !item.actionDesign) return [item];
        const actionDesign = item.actionDesign;
        return [
          {
            ...item,
            actionDesign: {
              ...actionDesign,
              realm: isGroundedProductionTerm(
                actionDesign.realm,
                groundedKnowledge,
              )
                ? actionDesign.realm
                : null,
              technique: isGroundedProductionTerm(
                actionDesign.technique,
                groundedKnowledge,
              )
                ? actionDesign.technique
                : null,
            },
          },
        ];
      });
      return {
        ...scene,
        content:
          content.length > 0
            ? content
            : [{ type: "action" as const, text: input.clipText, origin: "source" as const }],
      };
    }),
  };
}

function isGroundedProductionTerm(
  value: string | null | undefined,
  knowledgeText: string,
) {
  return (
    !value ||
    normalizeActionText(knowledgeText).includes(normalizeActionText(value))
  );
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

function isGroundedInferredAction(
  content: Extract<
    ScreenplayConversion["scenes"][number]["content"][number],
    { type: "action" }
  >,
  sourceText: string,
) {
  const evidence = content.evidence ?? [];
  if (
    !evidence.length ||
    !evidence.every((quote) => sourceText.includes(quote))
  )
    return false;
  // Connecting actions are visual only. Dialogue belongs to the source as dialogue/voiceover.
  return (
    !/[“”"][^“”"]+[“”"]/.test(content.text) &&
    !/(?:说|问|答|回应|喊|叫|开口|低声|轻声)[：:]/.test(content.text)
  );
}

function validateActionProvenance(
  content: Extract<
    ScreenplayConversion["scenes"][number]["content"][number],
    { type: "action" }
  >,
  sourceText: string,
  path: string,
  issues: StructuredValidationIssue[],
) {
  const hasInferenceMetadata =
    content.inferenceType !== undefined ||
    content.rationale !== undefined ||
    content.confidence !== undefined;
  if (content.origin === "inferred") {
    if (
      !content.inferenceType ||
      !content.rationale ||
      content.confidence === undefined ||
      !content.evidence?.length
    )
      issues.push(
        issue(
          path,
          "INFERENCE_PROVENANCE_INCOMPLETE",
          "Inferred actions require inferenceType, exact evidence, rationale, and confidence",
        ),
      );
    if (
      content.inferenceType === "production_detail" &&
      (content.confidence ?? 0) > 0.75
    )
      issues.push(
        issue(
          `${path}.confidence`,
          "PRODUCTION_DETAIL_CONFIDENCE_TOO_HIGH",
          "Implied set or wardrobe details must remain explicitly lower-confidence",
        ),
      );
  } else if (hasInferenceMetadata) {
    issues.push(
      issue(
        path,
        "INFERENCE_METADATA_ON_NON_INFERRED_ACTION",
        "Inference metadata is only valid when origin is inferred",
      ),
    );
  }
  if (content.evidence)
    validateEvidence(content.evidence, sourceText, `${path}.evidence`, issues);
}

function validateActionDesign(
  design: NonNullable<
    Extract<
      ScreenplayConversion["scenes"][number]["content"][number],
      { type: "action" }
    >["actionDesign"]
  >,
  knowledgeText: string,
  path: string,
  issues: StructuredValidationIssue[],
) {
  validateEvidence(design.evidence, knowledgeText, `${path}.evidence`, issues);
  for (const [key, value] of [
    ["realm", design.realm],
    ["technique", design.technique],
  ] as const) {
    if (
      value &&
      !normalizeActionText(knowledgeText).includes(normalizeActionText(value))
    )
      issues.push(
        issue(
          `${path}.${key}`,
          "ACTION_DESIGN_TERM_NOT_GROUNDED",
          `${key} must appear in the source or approved world/power-system reference`,
        ),
      );
  }
}

export type SourceEvent = { eventId: string; evidence: string };

export function buildSourceEvents(sourceText: string): SourceEvent[] {
  const fragments = sourceText
    .split(/(?<=[。！？!?；;\n])/u)
    .map((value) => value.trim())
    .filter(Boolean);
  return (fragments.length ? fragments : [sourceText]).map(
    (evidence, index) => ({
      eventId: `E${String(index + 1).padStart(3, "0")}`,
      evidence,
    }),
  );
}

function validateSourceEventCoverage(
  data: ScreenplayConversion,
  sourceEvents: readonly SourceEvent[],
  issues: StructuredValidationIssue[],
) {
  const coverage = data.coverage ?? [];
  const byId = new Map(coverage.map((item) => [item.eventId, item]));
  for (const event of sourceEvents) {
    const item = byId.get(event.eventId);
    if (!item) {
      issues.push(
        issue(
          "coverage",
          "SOURCE_EVENT_MISSING",
          `Source event ${event.eventId} is not accounted for`,
        ),
      );
      continue;
    }
    if (item.evidence !== event.evidence)
      issues.push(
        issue(
          `coverage.${event.eventId}.evidence`,
          "SOURCE_EVENT_EVIDENCE_CHANGED",
          `Coverage evidence for ${event.eventId} must remain exact`,
        ),
      );
    if (item.modes.includes("omitted") && !item.reason)
      issues.push(
        issue(
          `coverage.${event.eventId}.reason`,
          "OMISSION_REASON_REQUIRED",
          "An omitted source event requires a reason",
        ),
      );
    if (item.modes.includes("omitted") && item.modes.length > 1)
      issues.push(
        issue(
          `coverage.${event.eventId}.modes`,
          "OMISSION_MODE_CONFLICT",
          "omitted cannot be combined with a covered mode",
        ),
      );
  }
  const expected = new Set(sourceEvents.map((event) => event.eventId));
  coverage.forEach((item, index) => {
    if (!expected.has(item.eventId))
      issues.push(
        issue(
          `coverage.${index}.eventId`,
          "UNKNOWN_SOURCE_EVENT",
          `Unknown source event ${item.eventId}`,
        ),
      );
    if (coverage.findIndex((value) => value.eventId === item.eventId) !== index)
      issues.push(
        issue(
          `coverage.${index}.eventId`,
          "DUPLICATE_SOURCE_EVENT",
          `Source event ${item.eventId} appears more than once`,
        ),
      );
  });
}

function normalizeActionText(value: string) {
  return value.replace(/[\p{P}\p{S}\s]/gu, "");
}

export function validateStoryboardPlanning(
  data: StoryboardPlanning,
  input: {
    sourceText: string;
    canonical: CanonicalContext;
    screenplay?: ScreenplayConversion;
    productionContextText?: string;
  },
) {
  const issues = validateSequentialPanelIndices(data.panels, "panels");
  const screenplayCharacters = nameSet(
    input.screenplay?.scenes.flatMap((scene) => [
      ...scene.characters,
      ...scene.content.flatMap((content) =>
        content.type !== "action" && content.character
          ? [content.character]
          : [],
      ),
    ]) ?? [],
  );
  const allowedCharacters = [
    ...input.canonical.characters,
    ...screenplayCharacters,
  ];
  const screenplayLocations = nameSet(
    input.screenplay?.scenes.map((scene) => scene.heading.location) ?? [],
  );
  data.panels.forEach((panel, index) => {
    validateMotionTimeline(panel, `panels.${index}`, issues);
    validateProductionCues(
      panel,
      `${input.sourceText}\n${input.productionContextText ?? ""}`,
      `panels.${index}`,
      issues,
    );
    validateEvidence(
      panel.sourceEvidence,
      input.sourceText,
      `panels.${index}.sourceEvidence`,
      issues,
    );
    validateCanonicalNames(
      panel.characters,
      allowedCharacters,
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
      !nameSet(input.canonical.locations).has(normalizeName(panel.locationName)) &&
      !screenplayLocations.has(normalizeName(panel.locationName))
    )
      issues.push(
        issue(
          `panels.${index}.locationName`,
          "UNKNOWN_LOCATION",
          `Unknown canonical location: ${panel.locationName}`,
        ),
      );
    if (panel.speakingCharacter) {
      if (
        !nameSet(allowedCharacters).has(normalizeName(panel.speakingCharacter))
      )
        issues.push(
          issue(
            `panels.${index}.speakingCharacter`,
            "UNKNOWN_SPEAKING_CHARACTER",
            `Unknown canonical speaking character: ${panel.speakingCharacter}`,
          ),
        );
      if (
        !nameSet(panel.characters).has(normalizeName(panel.speakingCharacter))
      )
        issues.push(
          issue(
            `panels.${index}.speakingCharacter`,
            "SPEAKER_NOT_IN_SHOT",
            "The active speaking character must appear in the shot",
          ),
        );
    }
    if (panel.lipSyncText && !panel.speakingCharacter)
      issues.push(
        issue(
          `panels.${index}.lipSyncText`,
          "LIP_SYNC_SPEAKER_REQUIRED",
          "Lip-sync text requires exactly one active speaking character",
        ),
      );
    if (panel.speakingCharacter && !panel.lipSyncText)
      issues.push(
        issue(
          `panels.${index}.speakingCharacter`,
          "SPEAKER_TEXT_REQUIRED",
          "An active speaking character requires lip-sync text",
        ),
      );
    if (panel.lipSyncText && panel.voiceoverText)
      issues.push(
        issue(
          `panels.${index}`,
          "MULTIPLE_VOICE_PERFORMANCES_IN_SHOT",
          "A shot may contain one lip-sync performance or one voice-over, not both",
        ),
      );
    const spokenText = panel.lipSyncText ?? panel.voiceoverText;
    if (
      spokenText &&
      panel.durationSeconds < estimateSpeechDurationSeconds(spokenText)
    )
      issues.push(
        issue(
          `panels.${index}.durationSeconds`,
          "DIALOGUE_DURATION_OVERFLOW",
          `Shot needs at least ${estimateSpeechDurationSeconds(spokenText)} seconds for its spoken text`,
        ),
      );
  });
  if (input.screenplay)
    validateStoryboardScreenplayContract(data, input.screenplay, issues);
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
    validateMotionTimeline(refined, `panels.panel_${base.panelIndex}`, issues);
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
    for (const field of [
      "sceneNumber",
      "speakingCharacter",
      "lipSyncText",
      "voiceoverText",
    ] as const)
      if (refined[field] !== base[field])
        issues.push(
          issue(
            `panels.panel_${base.panelIndex}.${field}`,
            "PLANNED_FIELD_CHANGED",
            `Refinement must preserve ${field}`,
          ),
        );
    if (JSON.stringify(refined.startState) !== JSON.stringify(base.startState))
      issues.push(
        issue(
          `panels.panel_${base.panelIndex}.startState`,
          "START_STATE_CHANGED",
          "Refinement must preserve the planned start state",
        ),
      );
    if (JSON.stringify(refined.endState) !== JSON.stringify(base.endState))
      issues.push(
        issue(
          `panels.panel_${base.panelIndex}.endState`,
          "END_STATE_CHANGED",
          "Refinement must preserve the planned end state",
        ),
      );
    for (const field of ["worldContext", "vfxCues", "sfxCues"] as const)
      if (JSON.stringify(refined[field]) !== JSON.stringify(base[field]))
        issues.push(
          issue(
            `panels.panel_${base.panelIndex}.${field}`,
            "PRODUCTION_CUES_CHANGED",
            `Refinement must preserve ${field}`,
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
  panel.motionTimeline.forEach((beat, beatIndex) => {
    const expectedStart = panel.motionTimeline[beatIndex - 1]?.endSecond ?? 0;
    if (
      beat.startSecond !== expectedStart ||
      beat.endSecond <= beat.startSecond ||
      beat.endSecond > panel.durationSeconds
    )
      issues.push(
        issue(
          `${path}.motionTimeline.${beatIndex}`,
          "MOTION_TIMELINE_NOT_CONTIGUOUS",
          `Expected a positive, continuous beat beginning at ${expectedStart}s`,
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

function validateProductionCues(
  panel: StoryboardPlanning["panels"][number],
  knowledgeText: string,
  path: string,
  issues: StructuredValidationIssue[],
) {
  const worldEvidence = panel.worldContext?.evidence;
  if (
    panel.worldContext &&
    Object.entries(panel.worldContext).some(
      ([key, value]) => key !== "evidence" && Boolean(value),
    ) &&
    !worldEvidence?.length
  )
    issues.push(
      issue(
        `${path}.worldContext.evidence`,
        "WORLD_CONTEXT_EVIDENCE_REQUIRED",
        "Realm, technique, power rules, and world-scale details require exact evidence from the screenplay or approved world reference",
      ),
    );
  if (worldEvidence)
    validateEvidence(
      worldEvidence,
      knowledgeText,
      `${path}.worldContext.evidence`,
      issues,
    );

  panel.vfxCues.forEach((cue, cueIndex) => {
    if (cue.atSecond > panel.durationSeconds)
      issues.push(
        issue(
          `${path}.vfxCues.${cueIndex}.atSecond`,
          "VFX_CUE_OUTSIDE_SHOT",
          "VFX cue time must fall within the shot duration",
        ),
      );
    validateEvidence(
      cue.evidence,
      knowledgeText,
      `${path}.vfxCues.${cueIndex}.evidence`,
      issues,
    );
  });
  panel.sfxCues.forEach((cue, cueIndex) => {
    if (
      cue.endSecond < cue.startSecond ||
      cue.endSecond > panel.durationSeconds
    )
      issues.push(
        issue(
          `${path}.sfxCues.${cueIndex}`,
          "SFX_CUE_OUTSIDE_SHOT",
          "SFX cue range must be ordered and remain within the shot duration",
        ),
      );
    validateEvidence(
      cue.evidence,
      knowledgeText,
      `${path}.sfxCues.${cueIndex}.evidence`,
      issues,
    );
  });
}

export function estimateSpeechDurationSeconds(value: string) {
  const cjk = Array.from(value).filter((character) =>
    /[\u3400-\u9fff\uf900-\ufaff]/u.test(character),
  ).length;
  const words = value
    .replace(/[\u3400-\u9fff\uf900-\ufaff]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const punctuationPauses = (value.match(/[，,。.!！？?；;：:…]/g) ?? [])
    .length;
  return Math.max(
    1,
    Math.ceil(cjk / 4.2 + words / 2.6 + punctuationPauses * 0.18),
  );
}

function validateStoryboardScreenplayContract(
  data: StoryboardPlanning,
  screenplay: ScreenplayConversion,
  issues: StructuredValidationIssue[],
) {
  const sceneNumbers = new Set(
    screenplay.scenes.map((scene) => scene.sceneNumber),
  );
  data.panels.forEach((panel, index) => {
    if (panel.sceneNumber === undefined || !sceneNumbers.has(panel.sceneNumber))
      issues.push(
        issue(
          `panels.${index}.sceneNumber`,
          "SCENE_NUMBER_REQUIRED",
          "Every generated panel must reference its screenplay scene",
        ),
      );
    if (!panel.startState || !panel.endState)
      issues.push(
        issue(
          `panels.${index}`,
          "CONTINUITY_STATE_REQUIRED",
          "Every generated panel requires explicit startState and endState",
        ),
      );
    const previous = data.panels[index - 1];
    if (
      previous?.sceneNumber === panel.sceneNumber &&
      previous.endState &&
      panel.startState &&
      (previous.endState.hands !== panel.startState.hands ||
        previous.endState.screenDirection !==
          panel.startState.screenDirection ||
        previous.endState.props !== panel.startState.props)
    )
      issues.push(
        issue(
          `panels.${index}.startState`,
          "ADJACENT_STATE_DISCONTINUITY",
          "Within one scene, hand occupancy, prop state, and screen direction must inherit the prior shot end state exactly",
        ),
      );
    if (
      previous?.sceneNumber !== undefined &&
      panel.sceneNumber !== undefined &&
      panel.sceneNumber < previous.sceneNumber
    )
      issues.push(
        issue(
          `panels.${index}.sceneNumber`,
          "SCENE_ORDER_REGRESSION",
          "Panel scene numbers must follow screenplay order",
        ),
      );
  });

  type SpokenItem = {
    delivery: "dialogue" | "voiceover";
    speaker: string;
    text: string;
  };
  const expected: SpokenItem[] = [];
  for (const scene of screenplay.scenes)
    for (const content of scene.content) {
      if (content.type === "dialogue")
        expected.push({
          delivery: "dialogue",
          speaker: content.character,
          text: content.lines,
        });
      else if (content.type === "voiceover")
        expected.push({
          delivery: "voiceover",
          speaker: content.character ?? "旁白",
          text: content.text,
        });
    }
  const actual: SpokenItem[] = [];
  for (const panel of data.panels) {
    if (panel.lipSyncText)
      actual.push({
        delivery: "dialogue",
        speaker: panel.speakingCharacter ?? "",
        text: panel.lipSyncText,
      });
    else if (panel.voiceoverText)
      actual.push({
        delivery: "voiceover",
        speaker: "旁白",
        text: panel.voiceoverText,
      });
  }
  validateSpokenCoverage(expected, actual, issues);
  for (const scene of screenplay.scenes)
    for (const content of scene.content) {
      if (content.type !== "action" || !content.actionDesign) continue;
      const evidence = new Set([
        content.text,
        ...content.actionDesign.evidence,
      ]);
      const matchingPanels = data.panels.filter((panel) =>
        panel.sourceEvidence.some((value) => evidence.has(value)),
      );
      if (
        !matchingPanels.length ||
        !matchingPanels.some(
          (panel) => panel.vfxCues.length || panel.sfxCues.length,
        )
      )
        issues.push(
          issue(
            "panels",
            "ACTION_CUES_MISSING",
            "Every evidence-backed fight or skill design must reach at least one storyboard panel with VFX or SFX cues",
          ),
        );
    }
}

function validateSpokenCoverage(
  expected: Array<{
    delivery: "dialogue" | "voiceover";
    speaker: string;
    text: string;
  }>,
  actual: Array<{
    delivery: "dialogue" | "voiceover";
    speaker: string;
    text: string;
  }>,
  issues: StructuredValidationIssue[],
) {
  const expectedGroups = expected.reduce<typeof expected>((groups, item) => {
    const previous = groups.at(-1);
    const samePerformance =
      previous?.delivery === item.delivery &&
      (item.delivery === "voiceover" || previous.speaker === item.speaker);
    if (previous && samePerformance) previous.text += item.text;
    else groups.push({ ...item });
    return groups;
  }, []);
  let actualIndex = 0;
  for (const line of expectedGroups) {
    let collected = "";
    while (actualIndex < actual.length && collected.length < line.text.length) {
      const segment = actual[actualIndex++];
      const speakerMatches =
        line.delivery === "voiceover" || segment.speaker === line.speaker;
      if (segment.delivery !== line.delivery || !speakerMatches) {
        issues.push(
          issue(
            "panels",
            "SPOKEN_SEQUENCE_MISMATCH",
            `Expected ${line.delivery} by ${line.speaker} in screenplay order`,
          ),
        );
        return;
      }
      collected += segment.text;
    }
    if (collected !== line.text) {
      issues.push(
        issue(
          "panels",
          "SPOKEN_CONTENT_COVERAGE_MISMATCH",
          `Spoken text must preserve every screenplay line exactly once: ${line.text}`,
        ),
      );
      return;
    }
  }
  if (actualIndex !== actual.length)
    issues.push(
      issue(
        "panels",
        "EXTRA_SPOKEN_CONTENT",
        "Storyboard contains spoken content not present in the screenplay",
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
    temporarySpeakers?: readonly string[];
    panelIndices: readonly number[];
  },
) {
  const issues: StructuredValidationIssue[] = [];
  const speakers = nameSet([
    ...input.characters,
    ...(input.temporarySpeakers ?? []),
    "旁白",
    "Narrator",
  ]);
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
  if (
    [...sourceText.matchAll(/[“\"]([^”\"\r\n]+)[”\"]/g)].some((match) =>
      match[1].includes(content.trim()),
    )
  )
    return true;

  const escapedSpeaker = escapeRegex(speaker.trim());
  if (!escapedSpeaker) return false;
  const speechVerb = SPEECH_VERB_PATTERN;
  if (
    new RegExp(
      `${escapedSpeaker}[^。！？!?“”\\"]{0,32}(?:${speechVerb})[^。！？!?“”\\"]{0,24}?[：:，,]\\s*${escapedContent}`,
    ).test(sourceText)
  )
    return true;
  return [
    ...sourceText.matchAll(
      new RegExp(
        `${escapedSpeaker}[^。！？!?“”\\"]{0,32}(?:${speechVerb})[^。！？!?“”\\"]{0,24}?[：:，,]\\s*([^。！？!?“”\\"]+)`,
        "g",
      ),
    ),
  ].some((match) => match[1].includes(content.trim()));
}

export function isSourceBackedTemporarySpeaker(
  content: string,
  speaker: string,
  sourceText: string,
) {
  const trimmedContent = content.trim();
  const trimmedSpeaker = speaker.trim();
  if (
    !trimmedContent ||
    !trimmedSpeaker ||
    !sourceText.includes(trimmedContent) ||
    !sourceText.includes(trimmedSpeaker)
  )
    return false;

  const escapedContent = escapeRegex(trimmedContent);
  const escapedSpeaker = escapeRegex(trimmedSpeaker);
  const leadingAttribution = new RegExp(
    `${escapedSpeaker}[^。！？!?“”\"]{0,40}(?:${SPEECH_VERB_PATTERN})[^。！？!?“”\"]{0,24}?[：:，,]?\\s*[“\"]?${escapedContent}[”\"]?`,
    "iu",
  );
  const trailingAttribution = new RegExp(
    `[“\"]?${escapedContent}[”\"]?[^。！？!?“”\"]{0,24}(?:${SPEECH_VERB_PATTERN})[^。！？!?“”\"]{0,24}${escapedSpeaker}`,
    "iu",
  );
  const labeledAttribution = new RegExp(
    `${escapedSpeaker}[^。！？!?“”\"]{0,16}[：:]\\s*[“\"]?${escapedContent}[”\"]?`,
    "iu",
  );
  const nearbyCollectiveAttribution =
    isCollectiveSpeakerLabel(trimmedSpeaker) &&
    [...sourceText.matchAll(/[“\"]([^”\"\r\n]+)[”\"]/g)].some((match) => {
      if (!match[1].includes(trimmedContent)) return false;
      const quoteStart = match.index ?? 0;
      const quoteEnd = quoteStart + match[0].length;
      const before = sourceText.slice(Math.max(0, quoteStart - 160), quoteStart);
      const after = sourceText.slice(quoteEnd, quoteEnd + 160);
      return (
        hasUninterruptedSpeakerMention(before, trimmedSpeaker, "before") ||
        hasUninterruptedSpeakerMention(after, trimmedSpeaker, "after")
      );
    });
  return (
    leadingAttribution.test(sourceText) ||
    trailingAttribution.test(sourceText) ||
    labeledAttribution.test(sourceText) ||
    nearbyCollectiveAttribution
  );
}

function isCollectiveSpeakerLabel(value: string) {
  return /(?:(?:无数|一些|这些|那些|许多|不少|部分|众多|其他|其余|在场|周围|附近|围观的?)人|众人|众修|人群|修者|弟子|族人|护卫|侍卫|士兵|村民|观众|群众|长老们|人们|crowd|onlookers|cultivators|disciples|guards|soldiers|villagers|audience|members)$/iu.test(
    value,
  );
}

function hasUninterruptedSpeakerMention(
  value: string,
  speaker: string,
  direction: "before" | "after",
) {
  const index =
    direction === "before" ? value.lastIndexOf(speaker) : value.indexOf(speaker);
  if (index < 0) return false;
  const between =
    direction === "before"
      ? value.slice(index + speaker.length)
      : value.slice(0, index);
  return !/[“”"]/.test(between) && !/[。；;]|\n\s*\n/u.test(between);
}

const SPEECH_VERB_PATTERN =
  "说(?:道)?|问(?:道)?|答(?:道)?|回答|回应|喊(?:道)?|叫(?!(?:进|到|来|住|醒))(?:道)?|喝(?:道)?|叹(?:道)?|笑(?:道)?|开口|低声(?:说)?|轻声(?:说)?|安慰|劝(?:说|慰)?|安抚|鼓励|齐声|惊呼|高呼|议论|起哄|叫嚷|嘲笑|怒骂|欢呼|哄笑|窃窃私语|附和|says?|said|asks?|asked|answers?|answered|replies?|replied|shouts?|shouted|cries?|cried|calls?|called|yells?|yelled|chants?|chanted|cheers?|cheered|murmurs?|murmured|whispers?|whispered";

export function isImplicitVisualBridgeAction(
  value: string,
  sourceText: string,
) {
  if (!value || isOrderedActionExcerpt(value, sourceText)) return false;
  if (
    /[“”"][^“”"]+[“”"]/.test(value) ||
    /(?:说|问|答|回应|喊|叫|开口|低声|轻声)[：:]/.test(value)
  )
    return false;
  if (
    !/(?:走到|走向|靠近|伸手|转身|抬手|递向|托在|拿稳|进入|跨进|停在|俯身|起身)/.test(
      value,
    )
  )
    return false;
  const sourceBigrams = new Set(chineseBigrams(sourceText));
  const shared = new Set(
    chineseBigrams(value).filter((bigram) => sourceBigrams.has(bigram)),
  );
  return shared.size >= 3;
}

function chineseBigrams(value: string) {
  const characters = Array.from(value.replace(/[^\u4e00-\u9fff]/g, ""));
  return characters
    .slice(1)
    .map((character, index) => `${characters[index]}${character}`);
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
        issue(
          path,
          "UNKNOWN_CANONICAL_NAME",
          `Unknown canonical name: ${value}`,
        ),
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
