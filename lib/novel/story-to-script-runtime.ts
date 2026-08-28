import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import {
  requestOpenAiStructured,
  type PromptExecutionTrace,
} from "@/lib/llm/openai-structured";
import { StructuredOutputError } from "@/lib/llm/structured-output";
import { PROMPT_IDS, renderPrompt, type PromptLocale } from "@/lib/prompts";
import {
  clipSegmentationSchema,
  screenplayConversionSchema,
} from "@/lib/prompts/schemas";
import {
  buildSourceEvents,
  validateClipSegmentation,
  validateScreenplayConversion,
} from "@/lib/prompts/validators";
import {
  listProductionClips,
  listProductionProps,
  saveProductionClips,
} from "@/lib/production/domain-store";
import { loadApprovedWorldBible } from "@/lib/production/world-bible";
import { decryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import { structuredRequestOptions } from "@/lib/settings/runtime-contract";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { listNovelCharacters, listNovelLocations } from "./domain-store";
import { normalizeScreenplayDialogue } from "./screenplay-dialogue";

export type StoryToScriptStepInput = {
  projectId: string;
  episodeId: string;
  channelId: string;
  model: string;
  locale?: PromptLocale;
  sourceText?: string;
  concurrency?: number;
  resumeExisting?: boolean;
};

export type StoryToScriptRuntimeHooks = {
  assertActive: () => Promise<void>;
  persistArtifact: (
    artifactType: string,
    refId: string,
    payload: unknown,
  ) => Promise<void>;
};

type CanonicalContext = {
  characters: string[];
  locations: string[];
  props: string[];
};

type ScreenplayBatchResult = {
  clipId: string;
  clipIndex: number;
  success: boolean;
  reused: boolean;
  degraded?: boolean;
  fallbackReason?: string;
  sceneCount: number;
  trace?: PromptExecutionTrace;
  error?: string;
};

type SegmentedClip = {
  start: string;
  end: string;
  text: string;
  summary: string;
  location: string | null;
  characters: string[];
  props: string[];
};

type SourceUnit = {
  id: string;
  text: string;
};

type ModelSegmentedClip = {
  endUnitId: string;
  summary: string;
  location: string | null;
  characters: string[];
  props: string[];
};

export const MAX_SCREENPLAY_CLIP_CHARS = 1_600;

export class ScreenplayBatchError extends Error {
  constructor(readonly results: ScreenplayBatchResult[]) {
    const failed = results.filter((result) => !result.success);
    const preview = failed
      .slice(0, 3)
      .map((result) => `${result.clipId}:${result.error ?? "unknown"}`)
      .join(" | ");
    super(
      `SCREENPLAY_CONVERT_PARTIAL_FAILED:${failed.length}/${results.length}:${preview}`,
    );
  }
}

export async function splitEpisodeIntoClips(
  userId: string,
  input: StoryToScriptStepInput,
  hooks: StoryToScriptRuntimeHooks,
) {
  await hooks.assertActive();
  const context = await loadStoryContext(userId, input);
  const existing = await listProductionClips(
    userId,
    input.projectId,
    input.episodeId,
  );
  if (
    input.resumeExisting &&
    existing &&
    hasCompleteClipCoverage(context.sourceText, existing)
  ) {
    const payload = {
      clips: existing,
      degraded: false,
      fallbackReason: undefined,
      reused: true,
      promptTraces: [] as PromptExecutionTrace[],
    };
    await hooks.persistArtifact("clips.split", input.episodeId, payload);
    return { clipCount: existing.length, ...payload };
  }

  const sourceUnits = buildSourceUnits(context.sourceText);
  let segmentedClips: SegmentedClip[];
  let degraded = false;
  let fallbackReason: string | undefined;
  const promptTraces: PromptExecutionTrace[] = [];
  try {
    const result = await requestOpenAiStructured({
      ...context.provider,
      prompt: renderPrompt({
        id: PROMPT_IDS.STORY_CLIP_SEGMENTATION,
        locale: input.locale ?? "zh",
        variables: {
          source_units_json: JSON.stringify(sourceUnits),
          character_library: JSON.stringify(context.characters),
          location_library: JSON.stringify(context.locations),
          prop_library: JSON.stringify(context.props),
        },
      }),
      schema: clipSegmentationSchema,
      validate: (data) =>
        validateClipSegmentation(data, {
          sourceUnits,
          canonical: context.canonical,
        }),
    });
    segmentedClips = restoreSourceBackedClips(
      result.data.clips,
      sourceUnits,
    );
    promptTraces.push(result.trace);
  } catch (error) {
    if (!isSegmentationContractFailure(error)) throw error;
    segmentedClips = buildDeterministicClipSegmentation(
      context.sourceText,
      context.canonical,
      context.screenplayClipMaxChars,
    );
    degraded = true;
    fallbackReason = error instanceof Error ? error.message : String(error);
  }
  segmentedClips = normalizeScreenplayClipSizes(
    segmentedClips,
    context.canonical,
    context.screenplayClipMaxChars,
  );
  if (
    segmentedClips.map((clip) => clip.text).join("") !== context.sourceText
  )
    throw new Error("SOURCE_BACKFILL_COVERAGE_MISMATCH");

  await hooks.assertActive();
  const saved = await saveProductionClips(
    userId,
    input.projectId,
    input.episodeId,
    segmentedClips.map((clip, clipIndex) => ({
      clipIndex,
      summary: clip.summary,
      content: clip.text,
      startText: clip.start,
      endText: clip.end,
      characters: clip.characters,
      locations: clip.location ? [clip.location] : [],
      props: clip.props,
    })),
  );
  if (!saved) throw new Error("STORY_CLIPS_PERSIST_FAILED");

  const payload = {
    clips: saved,
    degraded,
    fallbackReason,
    reused: false,
    promptTraces,
  };
  await hooks.persistArtifact("clips.split", input.episodeId, payload);
  for (const trace of promptTraces)
    await hooks.persistArtifact("prompt.trace", input.episodeId, trace);
  return { clipCount: saved.length, ...payload };
}

export function buildDeterministicClipSegmentation(
  sourceText: string,
  canonical: CanonicalContext,
  maxChars = 1_600,
): SegmentedClip[] {
  const chunks = splitAtEditorialBoundaries(
    sourceText,
    Math.max(200, maxChars),
  );
  return chunks.map((text) => {
    const characters = canonical.characters.filter((name) =>
      text.includes(name),
    );
    const location = canonical.locations
      .map((name) => ({ name, index: text.lastIndexOf(name) }))
      .filter((item) => item.index >= 0)
      .sort((left, right) => right.index - left.index)[0]?.name;
    const props = canonical.props.filter((name) => text.includes(name));
    const excerpt = text.trim().replace(/\s+/g, " ").slice(0, 80);
    return {
      start: text.slice(0, Math.min(40, text.length)),
      end: text.slice(Math.max(0, text.length - 40)),
      text,
      summary: excerpt || "Untitled clip",
      location: location ?? null,
      characters,
      props,
    };
  });
}

export function buildSourceUnits(
  sourceText: string,
  maxUnitChars = 400,
): SourceUnit[] {
  const limit = Math.max(100, Math.floor(maxUnitChars));
  const units: string[] = [];
  let start = 0;
  let cursor = 0;
  while (cursor < sourceText.length) {
    const current = sourceText[cursor];
    const atNarrativeBoundary = /[。！？!?；;\n]/u.test(current);
    const atLengthLimit = cursor - start + 1 >= limit;
    if (!atNarrativeBoundary && !atLengthLimit) {
      cursor += 1;
      continue;
    }
    let end = cursor + 1;
    if (atNarrativeBoundary) {
      while (
        end < sourceText.length &&
        /[。！？!?；;\r\n]/u.test(sourceText[end])
      )
        end += 1;
      while (end < sourceText.length && /\s/u.test(sourceText[end])) end += 1;
    }
    units.push(sourceText.slice(start, end));
    start = end;
    cursor = end;
  }
  if (start < sourceText.length) units.push(sourceText.slice(start));
  return units.map((text, index) => ({
    id: `U${String(index + 1).padStart(4, "0")}`,
    text,
  }));
}

export function restoreSourceBackedClips(
  modelClips: readonly ModelSegmentedClip[],
  sourceUnits: readonly SourceUnit[],
): SegmentedClip[] {
  const unitIndexes = new Map(
    sourceUnits.map((unit, index) => [unit.id, index]),
  );
  let startUnitIndex = 0;
  const clips = modelClips.map((clip) => {
    const endUnitIndex = unitIndexes.get(clip.endUnitId);
    if (endUnitIndex === undefined || endUnitIndex < startUnitIndex)
      throw new ClipSegmentationBoundaryError(
        `CLIP_BOUNDARY_INVALID:${clip.endUnitId}`,
      );
    const text = sourceUnits
      .slice(startUnitIndex, endUnitIndex + 1)
      .map((unit) => unit.text)
      .join("");
    startUnitIndex = endUnitIndex + 1;
    return {
      start: text.slice(0, Math.min(40, text.length)),
      end: text.slice(Math.max(0, text.length - 40)),
      text,
      summary: clip.summary,
      location: clip.location,
      characters: clip.characters,
      props: clip.props,
    };
  });
  if (startUnitIndex !== sourceUnits.length)
    throw new ClipSegmentationBoundaryError(
      "CLIP_BOUNDARY_INCOMPLETE_SOURCE_COVERAGE",
    );
  return clips;
}

class ClipSegmentationBoundaryError extends Error {}

function isSegmentationContractFailure(error: unknown) {
  return (
    error instanceof StructuredOutputError ||
    error instanceof ClipSegmentationBoundaryError ||
    (error instanceof Error &&
      /^STRUCTURED_(?:JSON|SCHEMA|SEMANTIC)_INVALID:/.test(error.message))
  );
}

export function normalizeScreenplayClipSizes(
  clips: readonly SegmentedClip[],
  canonical: CanonicalContext,
  maxChars = MAX_SCREENPLAY_CLIP_CHARS,
) {
  const limit = Math.max(200, maxChars);
  return clips.flatMap((clip) =>
    clip.text.length <= limit
      ? [clip]
      : buildDeterministicClipSegmentation(clip.text, canonical, limit),
  );
}

function splitAtEditorialBoundaries(sourceText: string, maxChars: number) {
  if (sourceText.length <= maxChars) return [sourceText];
  const chunks: string[] = [];
  let cursor = 0;
  while (sourceText.length - cursor > maxChars) {
    const minimum = cursor + Math.floor(maxChars * 0.55);
    const maximum = cursor + maxChars;
    const window = sourceText.slice(minimum, maximum);
    let boundary = -1;
    for (const pattern of [/\n\s*\n/g, /\n/g, /[。！？!?；;]/g]) {
      for (const match of window.matchAll(pattern))
        boundary = Math.max(boundary, match.index! + match[0].length);
      if (boundary >= 0) break;
    }
    const end = boundary >= 0 ? minimum + boundary : maximum;
    chunks.push(sourceText.slice(cursor, end));
    cursor = end;
  }
  if (cursor < sourceText.length) chunks.push(sourceText.slice(cursor));
  return chunks;
}

export async function convertEpisodeClipsToScreenplays(
  userId: string,
  input: StoryToScriptStepInput,
  hooks: StoryToScriptRuntimeHooks,
) {
  await hooks.assertActive();
  const context = await loadStoryContext(userId, input);
  const clips = await listProductionClips(
    userId,
    input.projectId,
    input.episodeId,
  );
  if (!clips?.length) throw new Error("STORY_CLIPS_REQUIRED");

  const results = await mapWithConcurrency(
    clips,
    normalizeConcurrency(input.concurrency ?? context.workflowConcurrency),
    async (clip): Promise<ScreenplayBatchResult> => {
      await hooks.assertActive();
      const stored = parseReusableScreenplay(
        clip.screenplay,
        clip.id,
        clip.content,
        context.canonical,
        context.worldBibleText,
      );
      if (stored) {
        await prisma.storyClip.update({
          where: { id: clip.id },
          data: { status: "screenplay_ready" },
        });
        const reusedResult = {
          clipId: clip.id,
          clipIndex: clip.clipIndex,
          success: true,
          reused: true,
          sceneCount: stored.scenes.length,
          screenplay: stored,
        };
        await hooks.persistArtifact("screenplay.clip", clip.id, reusedResult);
        return reusedResult;
      }

      try {
        await prisma.storyClip.update({
          where: { id: clip.id },
          data: { status: "screenplay_running" },
        });
        const result = await requestOpenAiStructured({
          ...context.provider,
          prompt: renderPrompt({
            id: PROMPT_IDS.STORY_SCREENPLAY_CONVERSION,
            locale: input.locale ?? "zh",
            variables: {
              clip_id: clip.id,
              clip_text: clip.content,
              source_events_json: JSON.stringify(buildSourceEvents(clip.content)),
              character_library: JSON.stringify(context.characters),
              location_library: JSON.stringify(context.locations),
              prop_library: JSON.stringify(context.props),
              world_bible_json: context.worldBibleText,
            },
          }),
          schema: screenplayConversionSchema,
          validate: (data) =>
            validateScreenplayConversion(data, {
              clipId: clip.id,
              clipText: clip.content,
              canonical: context.canonical,
              sourceEvents: buildSourceEvents(clip.content),
              knowledgeText: context.worldBibleText,
            }),
        });
        const screenplay = normalizeScreenplayDialogue(result.data);
        const normalizationIssues = validateScreenplayConversion(screenplay, {
          clipId: clip.id,
          clipText: clip.content,
          canonical: context.canonical,
          sourceEvents: buildSourceEvents(clip.content),
          knowledgeText: context.worldBibleText,
        });
        if (normalizationIssues.length)
          throw new Error(
            `SCREENPLAY_DIALOGUE_NORMALIZATION_INVALID:${normalizationIssues.map((item) => item.code).join(",")}`,
          );
        await hooks.assertActive();
        await prisma.storyClip.update({
          where: { id: clip.id },
          data: {
            screenplay: JSON.stringify(screenplay),
            status: "screenplay_ready",
          },
        });
        const successResult = {
          clipId: clip.id,
          clipIndex: clip.clipIndex,
          success: true,
          reused: false,
          sceneCount: screenplay.scenes.length,
          screenplay,
          trace: result.trace,
        };
        await hooks.persistArtifact("screenplay.clip", clip.id, successResult);
        await hooks.persistArtifact("prompt.trace", clip.id, result.trace);
        return successResult;
      } catch (error) {
        await hooks.assertActive();
        const message = error instanceof Error ? error.message : String(error);
        await prisma.storyClip.update({
          where: { id: clip.id },
          data: { status: "screenplay_failed" },
        });
        const failedResult = {
          clipId: clip.id,
          clipIndex: clip.clipIndex,
          success: false,
          reused: false,
          sceneCount: 0,
          error: message,
        };
        await hooks.persistArtifact("screenplay.clip", clip.id, failedResult);
        return failedResult;
      }
    },
  );

  if (results.some((result) => !result.success))
    throw new ScreenplayBatchError(results);
  const promptTraces = results.flatMap((result) =>
    result.trace ? [result.trace] : [],
  );
  return {
    clipCount: results.length,
    convertedCount: results.filter((result) => !result.reused).length,
    degradedCount: results.filter((result) => result.degraded).length,
    reusedCount: results.filter((result) => result.reused).length,
    totalScenes: results.reduce((sum, result) => sum + result.sceneCount, 0),
    results,
    promptTraces,
  };
}

export function buildDeterministicScreenplay(
  clipId: string,
  clipText: string,
  canonical: CanonicalContext,
) {
  const characters = canonical.characters.filter((name) =>
    clipText.includes(name),
  );
  const location = canonical.locations
    .map((name) => ({ name, index: clipText.lastIndexOf(name) }))
    .filter((item) => item.index >= 0)
    .sort((left, right) => right.index - left.index)[0]?.name;
  return {
    clipId,
    originalText: clipText,
    coverage: buildSourceEvents(clipText).map((event) => ({
      ...event,
      modes: ["visual" as const],
      reason: null,
    })),
    scenes: [
      {
        sceneNumber: 0,
        heading: {
          intExt: /房|室|殿|厅|屋|洞|车内/.test(location ?? "")
            ? ("INT" as const)
            : ("EXT" as const),
          location: location ?? canonical.locations[0] ?? "未指定场景",
          time: "日",
        },
        description: "",
        characters,
        content: [{ type: "action" as const, text: clipText }],
      },
    ],
  };
}

export function hasCompleteClipCoverage(
  sourceText: string,
  clips: ReadonlyArray<{ clipIndex: number; content: string }>,
) {
  return (
    clips.length > 0 &&
    clips.every((clip, index) => clip.clipIndex === index) &&
    clips.map((clip) => clip.content).join("") === sourceText
  );
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let hasFatalError = false;
  let fatalError: unknown;
  const runners = Array.from(
    { length: Math.min(items.length, normalizeConcurrency(concurrency)) },
    async () => {
      while (!hasFatalError) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        try {
          results[index] = await worker(items[index], index);
        } catch (error) {
          hasFatalError = true;
          fatalError = error;
        }
      }
    },
  );
  await Promise.all(runners);
  if (hasFatalError) throw fatalError;
  return results;
}

