import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import {
  parseEpisodeProductionPlan,
  type EpisodeProductionContractSubset,
  type EpisodeProductionPlan,
} from "@/lib/episodes/production-plan";
import {
  getStoryWorldDirective,
  loadProjectAssetStoryWorldContext,
} from "@/lib/assets/story-world";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import type { PromptExecutionTrace } from "@/lib/llm/openai-structured";
import type { PromptLocale } from "@/lib/prompts";
import {
  listProductionClips,
  listProductionProps,
  saveProductionClips,
} from "@/lib/production/domain-store";
import { loadApprovedWorldBible } from "@/lib/production/world-bible";
import { extractProjectEffectLibrary } from "@/lib/production/effect-library";
import { getProjectArtStyleDirective } from "@/lib/projects/art-style";
import { decryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import { structuredRequestOptions } from "@/lib/settings/runtime-contract";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { listNovelCharacters, listNovelLocations } from "./domain-store";
import { loadPreviousEpisodeHandoff } from "./episode-continuity";
import { splitApprovedScreenplayScenes } from "./approved-screenplay-parser";

export { extractProjectEffectLibrary } from "@/lib/production/effect-library";

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
  loadRunArtifact?: (
    artifactType: string,
    refId: string,
  ) => Promise<unknown | null>;
};

type CanonicalContext = {
  characters: string[];
  locations: string[];
  props: string[];
};

