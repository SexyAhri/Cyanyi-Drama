import { createHash } from "node:crypto";

import { z } from "zod";

import type { StructuredValidationIssue } from "@/lib/llm/structured-output";

export const DEFAULT_EPISODE_TARGET_SECONDS = 85;
export const MIN_EPISODE_TARGET_SECONDS = 60;
export const MAX_EPISODE_DURATION_SECONDS = 90;
export const EPISODE_PRODUCTION_PLAN_VERSION = 1;
export const MAX_ADAPTATION_SOURCE_UNITS = 500;

export function isEpisodeTargetDurationSeconds(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_EPISODE_TARGET_SECONDS &&
    value <= MAX_EPISODE_DURATION_SECONDS
  );
}

const nonEmptyText = z.string().trim().min(1);
const unitId = z.string().regex(/^U\d{4,}$/);
const beatId = z.string().regex(/^B\d{2,}$/);

export type AdaptationSourceUnit = {
  unitId: string;
  text: string;
  startIndex: number;
  endIndex: number;
  kind: "heading" | "narrative" | "dialogue" | "exposition";
};

const actionChainSchema = z
  .object({
    triggerOrIntent: nonEmptyText,
    preparation: nonEmptyText,
    execution: nonEmptyText,
    stateChange: nonEmptyText,
    settleOrReaction: nonEmptyText,
  })
  .strict();

const transitionSchema = z
  .object({
    exitAction: nonEmptyText,
    pathCompression: nonEmptyText,
    entryAction: nonEmptyText,
    arrivalState: nonEmptyText,
  })
  .strict();

