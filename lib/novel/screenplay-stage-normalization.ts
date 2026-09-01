import { z } from "zod";

import {
  ACTION_DESIGN_KINDS,
  ACTION_PHASES,
  SFX_CUE_TYPES,
  VFX_CUE_CATEGORIES,
} from "@/lib/production/action-cues";
import {
  screenplayAssemblySceneSchema,
  screenplayBeatPlanSchema,
  screenplayContentSchema,
  screenplayDialoguePlanSchema,
  screenplayEffectsPlanSchema,
  screenplayNarrationPlanSchema,
} from "@/lib/prompts/schemas";

type CanonicalContext = {
  characters: string[];
  locations: string[];
};

export type ScreenplayBeatPlan = z.infer<typeof screenplayBeatPlanSchema>;
export type ScreenplayDialoguePlan = z.infer<
  typeof screenplayDialoguePlanSchema
>;
export type ScreenplayNarrationPlan = z.infer<
  typeof screenplayNarrationPlanSchema
>;
export type ScreenplayEffectsPlan = z.infer<typeof screenplayEffectsPlanSchema>;
export type ScreenplayAssemblyScene = z.infer<
  typeof screenplayAssemblySceneSchema
>;
export type ScreenplayContent = z.infer<typeof screenplayContentSchema>;

export function normalizeBeatPlanPayload(
  value: unknown,
  input: {
    clipId: string;
    clipText: string;
    canonical: CanonicalContext;
  },
): ScreenplayBeatPlan {
  const root = unwrapRecord(value);
  const rawScenes = arrayValue(
    root?.scenes ?? root?.sceneList ?? root?.scene ?? root?.acts,
  );
  const scenes = rawScenes
    .map((item) => normalizeBeatScene(item, input))
    .filter((item): item is ScreenplayBeatPlan["scenes"][number] => !!item);

  if (!scenes.length) {
    const rootBeats = arrayValue(
      root?.beats ?? root?.actions ?? root?.content ?? value,
    );
    const beats = normalizeBeats(rootBeats);
    scenes.push(
      fallbackBeatScene(
        beats.length ? beats : [{ text: usableText(value) || input.clipText }],
        input,
      ),
    );
  }

  return { clipId: input.clipId, scenes };
}

export function normalizeDialoguePlanPayload(
  value: unknown,
  input: { clipId: string; defaultCharacter?: string },
): ScreenplayDialoguePlan {
  const root = unwrapRecord(value);
  const rawLines = arrayValue(
    root?.lines ?? root?.dialogue ?? root?.dialogues ?? root?.content,
  );
  const sceneLines = extractSceneContent(root, "dialogue");
  const candidates = rawLines.length
    ? rawLines
    : sceneLines.length
      ? sceneLines
      : parseSpeakerLines(usableText(value));
  const lines: ScreenplayDialoguePlan["lines"] = [];
  for (const item of candidates) {
    const record = asRecord(item);
    const text = textValue(
      record?.lines ?? record?.text ?? record?.dialogue ?? item,
    );
    if (!text) continue;
    lines.push({
      sceneIndex: nonNegativeInteger(
        record?.sceneIndex ?? record?.scene ?? record?.sceneNumber,
      ),
      afterBeatIndex: nullableNonNegativeInteger(
        record?.afterBeatIndex ?? record?.beatIndex ?? record?.afterBeat,
      ),
      character:
        textValue(
          record?.character ?? record?.speaker ?? record?.role ?? record?.name,
        ) ?? input.defaultCharacter ?? "未知说话人",
      parenthetical:
        textValue(record?.parenthetical ?? record?.emotion ?? record?.note) ??
        null,
      lines: text,
    });
  }
  return { clipId: input.clipId, lines };
}