type SegmentedClip = {
  start: string;
  end: string;
  text: string;
  summary: string;
  location: string | null;
  characters: string[];
  props: string[];
  productionBeatIds?: string[];
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

export async function splitEpisodeIntoClips(
  userId: string,
  input: StoryToScriptStepInput,
  hooks: StoryToScriptRuntimeHooks,
) {
  await hooks.assertActive();
  const context = await loadLocalScreenplayContext(userId, input);
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

  let segmentedClips: SegmentedClip[];
  const degraded = false;
  const fallbackReason: string | undefined = undefined;
  const promptTraces: PromptExecutionTrace[] = [];
  segmentedClips = buildApprovedScreenplayClipSegmentation(
    context.sourceText,
    context.canonical,
  );
  segmentedClips = normalizeScreenplayClipSizes(
    segmentedClips,
    context.canonical,
    context.screenplayClipMaxChars,
  );
  if (segmentedClips.map((clip) => clip.text).join("") !== context.sourceText)
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

export function buildApprovedScreenplayClipSegmentation(
  sourceText: string,
  canonical: CanonicalContext,
): SegmentedClip[] {
  return splitApprovedScreenplayScenes(sourceText).map((text) => {
    const characters = canonical.characters.filter((name) => text.includes(name));
    const location = canonical.locations
      .map((name) => ({ name, index: text.lastIndexOf(name) }))
      .filter((item) => item.index >= 0)
      .sort((left, right) => right.index - left.index)[0]?.name;
    const props = canonical.props.filter((name) => text.includes(name));
    const action = text.match(
      /(?:^|\n)\s*(?:\*{1,2}|_{1,2})?\s*(?:画面与动作|画面动作|动作|visual and action|action)\s*[：:]\s*(?:\*{1,2}|_{1,2})?\s*([^\n]+)/iu,
    )?.[1];
    const excerpt = (action ?? text).trim().replace(/\s+/gu, " ").slice(0, 80);
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

export function buildBeatAwareClipSegmentation(
  sourceText: string,
  plan: EpisodeProductionPlan,
  canonical: CanonicalContext,
  maxChars = MAX_SCREENPLAY_CLIP_CHARS,
): SegmentedClip[] {
  const spans = resolveProductionBeatSpans(sourceText, plan);
  const limit = Math.max(200, maxChars);
  const groups: (typeof spans)[] = [];
  let current: typeof spans = [];
  for (const span of spans) {
    const currentLength = current.length
      ? current.at(-1)!.end - current[0].start
      : 0;
    const nextLength = currentLength + (span.end - span.start);
    if (current.length && nextLength > limit) {
      groups.push(current);
      current = [];
    }
    current.push(span);
  }
  if (current.length) groups.push(current);
  return groups.map((group) => {
    const text = sourceText.slice(group[0].start, group.at(-1)!.end);
    const characters = canonical.characters.filter((name) =>
      text.includes(name),
    );
    const props = canonical.props.filter((name) => text.includes(name));
    return {
      start: text.slice(0, Math.min(40, text.length)),
      end: text.slice(Math.max(0, text.length - 40)),
      text,
      summary: group.map((span) => span.beat.purpose).join(" / "),
      location: group.at(-1)!.beat.location,
      characters,
      props,
      productionBeatIds: group.map((span) => span.beat.beatId),
    };
  });
}

function resolveProductionBeatSpans(
  sourceText: string,
  plan: EpisodeProductionPlan,
) {
  const spans: Array<{
    beat: EpisodeProductionPlan["beats"][number];
    start: number;
    end: number;
  }> = [];
  let cursor = 0;
  for (const beat of plan.beats) {
    const markerStart = sourceText.indexOf(beat.adaptedStartMarker, cursor);
    if (markerStart < 0 || sourceText.slice(cursor, markerStart).trim())
      throw new Error(`PRODUCTION_BEAT_START_MISMATCH:${beat.beatId}`);
    const markerEnd = sourceText.indexOf(beat.adaptedEndMarker, markerStart);
    if (markerEnd < markerStart)
      throw new Error(`PRODUCTION_BEAT_END_MISMATCH:${beat.beatId}`);
    const end = markerEnd + beat.adaptedEndMarker.length;
    spans.push({ beat, start: cursor, end });
    cursor = end;
  }
  if (!spans.length || sourceText.slice(cursor).trim())
    throw new Error("PRODUCTION_BEAT_SOURCE_COVERAGE_MISMATCH");
  spans.at(-1)!.end = sourceText.length;
  return spans;
}

export function buildClipProductionContracts(
  sourceText: string,
  clips: ReadonlyArray<{ id: string; content: string }>,
  plan: EpisodeProductionPlan,
) {
  const spans = resolveProductionBeatSpans(sourceText, plan);
  const result = new Map<string, EpisodeProductionContractSubset>();
  let cursor = 0;
  for (const clip of clips) {
    const start = cursor;
    const end = start + clip.content.length;
    cursor = end;
    const beats = spans.filter(
      (span) => span.start >= start && span.end <= end,
    );
    if (!beats.length || beats[0].start !== start || beats.at(-1)!.end !== end)
      throw new Error(`PRODUCTION_CLIP_BEAT_ALIGNMENT_MISMATCH:${clip.id}`);
    const beatIds = new Set(beats.map((span) => span.beat.beatId));
    result.set(clip.id, {
      beats: beats.map((span) => span.beat),
      dialoguePlan: plan.dialoguePlan.filter((line) =>
        beatIds.has(line.beatId),
      ),
      narrationPlan: plan.narrationPlan.filter((line) =>
        beatIds.has(line.beatId),
      ),
    });
  }
  if (cursor !== sourceText.length)
    throw new Error("PRODUCTION_CLIP_SOURCE_COVERAGE_MISMATCH");
  return result;
}

class ClipSegmentationBoundaryError extends Error {}

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

export async function loadStoryContext(
  userId: string,
  input: StoryToScriptStepInput,
) {
  const [
    episode,
    channel,
    configuredModel,
    characters,
    locations,
    props,
    worldBible,
    effectLibrary,
    runtimeSettings,
  ] = await Promise.all([
    prisma.episode.findFirst({
      where: {
        id: input.episodeId,
        projectId: input.projectId,
        project: { userId },
      },
      select: {
        episodeNumber: true,
        name: true,
        description: true,
        novelText: true,
        activeSourceId: true,
        sourceVersions: {
          select: { id: true, content: true, productionPlan: true },
        },
        project: {
          select: { config: { select: { artStyle: true } } },
        },
      },
    }),
    prisma.channel.findFirst({
      where: accessibleChannelWhere(userId, input.channelId),
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
    loadProjectEffectLibrary(input.projectId),
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
  const activeSource = episode.sourceVersions?.find(
    (source) => source.id === episode.activeSourceId,
  );
  const productionPlan =
    activeSource?.content === sourceText
      ? parseEpisodeProductionPlan(activeSource.productionPlan)
      : null;
  const storyWorld = await loadProjectAssetStoryWorldContext({
    userId,
    projectId: input.projectId,
    assetName: "",
    assetFacts: {
      episodeName: episode.name,
      episodeDescription: episode.description,
      episodeSource: sourceText,
      effectLibrary,
    },
  });
  const previousEpisodeHandoff = await loadPreviousEpisodeHandoff(
    input.projectId,
    episode.episodeNumber,
  );
  const locale = input.locale === "en" ? "en" : "zh";
  const projectStyleDirective = getProjectArtStyleDirective(
    episode.project?.config?.artStyle,
    locale,
  );
  const storyWorldDirective = getStoryWorldDirective(storyWorld.lock, locale);
  const worldBibleText = JSON.stringify(worldBible?.payload ?? {});
  return {
    sourceText,
    productionPlan,
    characters,
    locations,
    props,
    canonical: {
      characters: characters.map((character) => character.name),
      locations: locations.map((location) => location.name),
      props: props.map((prop) => prop.name),
    },
    worldBible,
    worldBibleText,
    effectLibrary,
    previousEpisodeHandoff,
    projectStyleDirective,
    storyWorldDirective,
    productionKnowledgeText: [
      worldBibleText,
      JSON.stringify(effectLibrary),
      projectStyleDirective,
      storyWorldDirective,
      productionPlan ? JSON.stringify(productionPlan) : "",
    ].join("\n"),
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

export async function loadLocalScreenplayContext(
  userId: string,
  input: Pick<StoryToScriptStepInput, "projectId" | "episodeId" | "sourceText">,
) {
  const [episode, characters, locations, props, runtimeSettings] =
    await Promise.all([
      prisma.episode.findFirst({
        where: {
          id: input.episodeId,
          projectId: input.projectId,
          project: { userId },
        },
        select: { novelText: true },
      }),
      listNovelCharacters(userId, input.projectId),
      listNovelLocations(userId, input.projectId),
      listProductionProps(userId, input.projectId),
      loadUserRuntimeSettings(userId),
    ]);
  if (!episode) throw new Error("STORY_EPISODE_NOT_FOUND");
  if (!characters || !locations || !props)
    throw new Error("STORY_PROJECT_NOT_FOUND");
  const sourceText = input.sourceText ?? episode.novelText;
  if (!sourceText?.trim()) throw new Error("STORY_SOURCE_TEXT_REQUIRED");
  return {
    sourceText,
    canonical: {
      characters: characters.map((character) => character.name),
      locations: locations.map((location) => location.name),
      props: props.map((prop) => prop.name),
    },
    workflowConcurrency: runtimeSettings.workflowConcurrency,
    screenplayClipMaxChars: runtimeSettings.screenplayClipMaxChars,
  };
}

async function loadProjectEffectLibrary(projectId: string) {
  const clips = await prisma.storyClip.findMany({
    where: { projectId, screenplay: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { screenplay: true },
  });
  return extractProjectEffectLibrary(clips.map((clip) => clip.screenplay));
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