const productionBeatSchema = z
  .object({
    beatId,
    kind: z.enum([
      "establishing",
      "action",
      "transition",
      "interaction",
      "dialogue",
      "reveal",
      "climax",
      "hook",
    ]),
    purpose: nonEmptyText.max(600),
    location: nonEmptyText.max(240),
    durationSeconds: z.number().int().min(1).max(30),
    adaptedStartMarker: nonEmptyText.max(600),
    adaptedEndMarker: nonEmptyText.max(600),
    actionChain: actionChainSchema.nullable(),
    transition: transitionSchema.nullable(),
    performanceIntent: nonEmptyText.max(1_000),
    interactions: z
      .array(
        z
          .object({
            actor: nonEmptyText.max(160),
            target: nonEmptyText.max(160),
            action: nonEmptyText.max(600),
            reaction: nonEmptyText.max(600),
          })
          .strict(),
      )
      .max(6),
    effects: z
      .array(
        z
          .object({
            kind: z.enum(["combat", "skill", "artifact", "phenomenon"]),
            trigger: nonEmptyText.max(600),
            visualIntent: nonEmptyText.max(1_200),
            soundIntent: nonEmptyText.max(600),
            provenance: z.enum([
              "source",
              "world_bible",
              "production_inference",
            ]),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();

const sourceCoverageSchema = z
  .object({
    sourceUnitId: unitId,
    beatId,
    adaptedEvidence: nonEmptyText.max(2_000),
    treatment: z.enum([
      "preserved",
      "condensed",
      "visualized",
      "dialogized",
    ]),
  })
  .strict();

const dialoguePlanSchema = z
  .object({
    lineId: z.string().regex(/^L\d{2,}$/),
    beatId,
    speaker: nonEmptyText.max(160),
    type: z.enum(["dialogue", "inner_monologue"]),
    text: nonEmptyText.max(1_000),
    sourceUnitIds: z.array(unitId).min(1).max(20),
    treatment: z.enum([
      "preserved",
      "condensed",
      "merged",
      "converted_exposition",
    ]),
  })
  .strict();

const narrationPlanSchema = z
  .object({
    lineId: z.string().regex(/^N\d{2,}$/),
    beatId,
    text: nonEmptyText.max(200),
    sourceUnitIds: z.array(unitId).min(1).max(20),
    reason: z.enum(["location_time", "world_rule"]),
  })
  .strict();

export const episodeProductionPlanDraftSchema = z
  .object({
    version: z.literal(EPISODE_PRODUCTION_PLAN_VERSION),
    runtime: z
      .object({
        targetDurationSeconds: z.number().int().min(60).max(90),
        plannedDurationSeconds: z.number().int().min(1).max(90),
        hardMaxDurationSeconds: z.literal(MAX_EPISODE_DURATION_SECONDS),
        estimatedShotCount: z.number().int().min(1).max(60),
        fit: z.enum(["target", "compressed", "short_source"]),
      })
      .strict(),
    beats: z.array(productionBeatSchema).min(1).max(40),
    sourceCoverage: z.array(sourceCoverageSchema).min(1).max(500),
    dialoguePlan: z.array(dialoguePlanSchema).max(100),
    narrationPlan: z.array(narrationPlanSchema).max(2),
    cliffhanger: z
      .object({
        beatId,
        setup: nonEmptyText.max(600),
        finalImageOrLine: nonEmptyText.max(600),
      })
      .strict(),
  })
  .strict();

export const episodeProductionPlanSchema = episodeProductionPlanDraftSchema
  .extend({
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    runtime: episodeProductionPlanDraftSchema.shape.runtime
      .extend({ estimatedSpokenSeconds: z.number().int().min(0).max(90) })
      .strict(),
  })
  .strict();

const readyAdaptationSchema = z
  .object({
    status: z.literal("ready"),
    title: nonEmptyText.max(160),
    summary: nonEmptyText.max(4_000),
    adaptedText: nonEmptyText.max(500_000),
    changeSummary: z.array(nonEmptyText.max(600)).max(30),
    productionPlan: episodeProductionPlanDraftSchema,
  })
  .strict();

const splitRecommendedSchema = z
  .object({
    status: z.literal("split_recommended"),
    title: nonEmptyText.max(160),
    reason: nonEmptyText.max(2_000),
    suggestedBoundarySourceUnitId: unitId,
    firstPartHook: nonEmptyText.max(600),
    secondPartOpening: nonEmptyText.max(600),
  })
  .strict();

export const episodeAdaptationOutputSchema = z.discriminatedUnion("status", [
  readyAdaptationSchema,
  splitRecommendedSchema,
]);

export type EpisodeProductionPlanDraft = z.infer<
  typeof episodeProductionPlanDraftSchema
>;
export type EpisodeProductionPlan = z.infer<typeof episodeProductionPlanSchema>;
export type EpisodeAdaptationOutput = z.infer<
  typeof episodeAdaptationOutputSchema
>;

export function buildAdaptationSourceUnits(
  source: string,
): AdaptationSourceUnit[] {
  if (!source) return [];
  const boundaries = editorialBoundaries(source);
  const units: AdaptationSourceUnit[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startIndex = boundaries[index];
    const endIndex = boundaries[index + 1];
    const text = source.slice(startIndex, endIndex);
    if (!text) continue;
    const trimmed = text.trim();
    units.push({
      unitId: `U${String(units.length + 1).padStart(4, "0")}`,
      text,
      startIndex,
      endIndex,
      kind: sourceUnitKind(trimmed, units.length),
    });
  }
  if (units.map((unit) => unit.text).join("") !== source)
    throw new Error("ADAPTATION_SOURCE_UNITS_NOT_LOSSLESS");
  return units;
}

export function validateEpisodeAdaptationOutput(input: {
  output: EpisodeAdaptationOutput;
  sourceUnits: readonly AdaptationSourceUnit[];
  targetDurationSeconds: number;
}): StructuredValidationIssue[] {
  if (input.output.status === "split_recommended") {
    const known = new Set(input.sourceUnits.map((unit) => unit.unitId));
    return known.has(input.output.suggestedBoundarySourceUnitId)
      ? []
      : [
          issue(
            "suggestedBoundarySourceUnitId",
            "ADAPTATION_SPLIT_BOUNDARY_UNKNOWN",
            "The suggested split boundary must reference one supplied source unit",
          ),
        ];
  }
  return validateEpisodeProductionPlan({
    plan: input.output.productionPlan,
    sourceUnits: input.sourceUnits,
    adaptedText: input.output.adaptedText,
    targetDurationSeconds: input.targetDurationSeconds,
  });
}

export function validateEpisodeProductionPlan(input: {
  plan: EpisodeProductionPlanDraft;
  sourceUnits: readonly AdaptationSourceUnit[];
  adaptedText: string;
  targetDurationSeconds: number;
}): StructuredValidationIssue[] {
  const issues: StructuredValidationIssue[] = [];
  const { plan, adaptedText } = input;
  if (plan.runtime.targetDurationSeconds !== input.targetDurationSeconds)
    issues.push(
      issue(
        "productionPlan.runtime.targetDurationSeconds",
        "EPISODE_TARGET_DURATION_CHANGED",
        `Target duration must remain ${input.targetDurationSeconds} seconds`,
      ),
    );
  const plannedDuration = plan.beats.reduce(
    (total, beat) => total + beat.durationSeconds,
    0,
  );
  if (plannedDuration !== plan.runtime.plannedDurationSeconds)
    issues.push(
      issue(
        "productionPlan.runtime.plannedDurationSeconds",
        "EPISODE_RUNTIME_SUM_MISMATCH",
        `Beat durations total ${plannedDuration} seconds`,
      ),
    );
  if (plannedDuration > MAX_EPISODE_DURATION_SECONDS)
    issues.push(
      issue(
        "productionPlan.runtime.plannedDurationSeconds",
        "EPISODE_RUNTIME_OVERFLOW",
        "Episode production plan cannot exceed 90 seconds",
      ),
    );

  const beatSlices = resolveBeatSlices(plan.beats, adaptedText, issues);
  const beatIds = new Set<string>();
  const effectTriggers = new Set<string>();
  plan.beats.forEach((beat, index) => {
    if (beatIds.has(beat.beatId))
      issues.push(
        issue(
          `productionPlan.beats.${index}.beatId`,
          "PRODUCTION_BEAT_DUPLICATE",
          `Production beat ${beat.beatId} appears more than once`,
        ),
      );
    beatIds.add(beat.beatId);
    if (
      ["action", "transition", "interaction", "climax"].includes(beat.kind) &&
      !beat.actionChain
    )
      issues.push(
        issue(
          `productionPlan.beats.${index}.actionChain`,
          "PRODUCTION_ACTION_CHAIN_REQUIRED",
          `${beat.kind} beats require trigger, preparation, execution, state change, and settle/reaction`,
        ),
      );
    const slice = beatSlices.get(beat.beatId);
    if (slice && beat.actionChain)
      Object.entries(beat.actionChain).forEach(([key, value]) => {
        if (!slice.includes(value))
          issues.push(
            issue(
              `productionPlan.beats.${index}.actionChain.${key}`,
              "PRODUCTION_ACTION_NOT_MATERIALIZED",
              "Every action-chain step must be copied from the corresponding adapted-text beat",
            ),
          );
      });
    if (slice && beat.transition)
      Object.entries(beat.transition).forEach(([key, value]) => {
        if (!slice.includes(value))
          issues.push(
            issue(
              `productionPlan.beats.${index}.transition.${key}`,
              "PRODUCTION_TRANSITION_NOT_MATERIALIZED",
              "Every transition step must be copied from the corresponding adapted-text beat",
            ),
          );
      });
    beat.effects.forEach((effect, effectIndex) => {
      const triggerKey = normalized(effect.trigger);
      if (effectTriggers.has(triggerKey))
        issues.push(
          issue(
            `productionPlan.beats.${index}.effects.${effectIndex}.trigger`,
            "PRODUCTION_EFFECT_TRIGGER_DUPLICATE",
            "Each effect trigger must identify one distinct event",
          ),
        );
      effectTriggers.add(triggerKey);
      if (slice && !slice.includes(effect.trigger))
        issues.push(
          issue(
            `productionPlan.beats.${index}.effects.${effectIndex}.trigger`,
            "PRODUCTION_EFFECT_NOT_MATERIALIZED",
            "Every effect trigger must be copied from its corresponding adapted-text beat",
          ),
        );
    });
    const previous = plan.beats[index - 1];
    if (previous && normalized(previous.location) !== normalized(beat.location)) {
      if (!beat.transition)
        issues.push(
          issue(
            `productionPlan.beats.${index}.transition`,
            "PRODUCTION_LOCATION_TRANSITION_REQUIRED",
            "A location change requires exit, compressed path, entry, and arrival state",
          ),
        );
    } else if (beat.transition && previous)
      issues.push(
        issue(
          `productionPlan.beats.${index}.transition`,
          "PRODUCTION_TRANSITION_LOCATION_UNCHANGED",
          "A transition contract is only valid when the location changes",
        ),
      );
  });

  validateSourceCoverage(input, beatIds, beatSlices, issues);
  validateSpokenPlan(input, beatIds, beatSlices, issues);

  if (!beatIds.has(plan.cliffhanger.beatId))
    issues.push(
      issue(
        "productionPlan.cliffhanger.beatId",
        "PRODUCTION_CLIFFHANGER_BEAT_UNKNOWN",
        "Cliffhanger must reference a supplied production beat",
      ),
    );
  if (plan.beats.at(-1)?.beatId !== plan.cliffhanger.beatId)
    issues.push(
      issue(
        "productionPlan.cliffhanger.beatId",
        "PRODUCTION_CLIFFHANGER_NOT_FINAL",
        "Cliffhanger must be assigned to the final production beat",
      ),
    );

  const sourceText = input.sourceUnits.map((unit) => unit.text).join("");
  if (
    requiresVisibleEffect(sourceText) &&
    !plan.beats.some((beat) => beat.effects.length)
  )
    issues.push(
      issue(
        "productionPlan.beats",
        "PRODUCTION_EFFECT_REQUIRED",
        "Visible supernatural energy, artifact activation, or an explicit phenomenon requires a VFX/SFX trigger",
      ),
    );
  return issues;
}

export function finalizeEpisodeProductionPlan(
  plan: EpisodeProductionPlanDraft,
  sourceText: string,
): EpisodeProductionPlan {
  const spokenText = [
    ...plan.dialoguePlan.map((line) => line.text),
    ...plan.narrationPlan.map((line) => line.text),
  ].join("\n");
  return episodeProductionPlanSchema.parse({
    ...plan,
    sourceHash: textHash(sourceText),
    runtime: {
      ...plan.runtime,
      estimatedSpokenSeconds: spokenText
        ? estimateSpeechDurationSeconds(spokenText)
        : 0,
    },
  });
}

export function parseEpisodeProductionPlan(
  value: unknown,
): EpisodeProductionPlan | null {
  const parsed = episodeProductionPlanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
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

function editorialBoundaries(source: string) {
  const boundaries = [0];
  const firstLineEnd = source.search(/\r?\n/u);
  const firstLine = (firstLineEnd >= 0 ? source.slice(0, firstLineEnd) : source)
    .trim();
  let cursor = 0;
  if (
    firstLineEnd >= 0 &&
    /^(?:第[零〇一二两三四五六七八九十百千\d]+[章节集幕]|(?:chapter|episode)\s+\d+)(?:\s+.*)?$/iu.test(
      firstLine,
    )
  ) {
    cursor = firstLineEnd + (source[firstLineEnd] === "\r" ? 2 : 1);
    boundaries.push(cursor);
  }
  while (cursor < source.length) {
    const maximum = Math.min(source.length, cursor + 600);
    if (maximum === source.length) {
      boundaries.push(source.length);
      break;
    }
    const minimum = Math.min(maximum, cursor + 180);
    const window = source.slice(minimum, maximum);
    let offset = -1;
    for (const pattern of [/\r?\n\s*\r?\n/gu, /\r?\n/gu, /[。！？!?；;]/gu]) {
      for (const match of window.matchAll(pattern))
        offset = Math.max(offset, (match.index ?? 0) + match[0].length);
      if (offset >= 0) break;
    }
    const end = offset >= 0 ? minimum + offset : maximum;
    boundaries.push(end);
    cursor = end;
  }
  return boundaries;
}

function sourceUnitKind(
  value: string,
  index: number,
): AdaptationSourceUnit["kind"] {
  if (
    index === 0 &&
    /^(?:第[零〇一二两三四五六七八九十百千\d]+[章节集幕]|(?:chapter|episode)\s+\d+)(?:\s+.*)?$/iu.test(
      value,
    )
  )
    return "heading";
  if (/[“”「」『』"']|(?:说道|问道|答道|开口|轻声道|沉声道)/u.test(value))
    return "dialogue";
  if (/(?:境界|修炼一道|顾名思义|据说|分别是|意味着|所谓|规则)/u.test(value))
    return "exposition";
  return "narrative";
}

function resolveBeatSlices(
  beats: readonly EpisodeProductionPlanDraft["beats"][number][],
  adaptedText: string,
  issues: StructuredValidationIssue[],
) {
  const slices = new Map<string, string>();
  let cursor = 0;
  beats.forEach((beat, index) => {
    const start = adaptedText.indexOf(beat.adaptedStartMarker, cursor);
    if (start < 0) {
      issues.push(
        issue(
          `productionPlan.beats.${index}.adaptedStartMarker`,
          "PRODUCTION_BEAT_START_NOT_FOUND",
          "Beat start marker must be copied verbatim from adaptedText",
        ),
      );
      return;
    }
    if (adaptedText.slice(cursor, start).trim())
      issues.push(
        issue(
          `productionPlan.beats.${index}.adaptedStartMarker`,
          "PRODUCTION_BEAT_TEXT_GAP",
          "Adapted text between production beats is not accounted for",
        ),
      );
    const markerEnd = adaptedText.indexOf(beat.adaptedEndMarker, start);
    if (markerEnd < start) {
      issues.push(
        issue(
          `productionPlan.beats.${index}.adaptedEndMarker`,
          "PRODUCTION_BEAT_END_NOT_FOUND",
          "Beat end marker must be copied verbatim from adaptedText after its start",
        ),
      );
      return;
    }
    const end = markerEnd + beat.adaptedEndMarker.length;
    slices.set(beat.beatId, adaptedText.slice(start, end));
    cursor = end;
  });
  if (adaptedText.slice(cursor).trim())
    issues.push(
      issue(
        "productionPlan.beats",
        "PRODUCTION_BEAT_TRAILING_TEXT",
        "Adapted text after the final production beat is not accounted for",
      ),
    );
  return slices;
}

function validateSourceCoverage(
  input: {
    plan: EpisodeProductionPlanDraft;
    sourceUnits: readonly AdaptationSourceUnit[];
  },
  beatIds: Set<string>,
  beatSlices: Map<string, string>,
  issues: StructuredValidationIssue[],
) {
  const expected = new Set(
    input.sourceUnits
      .filter((unit) => unit.kind !== "heading")
      .map((unit) => unit.unitId),
  );
  const seen = new Set<string>();
  input.plan.sourceCoverage.forEach((coverage, index) => {
    if (!expected.has(coverage.sourceUnitId))
      issues.push(
        issue(
          `productionPlan.sourceCoverage.${index}.sourceUnitId`,
          "PRODUCTION_SOURCE_UNIT_UNKNOWN",
          `Unknown or non-story source unit ${coverage.sourceUnitId}`,
        ),
      );
    if (seen.has(coverage.sourceUnitId))
      issues.push(
        issue(
          `productionPlan.sourceCoverage.${index}.sourceUnitId`,
          "PRODUCTION_SOURCE_UNIT_DUPLICATE",
          `Source unit ${coverage.sourceUnitId} is covered more than once`,
        ),
      );
    seen.add(coverage.sourceUnitId);
    if (!beatIds.has(coverage.beatId))
      issues.push(
        issue(
          `productionPlan.sourceCoverage.${index}.beatId`,
          "PRODUCTION_SOURCE_BEAT_UNKNOWN",
          `Unknown production beat ${coverage.beatId}`,
        ),
      );
    const slice = beatSlices.get(coverage.beatId);
    if (slice && !slice.includes(coverage.adaptedEvidence))
      issues.push(
        issue(
          `productionPlan.sourceCoverage.${index}.adaptedEvidence`,
          "PRODUCTION_SOURCE_NOT_MATERIALIZED",
          "Coverage evidence must be copied from its assigned adapted-text beat",
        ),
      );
  });
  expected.forEach((id) => {
    if (!seen.has(id))
      issues.push(
        issue(
          "productionPlan.sourceCoverage",
          "PRODUCTION_SOURCE_UNIT_MISSING",
          `Source unit ${id} is not accounted for`,
        ),
      );
  });
}

function validateSpokenPlan(
  input: {
    plan: EpisodeProductionPlanDraft;
    sourceUnits: readonly AdaptationSourceUnit[];
  },
  beatIds: Set<string>,
  beatSlices: Map<string, string>,
  issues: StructuredValidationIssue[],
) {
  const sourceUnitIds = new Set(input.sourceUnits.map((unit) => unit.unitId));
  const spokenByBeat = new Map<string, string[]>();
  const lines = [...input.plan.dialoguePlan, ...input.plan.narrationPlan];
  const lineIds = new Set<string>();
  lines.forEach((line, index) => {
    if (lineIds.has(line.lineId))
      issues.push(
        issue(
          `productionPlan.spokenLines.${index}.lineId`,
          "PRODUCTION_SPOKEN_LINE_DUPLICATE",
          `Spoken line ${line.lineId} appears more than once`,
        ),
      );
    lineIds.add(line.lineId);
    if (new Set(line.sourceUnitIds).size !== line.sourceUnitIds.length)
      issues.push(
        issue(
          `productionPlan.spokenLines.${index}.sourceUnitIds`,
          "PRODUCTION_SPOKEN_SOURCE_DUPLICATE",
          "A spoken line cannot reference the same source unit more than once",
        ),
      );
    if (!beatIds.has(line.beatId))
      issues.push(
        issue(
          `productionPlan.spokenLines.${index}.beatId`,
          "PRODUCTION_SPOKEN_BEAT_UNKNOWN",
          `Unknown production beat ${line.beatId}`,
        ),
      );
    if (!line.sourceUnitIds.every((id) => sourceUnitIds.has(id)))
      issues.push(
        issue(
          `productionPlan.spokenLines.${index}.sourceUnitIds`,
          "PRODUCTION_SPOKEN_SOURCE_UNKNOWN",
          "Every spoken line must reference supplied source units",
        ),
      );
    const slice = beatSlices.get(line.beatId);
    if (slice && !slice.includes(line.text))
      issues.push(
        issue(
          `productionPlan.spokenLines.${index}.text`,
          "PRODUCTION_SPOKEN_TEXT_NOT_MATERIALIZED",
          "Every approved spoken line must appear verbatim in its adapted-text beat",
        ),
      );
    const entries = spokenByBeat.get(line.beatId) ?? [];
    entries.push(line.text);
    spokenByBeat.set(line.beatId, entries);
  });
  const narrationCharacters = Array.from(
    input.plan.narrationPlan.map((line) => line.text).join(""),
  ).filter((character) => /[\u3400-\u9fff\uf900-\ufaff]/u.test(character)).length;
  if (input.plan.narrationPlan.length > 2 || narrationCharacters > 60)
    issues.push(
      issue(
        "productionPlan.narrationPlan",
        "PRODUCTION_NARRATION_OVERFLOW",
        "Narration is limited to two lines and 60 Chinese characters",
      ),
    );
  input.plan.beats.forEach((beat, index) => {
    const spoken = (spokenByBeat.get(beat.beatId) ?? []).join("\n");
    if (spoken && estimateSpeechDurationSeconds(spoken) > beat.durationSeconds)
      issues.push(
        issue(
          `productionPlan.beats.${index}.durationSeconds`,
          "PRODUCTION_DIALOGUE_DURATION_OVERFLOW",
          `Beat ${beat.beatId} needs at least ${estimateSpeechDurationSeconds(spoken)} seconds for its spoken text`,
        ),
      );
  });
}

function requiresVisibleEffect(source: string) {
  return /(?:奇异气息|异象|灵魂状态|阵纹|光芒(?:迸发|绽放|流转)|火焰(?:流转|迸发|轰鸣)|空间(?:扭曲|崩裂)|虚空(?:扭曲|崩裂)|能量冲击|破空锐响|弥漫而出)/u.test(
    source,
  );
}

function textHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalized(value: string) {
  return value.replace(/[\p{P}\p{S}\s]/gu, "").toLowerCase();
}

function issue(path: string, code: string, message: string) {
  return { path, code, message };
}