export function normalizeNarrationPlanPayload(
  value: unknown,
  input: { clipId: string },
): ScreenplayNarrationPlan {
  const root = unwrapRecord(value);
  const rawLines = arrayValue(
    root?.lines ??
      root?.narration ??
      root?.voiceover ??
      root?.voiceovers ??
      root?.content,
  );
  const sceneLines = extractSceneContent(root, "voiceover");
  const plainText = usableText(value);
  const candidates = rawLines.length
    ? rawLines
    : sceneLines.length
      ? sceneLines
      : plainText
        ? [plainText]
        : [];
  const lines: ScreenplayNarrationPlan["lines"] = [];
  for (const item of candidates) {
    const record = asRecord(item);
    const text = textValue(
      record?.text ?? record?.lines ?? record?.narration ?? item,
    );
    if (!text) continue;
    lines.push({
      sceneIndex: nonNegativeInteger(
        record?.sceneIndex ?? record?.scene ?? record?.sceneNumber,
      ),
      afterBeatIndex: nullableNonNegativeInteger(
        record?.afterBeatIndex ?? record?.beatIndex ?? record?.afterBeat,
      ),
      character:
        textValue(record?.character ?? record?.speaker ?? record?.role) ?? null,
      text,
    });
  }
  return { clipId: input.clipId, lines };
}

export function normalizeEffectsPlanPayload(
  value: unknown,
  input: { clipId: string; clipText: string; defaultPerformer?: string },
): ScreenplayEffectsPlan {
  const root = unwrapRecord(value);
  const rawDesigns = arrayValue(
    root?.designs ?? root?.effects ?? root?.actionDesigns ?? root?.content,
  );
  const sceneDesigns = extractActionDesigns(root);
  const plainText = usableText(value);
  const candidates = rawDesigns.length
    ? rawDesigns
    : sceneDesigns.length
      ? sceneDesigns
      : plainText &&
          !/^(?:无|没有|不需要|none|no effects?)\s*[。.!]?$/i.test(plainText)
        ? [plainText]
        : [];
  return {
    clipId: input.clipId,
    designs: candidates.map((item) => {
      const record = asRecord(item);
      return {
        sceneIndex: nonNegativeInteger(
          record?.sceneIndex ?? record?.scene ?? record?.sceneNumber,
        ),
        beatIndex: nonNegativeInteger(
          record?.beatIndex ?? record?.beat ?? record?.actionIndex,
        ),
        actionDesign: normalizeActionDesign(
          record?.actionDesign ?? record?.design ?? item,
          input,
        ),
      };
    }),
  };
}

export function normalizeAssemblyScenePayload(
  value: unknown,
  fallback: ScreenplayAssemblyScene,
): ScreenplayAssemblyScene {
  const root = unwrapRecord(value);
  const scene = asRecord(root?.scene ?? arrayValue(root?.scenes)[0] ?? root);
  if (!scene) return fallback;
  const heading = asRecord(scene.heading);
  const content = arrayValue(scene.content)
    .map((item) => normalizeScreenplayContent(item, fallback))
    .filter((item): item is ScreenplayContent => !!item);
  if (!content.length) return fallback;
  return preservePreparedSceneContent({
    scene: {
      heading: {
        intExt:
          enumValue(heading?.intExt, ["INT", "EXT"] as const) ??
          fallback.scene.heading.intExt,
        location:
          textValue(heading?.location ?? scene.location) ??
          fallback.scene.heading.location,
        time:
          textValue(heading?.time ?? scene.time) ?? fallback.scene.heading.time,
      },
      description: textValue(scene.description) ?? fallback.scene.description,
      characters: stringList(scene.characters).length
        ? stringList(scene.characters)
        : fallback.scene.characters,
      content,
    },
  }, fallback);
}

function preservePreparedSceneContent(
  scene: ScreenplayAssemblyScene,
  fallback: ScreenplayAssemblyScene,
) {
  const content = [...scene.scene.content];
  const outputActions = content.filter((item) => item.type === "action");
  const fallbackActions = fallback.scene.content.filter(
    (item) => item.type === "action",
  );
  if (!outputActions.length) content.unshift(...fallbackActions);
  else
    fallbackActions.forEach((action, index) => {
      if (!action.actionDesign) return;
      const outputAction = outputActions[index];
      if (outputAction && !outputAction.actionDesign)
        outputAction.actionDesign = action.actionDesign;
    });

  for (const required of fallback.scene.content) {
    if (required.type === "action") continue;
    const exists = content.some((item) =>
      required.type === "dialogue"
        ? item.type === "dialogue" &&
          item.character === required.character &&
          item.lines === required.lines
        : item.type === "voiceover" &&
          item.character === required.character &&
          item.text === required.text,
    );
    if (!exists) content.push(required);
  }
  return { scene: { ...scene.scene, content } };
}

