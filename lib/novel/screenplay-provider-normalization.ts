import {
  ACTION_DESIGN_KINDS,
  ACTION_PHASES,
  SFX_CUE_TYPES,
  VFX_CUE_CATEGORIES,
} from "@/lib/production/action-cues";

type ProviderNormalizationContext = {
  clipText: string;
  characters: readonly string[];
  sourceEvents?: readonly { eventId: string; evidence: string }[];
};

const ACTION_KEYS = [
  "type",
  "text",
  "origin",
  "evidence",
  "inferenceType",
  "rationale",
  "confidence",
] as const;

export function normalizeScreenplayProviderPayload(
  value: unknown,
  context: ProviderNormalizationContext,
) {
  if (!isRecord(value) || !Array.isArray(value.scenes)) return value;
  return {
    ...pick(value, ["clipId", "originalText"]),
    ...(Array.isArray(value.coverage)
      ? { coverage: normalizeCoverage(value.coverage, context.sourceEvents) }
      : {}),
    scenes: value.scenes.map((scene) => normalizeScene(scene, context)),
  };
}

function normalizeCoverage(
  value: unknown[],
  sourceEvents: ProviderNormalizationContext["sourceEvents"],
) {
  const expectedEvidence = new Map(
    sourceEvents?.map((event) => [event.eventId, event.evidence]) ?? [],
  );
  return value.map((item) => {
    if (!isRecord(item)) return item;
    const normalized = pick(item, ["eventId", "evidence", "modes", "reason"]);
    const eventId = typeof item.eventId === "string" ? item.eventId : undefined;
    const evidence = eventId ? expectedEvidence.get(eventId) : undefined;
    return evidence === undefined ? normalized : { ...normalized, evidence };
  });
}

function normalizeScene(
  value: unknown,
  context: ProviderNormalizationContext,
) {
  if (!isRecord(value) || !Array.isArray(value.content)) return value;
  return {
    ...pick(value, [
      "sceneNumber",
      "heading",
      "description",
      "characters",
    ]),
    content: value.content.map((item) => normalizeContent(item, context)),
  };
}

function normalizeContent(
  value: unknown,
  context: ProviderNormalizationContext,
) {
  if (!isRecord(value)) return value;
  if (value.type === "dialogue")
    return pick(value, ["type", "character", "parenthetical", "lines"]);
  if (value.type === "voiceover")
    return pick(value, ["type", "character", "text"]);
  if (value.type !== "action") return value;

  const normalized = pick(value, ACTION_KEYS);
  const actionDesign = normalizeActionDesign(value, context);
  return actionDesign ? { ...normalized, actionDesign } : normalized;
}

function normalizeActionDesign(
  action: Record<string, unknown>,
  context: ProviderNormalizationContext,
) {
  if (!isRecord(action.actionDesign)) return undefined;
  const design = action.actionDesign;
  if (!includes(ACTION_DESIGN_KINDS, design.kind)) return undefined;
  const actionText = nonEmptyText(action.text);
  const performer =
    nonEmptyText(design.performer) ??
    context.characters.find((name) => actionText?.includes(name));
  if (!performer) return undefined;

  const choreography = textArray(design.choreography);
  if (!choreography.length && actionText) choreography.push(actionText);
  if (!choreography.length) return undefined;

  const evidence = textArray(design.evidence);
  if (!evidence.length)
    evidence.push(
      ...textArray(action.evidence).filter((quote) =>
        context.clipText.includes(quote),
      ),
    );
  if (!evidence.length && actionText && context.clipText.includes(actionText))
    evidence.push(actionText);
  if (!evidence.length) return undefined;

  const misplacedSfxPlan = Array.isArray(action.sfxPlan)
    ? action.sfxPlan
    : undefined;
  return {
    kind: design.kind,
    performer,
    target: optionalText(design.target),
    realm: optionalText(design.realm),
    technique: optionalText(design.technique),
    visualMotif: optionalText(design.visualMotif),
    visualMotifSource: includes(
      ["source", "world_bible", "production_inference"] as const,
      design.visualMotifSource,
    )
      ? design.visualMotifSource
      : null,
    visualMotifRationale: optionalText(design.visualMotifRationale),
    choreography,
    impact: optionalText(design.impact),
    environmentResponse: optionalText(design.environmentResponse),
    vfxPlan: normalizeVfxPlan(design.vfxPlan),
    sfxPlan: normalizeSfxPlan(design.sfxPlan ?? misplacedSfxPlan),
    evidence,
  };
}

function normalizeVfxPlan(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((cue) => {
    if (
      !isRecord(cue) ||
      !includes(ACTION_PHASES, cue.phase) ||
      !includes(VFX_CUE_CATEGORIES, cue.category) ||
      !nonEmptyText(cue.description)
    )
      return [];
    return [
      {
        phase: cue.phase,
        category: cue.category,
        description: cue.description,
      },
    ];
  });
}

function normalizeSfxPlan(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((cue) => {
    if (
      !isRecord(cue) ||
      !includes(ACTION_PHASES, cue.phase) ||
      !includes(SFX_CUE_TYPES, cue.type) ||
      !nonEmptyText(cue.description)
    )
      return [];
    return [{ phase: cue.phase, type: cue.type, description: cue.description }];
  });
}

function pick<const K extends readonly string[]>(
  value: Record<string, unknown>,
  keys: K,
) {
  return Object.fromEntries(
    keys.flatMap((key) => (key in value ? [[key, value[key]]] : [])),
  ) as { [P in K[number]]?: unknown };
}

function textArray(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = nonEmptyText(item);
        return text ? [text] : [];
      })
    : [];
}

function optionalText(value: unknown) {
  return nonEmptyText(value) ?? null;
}

function nonEmptyText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function includes<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