function parseReusableScreenplay(
  value: string | null,
  clipId: string,
  clipText: string,
  canonical: CanonicalContext,
  knowledgeText: string,
) {
  if (!value) return null;
  try {
    const parsed = screenplayConversionSchema.safeParse(JSON.parse(value));
    if (!parsed.success) return null;
    const screenplay = normalizeScreenplayDialogue(parsed.data);
    return validateScreenplayConversion(screenplay, {
      clipId,
      clipText,
      canonical,
      sourceEvents: buildSourceEvents(clipText),
      knowledgeText,
    }).length
      ? null
      : screenplay;
  } catch {
    return null;
  }
}

async function loadStoryContext(userId: string, input: StoryToScriptStepInput) {
  const [
    episode,
    channel,
    configuredModel,
    characters,
    locations,
    props,
    worldBible,
    runtimeSettings,
  ] =
    await Promise.all([
      prisma.episode.findFirst({
        where: {
          id: input.episodeId,
          projectId: input.projectId,
          project: { userId },
        },
        select: { novelText: true },
      }),
      prisma.channel.findFirst({
        where: { id: input.channelId, userId },
      }),
      prisma.providerModel.findFirst({
        where: {
          channelId: input.channelId,
          modelId: input.model,
          selected: true,
        },
      }),
      listNovelCharacters(userId, input.projectId),
      listNovelLocations(userId, input.projectId),
      listProductionProps(userId, input.projectId),
      loadApprovedWorldBible(userId, input.projectId),
      loadUserRuntimeSettings(userId),
    ]);
  if (!episode) throw new Error("STORY_EPISODE_NOT_FOUND");
  if (!channel) throw new Error("STORY_CHANNEL_NOT_FOUND");
  if (!configuredModel) throw new Error("STORY_MODEL_NOT_CONFIGURED");
  if (!characters || !locations || !props)
    throw new Error("STORY_PROJECT_NOT_FOUND");
  if (
    channel.protocol !== "openai-compatible" &&
    channel.protocol !== "volcengine-ark"
  )
    throw new Error(`STORY_PROTOCOL_NOT_SUPPORTED:${channel.protocol}`);
  const apiKeys = parseApiKeys(channel.encryptedApiKeys);
  if (!apiKeys.length) throw new Error("STORY_CHANNEL_API_KEY_MISSING");
  const sourceText = input.sourceText ?? episode.novelText;
  if (!sourceText?.trim()) throw new Error("STORY_SOURCE_TEXT_REQUIRED");
  return {
    sourceText,
    characters,
    locations,
    props,
    canonical: {
      characters: characters.map((character) => character.name),
      locations: locations.map((location) => location.name),
      props: props.map((prop) => prop.name),
    },
    worldBible,
    worldBibleText: JSON.stringify(worldBible?.payload ?? {}),
    screenplayClipMaxChars: runtimeSettings.screenplayClipMaxChars,
    workflowConcurrency: runtimeSettings.workflowConcurrency,
    provider: {
      baseUrl: channel.baseUrl,
      apiKeys,
      model: input.model,
      temperature: 0.2,
      ...structuredRequestOptions(runtimeSettings),
      structuredOutputMode: supportsStoredStructuredOutputs(
        configuredModel.capabilitiesJson,
      )
        ? ("json_schema" as const)
        : ("json_object" as const),
    },
  };
}

function parseApiKeys(value: string) {
  try {
    const parsed = JSON.parse(decryptSecret(value)) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (item): item is string =>
              typeof item === "string" && Boolean(item.trim()),
          )
          .map((item) => item.trim())
      : [];
  } catch {
    return [];
  }
}

function normalizeConcurrency(value?: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(8, Math.floor(value)))
    : 3;
}