function normalizeBeatScene(
  value: unknown,
  input: {
    clipText: string;
    canonical: CanonicalContext;
  },
) {
  const scene = asRecord(value);
  if (!scene) return null;
  const heading = asRecord(scene.heading);
  const beats = normalizeBeats(
    arrayValue(scene.beats ?? scene.actions ?? scene.content),
  );
  const description = textValue(scene.description ?? scene.summary) ?? "";
  if (!beats.length && description) beats.push({ text: description });
  if (!beats.length) return null;
  const location =
    textValue(heading?.location ?? scene.location) ??
    input.canonical.locations.find((name) => input.clipText.includes(name)) ??
    input.canonical.locations[0] ??
    "未指定场景";
  return {
    heading: {
      intExt:
        enumValue(heading?.intExt ?? scene.intExt, ["INT", "EXT"] as const) ??
        inferInterior(location),
      location,
      time: textValue(heading?.time ?? scene.time) ?? "日",
    },
    description,
    characters: stringList(scene.characters).length
      ? stringList(scene.characters)
      : input.canonical.characters.filter((name) =>
          input.clipText.includes(name),
        ),
    beats,
  } satisfies ScreenplayBeatPlan["scenes"][number];
}

function fallbackBeatScene(
  beats: ScreenplayBeatPlan["scenes"][number]["beats"],
  input: { clipText: string; canonical: CanonicalContext },
) {
  const location =
    input.canonical.locations.find((name) => input.clipText.includes(name)) ??
    input.canonical.locations[0] ??
    "未指定场景";
  return {
    heading: { intExt: inferInterior(location), location, time: "日" },
    description: "",
    characters: input.canonical.characters.filter((name) =>
      input.clipText.includes(name),
    ),
    beats,
  } satisfies ScreenplayBeatPlan["scenes"][number];
}

function normalizeBeats(values: unknown[]) {
  return values
    .map((item) => {
      const record = asRecord(item);
      if (
        record &&
        textValue(record.type)?.toLowerCase() !== "action" &&
        "type" in record
      )
        return null;
      const text = textValue(
        record?.text ?? record?.action ?? record?.description ?? item,
      );
      return text ? { text } : null;
    })
    .filter(
      (item): item is ScreenplayBeatPlan["scenes"][number]["beats"][number] =>
        !!item,
    );
}

function normalizeScreenplayContent(
  value: unknown,
  fallback: ScreenplayAssemblyScene,
): ScreenplayContent | null {
  const record = asRecord(value);
  if (!record) {
    const text = textValue(value);
    return text ? { type: "action", text } : null;
  }
  const type = textValue(record.type ?? record.kind)?.toLowerCase();
  if (type === "dialogue" || type === "speech") {
    const lines = textValue(record.lines ?? record.text);
    if (!lines) return null;
    return {
      type: "dialogue",
      character:
        textValue(record.character ?? record.speaker) ??
        fallback.scene.characters[0] ??
        "未知说话人",
      parenthetical: textValue(record.parenthetical ?? record.emotion) ?? null,
      lines,
    };
  }
  if (type === "voiceover" || type === "narration" || type === "voice_over") {
    const text = textValue(record.text ?? record.lines);
    if (!text) return null;
    return {
      type: "voiceover",
      character: textValue(record.character ?? record.speaker) ?? null,
      text,
    };
  }
  const text = textValue(record.text ?? record.action ?? record.description);
  if (!text) return null;
  return {
    type: "action",
    text,
    ...(record.actionDesign
      ? {
          actionDesign: normalizeActionDesign(record.actionDesign, {
            clipText: text,
            defaultPerformer: fallback.scene.characters[0],
          }),
        }
      : {}),
  };
}

