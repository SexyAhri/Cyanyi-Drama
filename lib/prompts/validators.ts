import { z } from "zod";

import { canonicalSummaryPlaceholderFragments } from "@/lib/assets/canonical-summary";
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

export function normalizeCharacterAnalysisEvidence(
  data: CharacterAnalysis,
  sourceText: string,
): CharacterAnalysis {
  return {
    ...data,
    characters: normalizeAnalysisEntities(data.characters, sourceText),
  };
}

export function normalizeLocationPropAnalysisEvidence(
  data: LocationPropAnalysis,
  sourceText: string,
): LocationPropAnalysis {
  return {
    ...data,
    locations: normalizeAnalysisEntities(data.locations, sourceText),
    props: normalizeAnalysisEntities(data.props, sourceText),
  };
}

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
  data.locations.forEach((location, index) => {
    validateEvidence(
      location.evidence,
      sourceText,
      `locations.${index}.evidence`,
      issues,
    );
    validateCanonicalSummary(
      location.summary,
      `locations.${index}.summary`,
      issues,
    );
  });
  data.props.forEach((prop, index) => {
    validateEvidence(
      prop.evidence,
      sourceText,
      `props.${index}.evidence`,
      issues,
    );
    validateCanonicalSummary(prop.summary, `props.${index}.summary`, issues);
  });
  return issues;
}