function normalizeActionDesign(
  value: unknown,
  input: { clipText: string; defaultPerformer?: string },
) {
  const design = asRecord(value);
  const plain = textValue(value);
  const choreography = stringList(
    design?.choreography ?? design?.actions ?? design?.steps,
  );
  const fallbackDescription =
    textValue(design?.description ?? design?.text) ?? plain ?? "动作效果设计";
  const evidence = stringList(design?.evidence);
  return {
    kind:
      enumValue(design?.kind, ACTION_DESIGN_KINDS) ?? ("phenomenon" as const),
    performer:
      textValue(design?.performer ?? design?.actor) ??
      input.defaultPerformer ??
      "环境",
    target: textValue(design?.target) ?? null,
    realm: textValue(design?.realm) ?? null,
    technique: textValue(design?.technique) ?? null,
    visualMotif: textValue(design?.visualMotif ?? design?.visual) ?? null,
    visualMotifSource:
      enumValue(design?.visualMotifSource, [
        "source",
        "world_bible",
        "production_inference",
      ] as const) ?? null,
    visualMotifRationale:
      textValue(design?.visualMotifRationale ?? design?.rationale) ?? null,
    choreography: choreography.length ? choreography : [fallbackDescription],
    impact: textValue(design?.impact) ?? null,
    environmentResponse: textValue(design?.environmentResponse) ?? null,
    vfxPlan: normalizeVfxCueList(design?.vfxPlan ?? design?.vfx),
    sfxPlan: normalizeSfxCueList(design?.sfxPlan ?? design?.sfx),
    evidence: evidence.length
      ? evidence
      : [input.clipText.trim().slice(0, 200) || fallbackDescription],
  };
}

function normalizeVfxCueList(value: unknown) {
  return arrayValue(value)
    .map((item) => {
      const record = asRecord(item);
      const description = textValue(
        record?.description ?? record?.text ?? item,
      );
      if (!description) return null;
      return {
        phase: enumValue(record?.phase, ACTION_PHASES) ?? "release",
        category:
          enumValue(record?.category, VFX_CUE_CATEGORIES) ??
          "environment_interaction",
        description,
      };
    })
    .filter((item): item is NonNullable<typeof item> => !!item);
}

function normalizeSfxCueList(value: unknown) {
  return arrayValue(value)
    .map((item) => {
      const record = asRecord(item);
      const description = textValue(
        record?.description ?? record?.text ?? item,
      );
      if (!description) return null;
      return {
        phase: enumValue(record?.phase, ACTION_PHASES) ?? "release",
        type: enumValue(record?.type, SFX_CUE_TYPES) ?? "environment",
        description,
      };
    })
    .filter((item): item is NonNullable<typeof item> => !!item);
}

function extractSceneContent(
  root: Record<string, unknown> | null,
  type: string,
) {
  return arrayValue(root?.scenes).flatMap((scene, sceneIndex) => {
    const record = asRecord(scene);
    return arrayValue(record?.content)
      .filter((item) => textValue(asRecord(item)?.type)?.toLowerCase() === type)
      .map((item) => ({ ...asRecord(item), sceneIndex }));
  });
}

function extractActionDesigns(root: Record<string, unknown> | null) {
  return arrayValue(root?.scenes).flatMap((scene, sceneIndex) => {
    const record = asRecord(scene);
    let beatIndex = -1;
    return arrayValue(record?.content).flatMap((item) => {
      const content = asRecord(item);
      if (textValue(content?.type)?.toLowerCase() === "action") beatIndex += 1;
      return content?.actionDesign
        ? [
            {
              sceneIndex,
              beatIndex: Math.max(0, beatIndex),
              actionDesign: content.actionDesign,
            },
          ]
        : [];
    });
  });
}

function parseSpeakerLines(value: string | null) {
  if (!value) return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([^:：]{1,40})\s*[:：]\s*(.+?)\s*$/))
    .filter((match): match is RegExpMatchArray => !!match)
    .map((match) => ({ character: match[1], lines: match[2] }));
}

function unwrapRecord(value: unknown): Record<string, unknown> | null {
  const root = asRecord(value);
  if (!root) return null;
  return (
    asRecord(root.data) ??
    asRecord(root.result) ??
    asRecord(root.output) ??
    root
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function usableText(value: unknown) {
  return (
    textValue(value)
      ?.replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "") ?? null
  );
}

function stringList(value: unknown) {
  return Array.from(
    new Set(
      arrayValue(value)
        .flatMap((item) =>
          typeof item === "string" ? item.split(/[、,，]/) : [],
        )
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 100);
}

function nonNegativeInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function nullableNonNegativeInteger(value: unknown) {
  return value === null || value === undefined || value === ""
    ? null
    : nonNegativeInteger(value);
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
): T[number] | null {
  const text = textValue(value);
  return text && values.includes(text as T[number])
    ? (text as T[number])
    : null;
}

function inferInterior(location: string): "INT" | "EXT" {
  return /房|室|殿|厅|屋|洞|车内|office|room|hall|interior/i.test(location)
    ? "INT"
    : "EXT";
}