function validateCanonicalSummary(
  summary: string | null | undefined,
  path: string,
  issues: StructuredValidationIssue[],
) {
  const placeholders = canonicalSummaryPlaceholderFragments(summary);
  if (!placeholders.length) return;
  issues.push(
    issue(
      path,
      "EMPTY_CANONICAL_FACT_TEMPLATE",
      `Remove non-factual placeholder fragments (${placeholders.join("; ")}); preserve only source-backed stable facts, or return null when no stable fact is stated`,
    ),
  );
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
  const sourceBackedSceneRoles = nameSet(
    data.scenes.flatMap((scene) =>
      scene.characters.filter(
        (name) =>
          input.clipText.includes(name) && isCollectiveSpeakerLabel(name),
      ),
    ),
  );
  const allowedCharacters = [
    ...input.canonical.characters,
    ...sourceBackedSpeakers,
    ...sourceBackedSceneRoles,
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
      if (
        content.type === "action" &&
        requiresActionDesign(content.text) &&
        !content.actionDesign
      )
        issues.push(
          issue(
            `scenes.${sceneIndex}.content.${contentIndex}.actionDesign`,
            "ACTION_DESIGN_REQUIRED",
            "Fight, chase, attack, defense, transformation, summoning, and named-technique actions require an explicit actionDesign",
          ),
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

function normalizeAnalysisEntities<
  T extends { name: string; evidence: string[] },
>(entities: readonly T[], sourceText: string) {
  return entities.flatMap((entity) => {
    const evidence = entity.evidence.filter((quote) =>
      sourceText.includes(quote),
    );
    if (!evidence.length && sourceText.includes(entity.name))
      evidence.push(entity.name);
    return evidence.length ? [{ ...entity, evidence }] : [];
  });
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

export function normalizeReusableScreenplaySourceContract(
  data: ScreenplayConversion,
  input: ScreenplaySourceContract,
): ScreenplayConversion {
  const sourceEvents = input.sourceEvents ?? buildSourceEvents(input.clipText);
  return normalizeScreenplaySourceContract(
    {
      ...data,
      coverage: sourceEvents.map((event) => {
        const previous = data.coverage?.find(
          (item) => item.eventId === event.eventId,
        );
        const coveredModes = previous?.modes.filter(
          (mode) => mode !== "omitted",
        );
        return {
          eventId: event.eventId,
          evidence: event.evidence,
          modes:
            coveredModes?.length ? coveredModes : (["visual"] as const),
          reason: null,
        };
      }),
    },
    { ...input, sourceEvents },
  );
}

export function normalizeStoryboardPlanningEntities(
  data: StoryboardPlanning,
): StoryboardPlanning {
  return {
    panels: data.panels.map((panel) => ({
      ...panel,
      characters: panel.characters.filter(
        (name) => !isEmptyEntityPlaceholder(name),
      ),
      props: panel.props.filter((name) => !isEmptyEntityPlaceholder(name)),
    })),
  };
}

export function normalizeStoryboardPlanningContract(
  data: StoryboardPlanning,
  input: {
    sourceText: string;
    screenplay: ScreenplayConversion;
    productionContextText?: string;
  },
): StoryboardPlanning {
  const knowledgeText = `${input.sourceText}\n${input.productionContextText ?? ""}`;
  const evidenceCandidates = storyboardEvidenceCandidates(
    input.screenplay,
    input.sourceText,
  );
  const spokenNormalized = normalizeStoryboardSpokenDelivery(
    normalizeStoryboardPlanningEntities(data),
    input.screenplay,
  );

  const panels = spokenNormalized.panels.map((rawPanel) => {
      const panel = ensureStoryboardProductionContract(
        ensureStoryboardStateCharacters(rawPanel),
      );
      const sourceEvidence = panel.sourceEvidence.filter((quote) =>
        input.sourceText.includes(quote),
      );
      const fallbackEvidence = closestStoryboardEvidence(
        `${panel.description}\n${panel.videoPrompt}`,
        evidenceCandidates,
      );
      return {
        ...panel,
        sourceEvidence:
          sourceEvidence.length > 0
            ? sourceEvidence
            : [fallbackEvidence ?? input.screenplay.clipId],
        vfxCues: panel.vfxCues.flatMap((cue) => {
          const evidence = cue.evidence.filter((quote) =>
            knowledgeText.includes(quote),
          );
          return evidence.length ? [{ ...cue, evidence }] : [];
        }),
        sfxCues: panel.sfxCues.flatMap((cue) => {
          const evidence = cue.evidence.filter((quote) =>
            knowledgeText.includes(quote),
          );
          return evidence.length ? [{ ...cue, evidence }] : [];
        }),
      };
    });
  return {
    ...spokenNormalized,
    panels: panels.map((panel, index) => {
      const previous = panels[index - 1];
      if (
        previous?.sceneNumber !== panel.sceneNumber ||
        !previous.endState ||
        !panel.startState
      )
        return panel;
      const sameCharacters = sameStoryboardCharacterSet(
        previous.characters,
        panel.characters,
      );
      const sameProps = sameStoryboardCharacterSet(previous.props, panel.props);
      return {
        ...panel,
        startState: {
          ...panel.startState,
          ...(sameCharacters
            ? {
                hands: previous.endState.hands,
                screenDirection: previous.endState.screenDirection,
                characterStates: previous.endState.characterStates,
                ...(sameProps
                  ? {
                      props: previous.endState.props,
                      propStates: previous.endState.propStates,
                    }
                  : {}),
              }
            : {}),
          environmentState: previous.endState.environmentState,
        },
      };
    }),
  };
}

function ensureStoryboardProductionContract(
  panel: StoryboardPlanning["panels"][number],
): StoryboardPlanning["panels"][number] {
  const lastBeat = panel.motionTimeline.at(-1);
  const interaction = panel.motionTimeline.some(motionBeatNeedsInteractionContract);
  const riskFocus = [
    ...(panel.characters.length > 1 ? (["identity_state"] as const) : []),
    ...(interaction ? (["interaction_physics"] as const) : []),
    ...(panel.props.length ? (["prop_continuity"] as const) : []),
    ...(panel.lipSyncText ? (["dialogue_lipsync"] as const) : []),
    ...(panel.vfxCues.length ? (["vfx_continuity"] as const) : []),
  ].slice(0, 3);
  const environmentState = {
    keyLightSource: "沿用场景已建立的主光源",
    lightDirection: "保持场景已建立的光线方向",
    weather: "保持剧本与连续性锚点已建立的天气",
    windDirection: null,
    damageState: [],
    particles: [],
    ambientAudioKey: "保持本场景已建立的环境底噪",
  };
  const normalizeBeat = (
    beat: StoryboardPlanning["panels"][number]["motionTimeline"][number],
    index: number,
  ) => {
    if (!motionBeatNeedsInteractionContract(beat)) return beat;
    return {
      ...beat,
      trigger:
        beat.trigger ??
        (index > 0
          ? `承接${panel.motionTimeline[index - 1]?.beatId ?? "上一节拍"}的结果`
          : `承接起始状态：${panel.startState?.body ?? panel.description}`),
      preparation: beat.preparation ?? `为动作建立重心、距离与发力姿态：${beat.action}`,
      forceSource:
        beat.forceSource ??
        `${beat.actor ?? "施动者"}通过${beat.bodyPart ?? beat.prop ?? "身体重心"}发力`,
      contactMaterial:
        beat.contactMaterial ??
        (beat.contact && beat.contact !== "none"
          ? "按角色服装、身体或道具既定材质表现接触"
          : null),
      settle: beat.settle ?? beat.result ?? `动作完成后稳定在本节拍结束状态`,
    };
  };
  const worldContext = panel.worldContext ?? {};
  return {
    ...panel,
    startState: panel.startState
      ? {
          ...panel.startState,
          environmentState:
            panel.startState.environmentState ?? environmentState,
        }
      : panel.startState,
    endState: panel.endState
      ? {
          ...panel.endState,
          environmentState: panel.endState.environmentState ?? environmentState,
        }
      : panel.endState,
    motionTimeline: panel.motionTimeline.map(normalizeBeat),
    worldContext: {
      ...worldContext,
      shotIntent: worldContext.shotIntent ?? {
        audienceTakeaway: panel.description,
        primaryVisibleEvent: panel.motionTimeline[0]?.action ?? panel.description,
        endBeat: lastBeat?.result ?? lastBeat?.action ?? panel.endState?.body ?? panel.description,
      },
      constraints: worldContext.constraints ?? {
        mustHold: [
          ...(panel.locationName ? [`场景保持为${panel.locationName}`] : []),
          ...(panel.characters.length
            ? [`仅保持已批准角色身份与数量：${panel.characters.join("、")}`]
            : ["保持已批准的环境空镜状态"]),
          ...(panel.props.length
            ? [`保持道具身份与状态：${panel.props.join("、")}`]
            : []),
        ],
        changesHere: [lastBeat?.result ?? lastBeat?.action ?? panel.description],
        mustNotAppear: riskFocus.map(storyboardRiskProhibition),
      },
      riskFocus: worldContext.riskFocus?.slice(0, 3) ?? riskFocus,
      referenceScopes:
        worldContext.referenceScopes ??
        [
          ...panel.characters.map((assetName) => ({
            assetName,
            assetVersion: null,
            inherit: ["身份", "脸型", "发型", "服装", "体型"],
            exclude: ["本镜未明确要求的姿态、表情和临时状态"],
          })),
          ...panel.props.map((assetName) => ({
            assetName,
            assetVersion: null,
            inherit: ["形制", "材质", "颜色", "识别特征"],
            exclude: ["本镜未明确要求的持有者、位置和开合破损状态"],
          })),
        ],
    },
  };
}

function storyboardRiskProhibition(risk: string) {
  switch (risk) {
    case "identity_state":
      return "禁止角色换脸、换装、身份互换或数量漂移";
    case "interaction_physics":
      return "禁止穿模、接触滑移、受力无反应、瞬移或动作重置";
    case "prop_continuity":
      return "禁止道具复制、消失、换手跳变或状态重置";
    case "dialogue_lipsync":
      return "禁止错误角色口型、多人同时开口或口型时序漂移";
    case "vfx_continuity":
      return "禁止特效颜色、形态、阶段、运动或消散规律漂移";
    default:
      return `禁止出现与风险 ${risk} 对应的连续性漂移`;
  }
}

function ensureStoryboardStateCharacters(
  panel: StoryboardPlanning["panels"][number],
) {
  if (!panel.characters.length || !panel.startState || !panel.endState)
    return panel;
  const hasEveryCharacter = (body: string) =>
    panel.characters.every((character) => body.includes(character));
  const label = panel.characters.join("、");
  return {
    ...panel,
    startState: {
      ...panel.startState,
      body: hasEveryCharacter(panel.startState.body)
        ? panel.startState.body
        : `${label}处于本镜起始姿态`,
    },
    endState: {
      ...panel.endState,
      body: hasEveryCharacter(panel.endState.body)
        ? panel.endState.body
        : `${label}完成本镜动作`,
    },
  };
}

function storyboardEvidenceCandidates(
  screenplay: ScreenplayConversion,
  sourceText: string,
) {
  const candidates = [
    ...(screenplay.coverage?.map((item) => item.evidence) ?? []),
    ...screenplay.scenes.flatMap((scene) => [
      scene.description,
      ...scene.content.flatMap((content) => [
        content.type === "dialogue" ? content.lines : content.text,
        ...(content.type === "action" ? (content.evidence ?? []) : []),
        ...(content.type === "action"
          ? (content.actionDesign?.evidence ?? [])
          : []),
      ]),
    ]),
    ...buildSourceEvents(screenplay.originalText).map((event) => event.evidence),
  ];
  return Array.from(
    new Set(candidates.filter((value) => value && sourceText.includes(value))),
  );
}

function closestStoryboardEvidence(
  panelText: string,
  candidates: readonly string[],
) {
  let best: string | undefined;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = storyboardTextOverlapScore(panelText, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : undefined;
}

function storyboardTextOverlapScore(left: string, right: string) {
  if (left.includes(right)) return Number.MAX_SAFE_INTEGER;
  const leftUnits = storyboardTextUnits(left);
  const rightUnits = storyboardTextUnits(right);
  if (!leftUnits.size || !rightUnits.size) return 0;
  let shared = 0;
  for (const unit of rightUnits) if (leftUnits.has(unit)) shared += 1;
  return (2 * shared) / (leftUnits.size + rightUnits.size);
}

function storyboardTextUnits(value: string) {
  const units = new Set(chineseBigrams(value));
  for (const word of value.toLocaleLowerCase().match(/[a-z\d]+/g) ?? [])
    units.add(word);
  return units;
}

function normalizeStoryboardSpokenDelivery(
  data: StoryboardPlanning,
  screenplay: ScreenplayConversion,
): StoryboardPlanning {
  type SpokenItem = {
    delivery: "dialogue" | "voiceover";
    speaker: string;
    text: string;
  };
  const expected = screenplay.scenes
    .flatMap((scene) => scene.content)
    .flatMap<SpokenItem>((content) => {
      if (content.type === "dialogue")
        return [
          {
            delivery: "dialogue",
            speaker: content.character,
            text: content.lines,
          },
        ];
      if (content.type === "voiceover")
        return [
          {
            delivery: "voiceover",
            speaker: content.character ?? "旁白",
            text: content.text,
          },
        ];
      return [];
    })
    .reduce<SpokenItem[]>((groups, item) => {
      const previous = groups.at(-1);
      const samePerformance =
        previous?.delivery === item.delivery &&
        (item.delivery === "voiceover" || previous.speaker === item.speaker);
      if (previous && samePerformance) previous.text += item.text;
      else groups.push({ ...item });
      return groups;
    }, []);
  const actual = data.panels.flatMap((panel, panelIndex) => {
    const text = panel.lipSyncText ?? panel.voiceoverText;
    return text ? [{ panelIndex, text }] : [];
  });
  if (
    actual.map((item) => item.text).join("") !==
    expected.map((item) => item.text).join("")
  )
    return data;

  const assignments = new Map<number, SpokenItem>();
  let actualIndex = 0;
  for (const group of expected) {
    let collected = "";
    const groupActual = [];
    while (actualIndex < actual.length && collected.length < group.text.length) {
      const item = actual[actualIndex++];
      groupActual.push(item);
      collected += item.text;
    }
    if (collected !== group.text) return data;
    for (const item of groupActual) assignments.set(item.panelIndex, group);
  }
  if (actualIndex !== actual.length) return data;

  return {
    ...data,
    panels: data.panels.map((panel, panelIndex) => {
      const assignment = assignments.get(panelIndex);
      if (!assignment) return panel;
      const text = panel.lipSyncText ?? panel.voiceoverText;
      if (!text) return panel;
      if (assignment.delivery === "voiceover")
        return {
          ...panel,
          speakingCharacter: null,
          lipSyncText: null,
          voiceoverText: text,
        };
      const hasSpeaker = nameSet(panel.characters).has(
        normalizeName(assignment.speaker),
      );
      return {
        ...panel,
        characters: hasSpeaker
          ? panel.characters
          : [...panel.characters, assignment.speaker],
        speakingCharacter: assignment.speaker,
        lipSyncText: text,
        voiceoverText: null,
      };
    }),
  };
}

function isEmptyEntityPlaceholder(value: string) {
  return /^(?:无|没有|无角色|无人物|无道具|无关键道具|none|null|n\/a)$/iu.test(
    value.trim(),
  );
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
  if (design.vfxPlan.length && !design.visualMotif)
    issues.push(
      issue(
        `${path}.visualMotif`,
        "VFX_VISUAL_MOTIF_REQUIRED",
        "An action with VFX cues requires a concrete reusable visual motif; do not leave effect authorship to the video model",
      ),
    );
  if (design.visualMotif && !design.visualMotifSource)
    issues.push(
      issue(
        `${path}.visualMotifSource`,
        "VFX_VISUAL_MOTIF_SOURCE_REQUIRED",
        "visualMotifSource must identify source, world_bible, or production_inference",
      ),
    );
  if (
    design.visualMotifSource === "production_inference" &&
    !design.visualMotifRationale
  )
    issues.push(
      issue(
        `${path}.visualMotifRationale`,
        "VFX_VISUAL_MOTIF_RATIONALE_REQUIRED",
        "A production-inferred visual motif requires a rationale tied to project style, era, ability facts, and the reusable effect library",
      ),
    );
  if (!design.visualMotif && (design.visualMotifSource || design.visualMotifRationale))
    issues.push(
      issue(
        `${path}.visualMotif`,
        "VFX_VISUAL_MOTIF_METADATA_ORPHANED",
        "visual motif provenance is only valid when visualMotif is present",
      ),
    );
}

function requiresActionDesign(value: string) {
  return /(?:打斗|决斗|交战|混战|追逐|追赶|逃窜|攻击|突袭|进攻|防御|格挡|招架|闪避|反击|挥(?:剑|刀|拳)|刺向|劈向|砍向|斩向|射向|踢向|击中|命中|受击|功法|招式|剑诀|刀法|掌法|拳法|法术|变身|召唤|fight|duel|combat|chase|attack|defend|block|dodge|counter|strike|slash|shoot|transform|summon)/iu.test(
    value,
  );
}

export type SourceEvent = { eventId: string; evidence: string };

export function buildSourceEvents(sourceText: string): SourceEvent[] {
  const splitFragments = sourceText
    .split(/(?<=[。！？!?；;\n])/u)
    .map((value) => value.trim())
    .filter(Boolean);
  const fragments: string[] = [];
  for (const fragment of splitFragments) {
    const match = fragment.match(/^([”’」』）》】]+)([\s\S]*)$/u);
    if (!match || !fragments.length) {
      fragments.push(fragment);
      continue;
    }
    fragments[fragments.length - 1] += match[1];
    const remainder = match[2].trim();
    if (remainder) fragments.push(remainder);
  }
  const reviewableFragments = fragments.filter((evidence, index) => {
    if (!normalizeActionText(evidence)) return false;
    return index !== 0 || !isChapterHeading(evidence);
  });
  return reviewableFragments.map(
    (evidence, index) => ({
      eventId: `E${String(index + 1).padStart(3, "0")}`,
      evidence,
    }),
  );
}

function isChapterHeading(value: string) {
  return /^第[0-9零〇一二三四五六七八九十百千万两]+(?:章|回|节|卷)[^。！？!?；;]*$/u.test(
    value.trim(),
  );
}

function validateSourceEventCoverage(
  data: ScreenplayConversion,
  sourceEvents: readonly SourceEvent[],
  issues: StructuredValidationIssue[],
) {
  const coverage = data.coverage ?? [];
  const byId = new Map(coverage.map((item) => [item.eventId, item]));
  const materializationCursor = new Map<string, number>();
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
    if (item.modes.includes("omitted"))
      issues.push(
        issue(
          `coverage.${event.eventId}.modes`,
          "SOURCE_EVENT_OMISSION_FORBIDDEN",
          "Every source event must remain visual, dialogue, or voiceover; unfilmable exposition belongs in grounded voiceover rather than being dropped",
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
    const modeCounts = stringCounts(item.modes);
    for (const [mode, count] of modeCounts)
      if (count > 1)
        issues.push(
          issue(
            `coverage.${event.eventId}.modes`,
            "SOURCE_EVENT_MODE_DUPLICATE",
            `Coverage mode ${mode} must not be repeated for ${event.eventId}`,
          ),
        );
    for (const mode of item.modes) {
      if (mode === "omitted") continue;
      const materializationKey = `${mode}\u0000${normalizeActionText(event.evidence)}`;
      const materializedIndex = findSourceEventModeMaterializationIndex(
        data,
        event.evidence,
        mode,
        materializationCursor.get(materializationKey) ?? -1,
      );
      if (materializedIndex < 0)
        issues.push(
          issue(
            `coverage.${event.eventId}.modes`,
            "SOURCE_EVENT_MODE_NOT_MATERIALIZED",
            `Source event ${event.eventId} claims ${mode} coverage but no matching ${mode} content exists in screenplay scenes`,
          ),
        );
      else materializationCursor.set(materializationKey, materializedIndex);
    }
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

function findSourceEventModeMaterializationIndex(
  data: ScreenplayConversion,
  eventEvidence: string,
  mode: "visual" | "dialogue" | "voiceover",
  afterIndex: number,
) {
  const contentItems = data.scenes.flatMap((scene) => scene.content);
  return contentItems.findIndex((content, index) => {
      if (index <= afterIndex) return false;
      if (mode === "visual" && content.type === "action")
        return [
          content.text,
          ...(content.evidence ?? []),
          ...(content.actionDesign?.evidence ?? []),
        ].some((value) => eventTextsReferToEachOther(value, eventEvidence));
      if (mode === "dialogue" && content.type === "dialogue")
        return eventTextsReferToEachOther(content.lines, eventEvidence);
      if (mode === "voiceover" && content.type === "voiceover")
        return eventTextsReferToEachOther(content.text, eventEvidence);
      return false;
    });
}

function eventTextsReferToEachOther(left: string, right: string) {
  const normalizedLeft = normalizeActionText(left);
  const normalizedRight = normalizeActionText(right);
  return (
    Boolean(normalizedLeft) &&
    Boolean(normalizedRight) &&
    (normalizedLeft.includes(normalizedRight) ||
      normalizedRight.includes(normalizedLeft))
  );
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
  if (input.screenplay)
    data = normalizeStoryboardPlanningContract(data, {
      sourceText: input.sourceText,
      screenplay: input.screenplay,
      productionContextText: input.productionContextText,
    });
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
    validateStructuredContinuityState(panel, `panels.${index}`, issues);
    validateStoryboardProductionContract(panel, `panels.${index}`, issues);
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
  const issues = validateExactPanelCoverage(
    data.rules.map((rule) => rule.panelIndex),
    expectedPanelIndices,
    "rules",
  );
  data.rules.forEach((rule, index) => {
    if (rule.cameraStart && rule.cameraPath && rule.cameraEnd) return;
    issues.push(
      issue(
        `rules.${index}`,
        "CAMERA_CONTRACT_REQUIRED",
        "Every shot requires cameraStart, one primary cameraPath movement, and cameraEnd with a cut point",
      ),
    );
  });
  return issues;
}

export function normalizeCinematographyContract(
  data: Cinematography,
  panels: ReadonlyArray<{
    panelIndex: number;
    cameraMove: string;
    shotType?: string;
    characters?: readonly string[];
  }> = [],
): Cinematography {
  const panelsByIndex = new Map(
    panels.map((panel) => [panel.panelIndex, panel]),
  );
  return {
    rules: data.rules.map((rule) => {
      const panel = panelsByIndex.get(rule.panelIndex);
      const shotSize = panel?.shotType ?? rule.camera;
      const focus = panel?.characters?.[0] ?? "当前叙事主体";
      return {
        ...rule,
        cameraStart: rule.cameraStart ?? {
          position: rule.cameraPosition,
          height: rule.camera,
          angle: rule.camera,
          shotSize,
          composition: rule.composition,
          focus,
        },
        cameraPath: rule.cameraPath ?? {
          primaryMovement: inferPrimaryCameraMovement(
            `${panel?.cameraMove ?? ""} ${rule.camera} ${rule.cameraPosition}`,
          ),
          direction: panel?.cameraMove ?? "沿已批准构图的叙事方向",
          speed: "均匀克制",
          distance: "仅覆盖起止构图所需距离",
          stabilization: "保持轴线、地平线与主体可读性",
          focusChange: null,
        },
        cameraEnd: rule.cameraEnd ?? {
          shotSize,
          composition: rule.composition,
          focus: "动作结果或主要反应",
          nextCutPoint: "主要可见事件完成并稳定时",
        },
      };
    }),
  };
}

function inferPrimaryCameraMovement(value: string) {
  if (/(?:推近|push|dolly in)/iu.test(value)) return "push" as const;
  if (/(?:拉远|pull|dolly out)/iu.test(value)) return "pull" as const;
  if (/(?:横移|跟随|track)/iu.test(value)) return "track" as const;
  if (/(?:摇摄|pan)/iu.test(value)) return "pan" as const;
  if (/(?:俯仰|tilt)/iu.test(value)) return "tilt" as const;
  if (/(?:环绕|orbit)/iu.test(value)) return "orbit" as const;
  if (/(?:升降|crane)/iu.test(value)) return "crane" as const;
  if (/(?:手持|handheld)/iu.test(value)) return "handheld" as const;
  return "locked" as const;
}

export function normalizeActingDirectionContract(
  data: ActingDirection,
  panels: ReadonlyArray<{
    panelIndex: number;
    characters: readonly string[];
    durationSeconds?: number;
    motionTimeline?: ReadonlyArray<{
      beatId?: string | null;
      actor?: string | null;
      target?: string | null;
      action: string;
    }>;
  }>,
): ActingDirection {
  const panelsByIndex = new Map(
    panels.map((panel) => [panel.panelIndex, panel]),
  );
  return {
    directions: data.directions.map((direction) => {
      const panel = panelsByIndex.get(direction.panelIndex);
      return {
        ...direction,
        characters: direction.characters.map((character) => ({
          ...character,
          performancePriority:
            character.performancePriority ??
            (panel?.motionTimeline?.some(
              (beat) => beat.target === character.name,
            )
              ? "reaction"
              : "primary"),
          allowedMicroMotion:
            character.allowedMicroMotion ??
            "仅允许与当前情绪、动作和反应有因果关系的呼吸、眨眼、视线、手部和重心微动",
          beats: character.beats?.map((beat, index) => ({
            ...beat,
            trigger:
              beat.trigger ??
              (index > 0
                ? "承接上一表演节拍的动作与情绪结果"
                : "承接本镜起始状态和当前剧情刺激"),
            microPause:
              beat.microPause ?? "在意图形成或受力反馈后保留克制的微停顿",
            breath: beat.breath ?? "呼吸随情绪张力和动作发力连续变化",
            weightShift:
              beat.weightShift ?? "重心随准备、动作、接触反应和收势连续转移",
          })),
        })),
      };
    }),
  };
}

export function validateActingCoverage(
  data: ActingDirection,
  panels: ReadonlyArray<{
    panelIndex: number;
    characters: readonly string[];
    durationSeconds?: number;
    description?: string;
    lipSyncText?: string | null;
    voiceoverText?: string | null;
    sourceEvidence?: readonly string[];
    motionTimeline?: ReadonlyArray<{
      startSecond?: number;
      endSecond?: number;
      action: string;
      actor?: string | null;
      target?: string | null;
      contact?: string;
      beatId?: string | null;
    }>;
  }>,
) {
  data = normalizeActingDirectionContract(data, panels);
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
    const evidenceCandidates = new Set(
      [
        panel.description,
        panel.lipSyncText,
        panel.voiceoverText,
        ...(panel.sourceEvidence ?? []),
        ...(panel.motionTimeline?.map((beat) => beat.action) ?? []),
      ].filter((value): value is string => Boolean(value?.trim())),
    );
    direction.characters.forEach((character, characterIndex) => {
      character.evidence.forEach((evidence, evidenceIndex) => {
        if (evidenceCandidates.has(evidence)) return;
        issues.push(
          issue(
            `directions.panel_${panel.panelIndex}.characters.${characterIndex}.evidence.${evidenceIndex}`,
            "ACTING_DIRECTION_NOT_GROUNDED",
            "Acting direction evidence must exactly quote this panel's description, spoken text, motion beat, or source evidence",
          ),
        );
      });
      const requiresTimedPerformance =
        panel.characters.length > 1 ||
        (panel.motionTimeline ?? []).some((beat) =>
          motionBeatNeedsInteractionContract(
            beat as StoryboardPlanning["panels"][number]["motionTimeline"][number],
          ),
        );
      if (requiresTimedPerformance && !character.beats?.length)
        issues.push(
          issue(
            `directions.panel_${panel.panelIndex}.characters.${characterIndex}.beats`,
            "ACTING_BEATS_REQUIRED",
            "Multi-character and physical-interaction shots require timed acting beats for every visible character",
          ),
        );
      if (
        requiresTimedPerformance &&
        (!character.performancePriority || !character.allowedMicroMotion)
      )
        issues.push(
          issue(
            `directions.panel_${panel.panelIndex}.characters.${characterIndex}`,
            "ACTING_PERFORMANCE_CONTRACT_REQUIRED",
            "Complex performances require a priority and an explicit allowed-micro-motion boundary",
          ),
        );
      if (character.beats?.length) {
        character.beats.forEach((beat, beatIndex) => {
          const expectedStart = character.beats?.[beatIndex - 1]?.endSecond ?? 0;
          if (
            beat.startSecond !== expectedStart ||
            beat.endSecond <= beat.startSecond ||
            (panel.durationSeconds !== undefined &&
              beat.endSecond > panel.durationSeconds)
          )
            issues.push(
              issue(
                `directions.panel_${panel.panelIndex}.characters.${characterIndex}.beats.${beatIndex}`,
                "ACTING_TIMELINE_NOT_CONTIGUOUS",
                `Expected a positive acting beat beginning at ${expectedStart}s`,
              ),
            );
          if (
            beat.subtext === undefined ||
            beat.gazeTarget === undefined ||
            beat.reactionTo === undefined
          )
            issues.push(
              issue(
                `directions.panel_${panel.panelIndex}.characters.${characterIndex}.beats.${beatIndex}`,
                "ACTING_BEAT_CONTEXT_REQUIRED",
                "Timed acting beats require explicit subtext, gazeTarget, and reactionTo values; use null only when the approved shot genuinely has none",
              ),
            );
          if (
            requiresTimedPerformance &&
            (!beat.trigger ||
              !beat.microPause ||
              !beat.breath ||
              !beat.weightShift)
          )
            issues.push(
              issue(
                `directions.panel_${panel.panelIndex}.characters.${characterIndex}.beats.${beatIndex}`,
                "ACTING_PHYSICAL_DETAIL_REQUIRED",
                "Complex acting beats require trigger, micro-pause, breath, and weight-shift direction",
              ),
            );
          beat.evidence.forEach((evidence, evidenceIndex) => {
            if (evidenceCandidates.has(evidence)) return;
            issues.push(
              issue(
                `directions.panel_${panel.panelIndex}.characters.${characterIndex}.beats.${beatIndex}.evidence.${evidenceIndex}`,
                "ACTING_BEAT_NOT_GROUNDED",
                "Timed acting beat evidence must exactly quote this panel's approved material",
              ),
            );
          });
        });
        if (
          panel.durationSeconds !== undefined &&
          character.beats.at(-1)?.endSecond !== panel.durationSeconds
        )
          issues.push(
            issue(
              `directions.panel_${panel.panelIndex}.characters.${characterIndex}.beats`,
              "ACTING_TIMELINE_DURATION_MISMATCH",
              "Timed acting beats must cover the complete shot duration",
            ),
          );
      }
      const isInteractionTarget = (panel.motionTimeline ?? []).some(
        (beat) => beat.target === character.name && beat.actor !== character.name,
      );
      if (
        isInteractionTarget &&
        !character.beats?.some((beat) => Boolean(beat.reactionTo?.trim()))
      )
        issues.push(
          issue(
            `directions.panel_${panel.panelIndex}.characters.${characterIndex}.beats`,
            "TARGET_REACTION_BEAT_REQUIRED",
            "A character targeted by a physical interaction requires a timed reactionTo beat",
          ),
        );
    });
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
    if (base.description && !refined.description.includes(base.description))
      issues.push(
        issue(
          `panels.panel_${base.panelIndex}.description`,
          "PLANNED_EVENT_TEXT_DROPPED",
          "Refinement may append production detail but must preserve the base description verbatim",
        ),
      );
    base.motionTimeline.forEach((beat, beatIndex) => {
      if (refined.motionTimeline[beatIndex]?.action.includes(beat.action)) return;
      issues.push(
        issue(
          `panels.panel_${base.panelIndex}.motionTimeline.${beatIndex}.action`,
          "PLANNED_EVENT_TEXT_DROPPED",
          "Refinement must preserve each planned action beat verbatim before adding acting or camera detail",
        ),
      );
    });
    for (const field of ["imagePrompt", "videoPrompt"] as const) {
      const planned = base[field];
      if (!planned || refined[field]?.includes(planned)) continue;
      issues.push(
        issue(
          `panels.panel_${base.panelIndex}.${field}`,
          "PLANNED_EVENT_TEXT_DROPPED",
          `Refinement must preserve the base ${field} verbatim before appending production detail`,
        ),
      );
    }
    validateExactValues(
      refined.sourceEvidence,
      base.sourceEvidence,
      `panels.panel_${base.panelIndex}.sourceEvidence`,
      issues,
    );
  }
  return issues;
}

export function normalizeStoryboardRefinementContract(
  data: StoryboardRefinement,
  basePanels: StoryboardPlanning["panels"],
): StoryboardRefinement {
  const baseByIndex = new Map(
    basePanels.map((panel) => [panel.panelIndex, panel]),
  );
  return {
    panels: data.panels.map((panel) => {
      const base = baseByIndex.get(panel.panelIndex);
      if (!base) return panel;
      return {
        ...panel,
        shotType: base.shotType,
        cameraMove: base.cameraMove,
        durationSeconds: base.durationSeconds,
        motionTimeline: base.motionTimeline.map((beat, index) => ({
          ...beat,
          action: panel.motionTimeline[index]?.action ?? beat.action,
          camera: panel.motionTimeline[index]?.camera ?? beat.camera,
        })),
        sceneNumber: base.sceneNumber,
        startState: base.startState,
        endState: base.endState,
        worldContext: base.worldContext,
        vfxCues: base.vfxCues,
        sfxCues: base.sfxCues,
        speakingCharacter: base.speakingCharacter,
        lipSyncText: base.lipSyncText,
        voiceoverText: base.voiceoverText,
        locationName: base.locationName,
        characters: base.characters,
        props: base.props,
        sourceEvidence: base.sourceEvidence,
      };
    }),
  };
}

function validateMotionTimeline(
  panel: StoryboardPlanning["panels"][number],
  path: string,
  issues: StructuredValidationIssue[],
) {
  const seenBeatIds = new Set<string>();
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
    const requiresInteraction = motionBeatNeedsInteractionContract(beat);
    const interactionContractIncomplete =
      !beat.beatId ||
      !beat.actor ||
      beat.target === undefined ||
      (!beat.bodyPart && !beat.prop) ||
      !beat.trigger ||
      !beat.preparation ||
      !beat.forceSource ||
      !beat.trajectory ||
      beat.contact === undefined ||
      beat.reaction === undefined ||
      !beat.result ||
      !beat.settle ||
      beat.causedBy === undefined;
    if (requiresInteraction && interactionContractIncomplete)
      issues.push(
        issue(
          `${path}.motionTimeline.${beatIndex}`,
          "INTERACTION_BEAT_CONTRACT_REQUIRED",
          "Complex physical beats require trigger, preparation, force source, trajectory, contact, reaction, result, settle, and explicit causality so downstream video generation can preserve action physics",
        ),
      );
    if (beat.beatId) {
      if (seenBeatIds.has(beat.beatId))
        issues.push(
          issue(
            `${path}.motionTimeline.${beatIndex}.beatId`,
            "INTERACTION_BEAT_ID_DUPLICATE",
            `Duplicate interaction beat id: ${beat.beatId}`,
          ),
        );
      seenBeatIds.add(beat.beatId);
    }
    if (beat.causedBy && !seenBeatIds.has(beat.causedBy))
      issues.push(
        issue(
          `${path}.motionTimeline.${beatIndex}.causedBy`,
          "INTERACTION_CAUSE_NOT_PRIOR",
          "causedBy must reference an earlier beat in the same shot",
        ),
      );
    if (beat.actor && !nameSet(panel.characters).has(normalizeName(beat.actor)))
      issues.push(
        issue(
          `${path}.motionTimeline.${beatIndex}.actor`,
          "INTERACTION_ACTOR_NOT_IN_SHOT",
          `Interaction actor must appear in panel.characters: ${beat.actor}`,
        ),
      );
    if (
      beat.target &&
      !nameSet([...panel.characters, ...panel.props]).has(normalizeName(beat.target)) &&
      ![panel.description, panel.videoPrompt, ...panel.sourceEvidence].some((value) =>
        value.includes(beat.target ?? ""),
      )
    )
      issues.push(
        issue(
          `${path}.motionTimeline.${beatIndex}.target`,
          "INTERACTION_TARGET_NOT_IN_SHOT",
          `Interaction target must be a character or prop in the shot: ${beat.target}`,
        ),
      );
    if (
      beat.contact &&
      beat.contact !== "none" &&
      (!beat.target ||
        !beat.contactPoint ||
        !beat.contactMaterial ||
        !beat.reaction ||
        !beat.result)
    )
      issues.push(
        issue(
          `${path}.motionTimeline.${beatIndex}`,
          "INTERACTION_CONTACT_INCOMPLETE",
          "Physical contact requires target, contactPoint, contactMaterial, reaction, and result",
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
  const interactionBeatCount = panel.motionTimeline.filter(
    motionBeatNeedsInteractionContract,
  ).length;
  const interactionComplexity =
    panel.characters.length +
    interactionBeatCount * 2 +
    panel.vfxCues.length +
    panel.sfxCues.length;
  if (interactionComplexity > 18)
    issues.push(
      issue(
        path,
        "SHOT_INTERACTION_COMPLEXITY_EXCEEDED",
        `Shot interaction complexity is ${interactionComplexity}; split shots when character count + interaction beats*2 + VFX cues + SFX cues exceeds 18`,
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
  const loreFields = [
    panel.worldContext?.realm,
    panel.worldContext?.technique,
    panel.worldContext?.powerRule,
    panel.worldContext?.visualMotif,
    panel.worldContext?.environmentScale,
  ];
  if (
    loreFields.some(Boolean) &&
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
  if (panel.vfxCues.length && !panel.worldContext?.visualMotif)
    issues.push(
      issue(
        `${path}.worldContext.visualMotif`,
        "STORYBOARD_VFX_VISUAL_MOTIF_REQUIRED",
        "A shot with VFX cues must carry the reusable visual motif from actionDesign instead of delegating effect design to the video model",
      ),
    );
  if (
    panel.worldContext?.visualMotif &&
    !normalizeActionText(knowledgeText).includes(
      normalizeActionText(panel.worldContext.visualMotif),
    )
  )
    issues.push(
      issue(
        `${path}.worldContext.visualMotif`,
        "STORYBOARD_VFX_VISUAL_MOTIF_CHANGED",
        "visualMotif must exactly preserve a motif supplied by the screenplay, effect library, or approved world reference",
      ),
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
      sameStoryboardCharacterSet(previous.characters, panel.characters) &&
      previous.endState &&
      panel.startState &&
      (previous.endState.hands !== panel.startState.hands ||
        previous.endState.screenDirection !==
          panel.startState.screenDirection ||
        (sameStoryboardCharacterSet(previous.props, panel.props) &&
          previous.endState.props !== panel.startState.props))
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
    if (previous?.sceneNumber === panel.sceneNumber) {
      if (
        previous.endState?.environmentState &&
        panel.startState?.environmentState &&
        JSON.stringify(previous.endState.environmentState) !==
          JSON.stringify(panel.startState.environmentState)
      )
        issues.push(
          issue(
            `panels.${index}.startState.environmentState`,
            "ENVIRONMENT_STATE_DISCONTINUITY",
            "Light, weather, damage, particles, wind, and ambient audio must inherit the prior shot end state before changing",
          ),
        );
      const previousCharacters = new Map(
        (previous.endState?.characterStates ?? []).map((state) => [
          normalizeName(state.name),
          state,
        ]),
      );
      for (const state of panel.startState?.characterStates ?? []) {
        const prior = previousCharacters.get(normalizeName(state.name));
        if (!prior || JSON.stringify(prior) === JSON.stringify(state)) continue;
        issues.push(
          issue(
            `panels.${index}.startState.characterStates`,
            "CHARACTER_STATE_DISCONTINUITY",
            `Character state must inherit the prior shot exactly before new action begins: ${state.name}`,
          ),
        );
      }
      const previousProps = new Map(
        (previous.endState?.propStates ?? []).map((state) => [
          normalizeName(state.name),
          state,
        ]),
      );
      for (const state of panel.startState?.propStates ?? []) {
        const prior = previousProps.get(normalizeName(state.name));
        if (!prior || JSON.stringify(prior) === JSON.stringify(state)) continue;
        issues.push(
          issue(
            `panels.${index}.startState.propStates`,
            "PROP_STATE_DISCONTINUITY",
            `Prop ownership, position, and state must inherit the prior shot exactly: ${state.name}`,
          ),
        );
      }
    }
  });

  const panelEvidence = new Set(
    data.panels.flatMap((panel) => panel.sourceEvidence),
  );
  let previousActionPanel = -1;
  const requiredActionOccurrences = new Map<string, number>();
  for (const scene of screenplay.scenes) {
    if (!data.panels.some((panel) => panel.sceneNumber === scene.sceneNumber))
      issues.push(
        issue(
          "panels",
          "SCREENPLAY_SCENE_MISSING",
          `Screenplay scene ${scene.sceneNumber} has no storyboard panel`,
        ),
      );
    for (const content of scene.content) {
      if (content.type !== "action") continue;
      const actionKey = `${scene.sceneNumber}\u0000${normalizeActionText(content.text)}`;
      const requiredOccurrence =
        (requiredActionOccurrences.get(actionKey) ?? 0) + 1;
      requiredActionOccurrences.set(actionKey, requiredOccurrence);
      const candidates = [content.text, ...(content.evidence ?? [])];
      const matchingPanels = data.panels
        .map((panel, panelIndex) => ({ panel, panelIndex }))
        .filter(
          ({ panel }) =>
            panel.sceneNumber === scene.sceneNumber &&
            panel.sourceEvidence.some((evidence) =>
              candidates.some((candidate) =>
                eventTextsReferToEachOther(evidence, candidate),
              ),
            ),
        );
      const matchingPanel = matchingPanels[0]?.panelIndex ?? -1;
      if (matchingPanel < 0) {
        issues.push(
          issue(
            "panels",
            "SCREENPLAY_ACTION_MISSING",
            `Storyboard must preserve the screenplay action: ${content.text}`,
          ),
        );
        continue;
      }
      if (
        storyboardActionMaterializationCount(
          matchingPanels.map(({ panel }) => panel),
          content.text,
        ) < requiredOccurrence
      )
        issues.push(
          issue(
            "panels",
            "SCREENPLAY_ACTION_NOT_MATERIALIZED",
            `Storyboard evidence references an action without depicting it in description, motionTimeline, or videoPrompt: ${content.text}`,
          ),
        );
      if (matchingPanel < previousActionPanel)
        issues.push(
          issue(
            "panels",
            "SCREENPLAY_ACTION_ORDER_CHANGED",
            "Storyboard action evidence must follow screenplay order",
          ),
        );
      previousActionPanel = Math.max(previousActionPanel, matchingPanel);
    }
  }
  for (const event of screenplay.coverage ?? []) {
    if (event.modes.includes("omitted") || panelEvidence.has(event.evidence))
      continue;
    issues.push(
      issue(
        "panels",
        "STORYBOARD_SOURCE_EVENT_MISSING",
        `Storyboard sourceEvidence must account for ${event.eventId}`,
      ),
    );
  }

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
      for (const step of content.actionDesign.choreography) {
        const materialized = matchingPanels.some((panel) =>
          panel.motionTimeline.some(
            (beat) =>
              eventTextsReferToEachOther(beat.choreographyStep ?? "", step) ||
              eventTextsReferToEachOther(beat.action, step),
          ),
        );
        if (materialized) continue;
        issues.push(
          issue(
            "panels",
            "ACTION_CHOREOGRAPHY_STEP_MISSING",
            `Every actionDesign choreography step must reach the storyboard motion timeline: ${step}`,
          ),
        );
      }
      if (
        content.actionDesign.target &&
        !matchingPanels.some((panel) =>
          panel.motionTimeline.some(
            (beat) =>
              beat.target === content.actionDesign?.target &&
              Boolean(beat.reaction?.trim()),
          ),
        )
      )
        issues.push(
          issue(
            "panels",
            "ACTION_TARGET_REACTION_MISSING",
            `The action target requires an explicit timed reaction: ${content.actionDesign.target}`,
          ),
        );
      for (const [label, expected] of [
        ["impact", content.actionDesign.impact],
        ["environment response", content.actionDesign.environmentResponse],
      ] as const) {
        if (!expected) continue;
        const materialized = matchingPanels.some((panel) =>
          [
            panel.videoPrompt,
            panel.description,
            panel.endState?.body ?? "",
            ...panel.motionTimeline.flatMap((beat) => [
              beat.action,
              beat.reaction ?? "",
              beat.result ?? "",
            ]),
          ].some((value) => eventTextsReferToEachOther(value, expected)),
        );
        if (materialized) continue;
        issues.push(
          issue(
            "panels",
            "ACTION_RESULT_NOT_MATERIALIZED",
            `actionDesign ${label} must appear in a storyboard beat, description, video prompt, or end state: ${expected}`,
          ),
        );
      }
    }
}

function validateStoryboardProductionContract(
  panel: StoryboardPlanning["panels"][number],
  path: string,
  issues: StructuredValidationIssue[],
) {
  const context = panel.worldContext;
  if (!context?.shotIntent)
    issues.push(
      issue(
        `${path}.worldContext.shotIntent`,
        "SHOT_INTENT_REQUIRED",
        "Every shot requires an audience takeaway, one primary visible event, and an end beat",
      ),
    );
  if (!context?.constraints)
    issues.push(
      issue(
        `${path}.worldContext.constraints`,
        "SHOT_CONSTRAINTS_REQUIRED",
        "Every shot requires mustHold, changesHere, and targeted mustNotAppear constraints",
      ),
    );
  if (context?.constraints) {
    const held = new Set(context.constraints.mustHold.map(normalizeActionText));
    const changes = new Set(
      context.constraints.changesHere.map(normalizeActionText),
    );
    const prohibited = new Set(
      context.constraints.mustNotAppear.map(normalizeActionText),
    );
    if (
      [...held].some((value) => changes.has(value) || prohibited.has(value)) ||
      [...changes].some((value) => prohibited.has(value))
    )
      issues.push(
        issue(
          `${path}.worldContext.constraints`,
          "SHOT_CONSTRAINT_CONFLICT",
          "The same instruction cannot be held, changed, and prohibited in one shot",
        ),
      );
    if (context.riskFocus?.length && !context.constraints.mustNotAppear.length)
      issues.push(
        issue(
          `${path}.worldContext.constraints.mustNotAppear`,
          "RISK_PROHIBITION_REQUIRED",
          "Risk-focused generation requires at least one targeted prohibition paired with positive locks",
        ),
      );
  }
  const shotAssets = nameSet([...panel.characters, ...panel.props]);
  for (const [index, scope] of (context?.referenceScopes ?? []).entries()) {
    if (!shotAssets.has(normalizeName(scope.assetName)))
      issues.push(
        issue(
          `${path}.worldContext.referenceScopes.${index}.assetName`,
          "REFERENCE_ASSET_NOT_IN_SHOT",
          `Reference inheritance may only target an asset present in the shot: ${scope.assetName}`,
        ),
      );
    const inherited = new Set(scope.inherit.map(normalizeActionText));
    if (scope.exclude.some((value) => inherited.has(normalizeActionText(value))))
      issues.push(
        issue(
          `${path}.worldContext.referenceScopes.${index}`,
          "REFERENCE_SCOPE_CONFLICT",
          "A reference attribute cannot be both inherited and excluded",
        ),
      );
  }
  for (const edge of ["startState", "endState"] as const)
    if (!panel[edge]?.environmentState)
      issues.push(
        issue(
          `${path}.${edge}.environmentState`,
          "ENVIRONMENT_STATE_REQUIRED",
          "Every shot edge requires light, weather, particles, damage, and ambient-audio continuity state",
        ),
      );
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

function motionBeatNeedsInteractionContract(
  beat: StoryboardPlanning["panels"][number]["motionTimeline"][number],
) {
  return Boolean(
    beat.phase ||
      beat.actor ||
      beat.target ||
      (beat.contact && beat.contact !== "none") ||
      /(?:抓|握|拉|推|递|接|扶|抱|撞|击|打|踢|踹|刺|劈|砍|斩|挡|格|闪|躲|追|attack|strike|grab|push|pull|hand|block|dodge|chase)/iu.test(
        beat.action,
      ),
  );
}

function validateStructuredContinuityState(
  panel: StoryboardPlanning["panels"][number],
  path: string,
  issues: StructuredValidationIssue[],
) {
  const requiresStructuredState =
    panel.characters.length > 1 ||
    panel.props.length > 0 ||
    panel.motionTimeline.some(motionBeatNeedsInteractionContract);
  if (!requiresStructuredState) return;
  for (const [edge, state] of [
    ["startState", panel.startState],
    ["endState", panel.endState],
  ] as const) {
    if (!state) continue;
    const actualCharacters = state.characterStates?.map((item) => item.name) ?? [];
    const actualProps = state.propStates?.map((item) => item.name) ?? [];
    if (!sameNormalizedValues(actualCharacters, panel.characters))
      issues.push(
        issue(
          `${path}.${edge}.characterStates`,
          "CHARACTER_STATE_COVERAGE_MISMATCH",
          "Complex shots require one structured continuity state for every panel character",
        ),
      );
    if (!sameNormalizedValues(actualProps, panel.props))
      issues.push(
        issue(
          `${path}.${edge}.propStates`,
          "PROP_STATE_COVERAGE_MISMATCH",
          "Shots with props require one structured continuity state for every panel prop",
        ),
      );
  }
}

function sameNormalizedValues(actual: readonly string[], expected: readonly string[]) {
  const left = [...nameSet(actual)].sort();
  const right = [...nameSet(expected)].sort();
  return JSON.stringify(left) === JSON.stringify(right);
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
    panelSpokenText?: readonly { panelIndex: number; text: string }[];
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
  if (input.panelSpokenText) {
    const expectedSequence = input.panelSpokenText.map((item) => item.text).join("");
    const actualSequence = data.lines.map((line) => line.content).join("");
    if (actualSequence !== expectedSequence)
      issues.push(
        issue(
          "lines",
          "VOICE_PANEL_COVERAGE_MISMATCH",
          "Voice analysis must preserve every storyboard lip-sync and voiceover segment exactly once and in panel order",
        ),
      );
    for (const panel of input.panelSpokenText) {
      const matched = data.lines
        .filter((line) => line.matchedPanelIndex === panel.panelIndex)
        .map((line) => line.content)
        .join("");
      if (matched === panel.text) continue;
      issues.push(
        issue(
          `panels.${panel.panelIndex}`,
          "VOICE_PANEL_MAPPING_MISMATCH",
          `Voice lines mapped to panel ${panel.panelIndex} must reproduce its complete spoken text`,
        ),
      );
    }
  }
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
  "说(?:道)?|问(?:道)?|答(?:道)?|回答|回应|喊(?!一声)(?:道)?|叫(?!(?:进|到|来|住|醒|一声))(?:道)?|喝(?!一声)(?:道)?|叹(?!一声)(?:道)?|笑(?:道)?|开口|低声(?:说)?|轻声(?:说)?|安慰|劝(?:说|慰)?|安抚|鼓励|齐声|惊呼|高呼|议论|起哄|叫嚷|嘲笑|怒骂|欢呼|哄笑|窃窃私语|附和|says?|said|asks?|asked|answers?|answered|replies?|replied|shouts?|shouted|cries?|cried|calls?|called|yells?|yelled|chants?|chanted|cheers?|cheered|murmurs?|murmured|whispers?|whispered";

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

function storyboardActionMaterializationCount(
  panels: StoryboardPlanning["panels"],
  actionText: string,
) {
  const normalizedAction = normalizeActionText(actionText);
  if (!normalizedAction) return 0;
  const descriptions = normalizeActionText(
    panels.map((panel) => panel.description).join(""),
  );
  const splitDescriptionCount = substringOccurrenceCount(
    descriptions,
    normalizedAction,
  );
  const perPanelCount = panels.reduce((total, panel) => {
    const fieldCounts = [
      substringOccurrenceCount(
        normalizeActionText(panel.description),
        normalizedAction,
      ),
      substringOccurrenceCount(
        normalizeActionText(panel.videoPrompt),
        normalizedAction,
      ),
      substringOccurrenceCount(
        normalizeActionText(
          panel.motionTimeline.map((beat) => beat.action).join(""),
        ),
        normalizedAction,
      ),
    ];
    return total + Math.max(...fieldCounts);
  }, 0);
  return Math.max(splitDescriptionCount, perPanelCount);
}

function substringOccurrenceCount(value: string, search: string) {
  if (!value || !search) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor <= value.length - search.length) {
    const index = value.indexOf(search, cursor);
    if (index < 0) break;
    count += 1;
    cursor = index + search.length;
  }
  return count;
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

export function sameStoryboardCharacterSet(
  left: readonly string[],
  right: readonly string[],
) {
  const leftSet = nameSet(left);
  const rightSet = nameSet(right);
  return (
    leftSet.size === rightSet.size &&
    Array.from(leftSet).every((name) => rightSet.has(name))
  );
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
