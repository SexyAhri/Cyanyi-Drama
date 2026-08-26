import { createHash } from "node:crypto";

import { z } from "zod";

import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import {
  requestOpenAiStructured,
  type PromptExecutionTrace,
} from "@/lib/llm/openai-structured";
import { PROMPT_IDS, renderPrompt, type PromptLocale } from "@/lib/prompts";
import {
  actingDirectionSchema,
  cinematographySchema,
  continuityReviewSchema,
  screenplayConversionSchema,
  storyboardPlanningSchema,
  storyboardRefinementSchema,
} from "@/lib/prompts/schemas";
import {
  validateActingCoverage,
  validateCinematographyCoverage,
  validateContinuityReview,
  validateScreenplayConversion,
  validateStoryboardPlanning,
  validateStoryboardRefinement,
} from "@/lib/prompts/validators";
import {
  listProductionClips,
  listProductionProps,
} from "@/lib/production/domain-store";
import { decryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import {
  listNovelCharacters,
  listNovelLocations,
  saveStoryboard,
} from "./domain-store";
import { mapWithConcurrency } from "./story-to-script-runtime";

type StoryboardPlanning = z.infer<typeof storyboardPlanningSchema>;
type Cinematography = z.infer<typeof cinematographySchema>;
type ActingDirection = z.infer<typeof actingDirectionSchema>;
type StoryboardRefinement = z.infer<typeof storyboardRefinementSchema>;
type ContinuityReview = z.infer<typeof continuityReviewSchema>;
type ProductionClip = NonNullable<
  Awaited<ReturnType<typeof listProductionClips>>
>[number];

export type ScriptToStoryboardStepInput = {
  projectId: string;
  episodeId: string;
  channelId: string;
  model: string;
  locale?: PromptLocale;
  concurrency?: number;
};

export type ScriptToStoryboardRuntimeHooks = {
  assertActive: () => Promise<void>;
  persistArtifact: (
    artifactType: string,
    refId: string,
    payload: unknown,
  ) => Promise<void>;
  loadArtifact?: (
    artifactType: string,
    refId: string,
  ) => Promise<unknown | null>;
};

type CanonicalContext = {
  characters: string[];
  locations: string[];
  props: string[];
};

type StoryboardClipResult = {
  clipId: string;
  clipIndex: number;
  success: boolean;
  reusedPhases: string[];
  planning?: StoryboardPlanning;
  cinematography?: Cinematography;
  acting?: ActingDirection;
  refinement?: StoryboardRefinement;
  continuity?: ContinuityReview;
  traces?: PromptExecutionTrace[];
  error?: string;
};

type PhaseResult<T> = {
  data: T;
  reused: boolean;
  trace?: PromptExecutionTrace;
};

export class StoryboardBatchError extends Error {
  constructor(readonly results: StoryboardClipResult[]) {
    const failed = results.filter((result) => !result.success);
    const preview = failed
      .slice(0, 3)
      .map((result) => `${result.clipId}:${result.error ?? "unknown"}`)
      .join(" | ");
    super(
      `STORYBOARD_BUILD_PARTIAL_FAILED:${failed.length}/${results.length}:${preview}`,
    );
  }
}

export async function buildEpisodeStoryboard(
  userId: string,
  input: ScriptToStoryboardStepInput,
  hooks: ScriptToStoryboardRuntimeHooks,
) {
  await hooks.assertActive();
  const context = await loadStoryboardContext(userId, input);
  const results = await mapWithConcurrency(
    context.clips,
    normalizeConcurrency(input.concurrency),
    async (clip): Promise<StoryboardClipResult> => {
      try {
        const clipContext = buildClipContext(clip, context);
        await prisma.storyClip.update({
          where: { id: clip.id },
          data: { status: "storyboard_running" },
        });

        const planning = await runPlanningPhase(input, clipContext, hooks);
        const phase2 = await Promise.allSettled([
          runCinematographyPhase(input, clipContext, planning.data, hooks),
          runActingPhase(input, clipContext, planning.data, hooks),
        ]);
        const rejected = phase2.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        if (rejected) throw rejected.reason;
        const cinematography =
          phase2[0].status === "fulfilled" ? phase2[0].value : neverPhase();
        const acting =
          phase2[1].status === "fulfilled" ? phase2[1].value : neverPhase();
        const refinement = await runRefinementPhase(
          input,
          clipContext,
          planning.data,
          cinematography.data,
          acting.data,
          hooks,
        );
        const continuity = await runContinuityPhase(
          input,
          clipContext,
          refinement.data,
          hooks,
        );

        await hooks.assertActive();
        await prisma.storyClip.update({
          where: { id: clip.id },
          data: {
            status: continuity.data.passed
              ? "storyboard_ready"
              : "storyboard_continuity_warning",
            shotCount: refinement.data.panels.length,
          },
        });
        return {
          clipId: clip.id,
          clipIndex: clip.clipIndex,
          success: true,
          reusedPhases: [
            ...(planning.reused ? ["phase1"] : []),
            ...(cinematography.reused ? ["phase2.cine"] : []),
            ...(acting.reused ? ["phase2.acting"] : []),
            ...(refinement.reused ? ["phase3"] : []),
            ...(continuity.reused ? ["continuity"] : []),
          ],
          planning: planning.data,
          cinematography: cinematography.data,
          acting: acting.data,
          refinement: refinement.data,
          continuity: continuity.data,
          traces: [
            planning.trace,
            cinematography.trace,
            acting.trace,
            refinement.trace,
            continuity.trace,
          ].filter((trace): trace is PromptExecutionTrace => trace !== undefined),
        };
      } catch (error) {
        await hooks.assertActive();
        const message = error instanceof Error ? error.message : String(error);
        await prisma.storyClip.update({
          where: { id: clip.id },
          data: { status: "storyboard_failed" },
        });
        return {
          clipId: clip.id,
          clipIndex: clip.clipIndex,
          success: false,
          reusedPhases: [],
          error: message,
        };
      }
    },
  );

  if (results.some((result) => !result.success))
    throw new StoryboardBatchError(results);

  await hooks.assertActive();
  let globalPanelIndex = 0;
  const panels = results.flatMap((result) => {
    const refinement = required(result.refinement, "refinement");
    const cinematography = required(result.cinematography, "cinematography");
    const acting = required(result.acting, "acting");
    const continuity = required(result.continuity, "continuity");
    const photographyByPanel = new Map(
      cinematography.rules.map((rule) => [rule.panelIndex, rule]),
    );
    const actingByPanel = new Map(
      acting.directions.map((direction) => [direction.panelIndex, direction]),
    );
    return refinement.panels.map((panel) => ({
      clipId: result.clipId,
      clipPanelIndex: panel.panelIndex,
      panelIndex: globalPanelIndex++,
      shotType: panel.shotType,
      cameraMove: panel.cameraMove,
      description: panel.description,
      locationName: panel.locationName,
      characters: panel.characters,
      props: panel.props,
      imagePrompt: panel.imagePrompt,
      videoPrompt: panel.videoPrompt,
      phase: "continuity",
      status: continuity.passed ? "ready" : "continuity_warning",
      actingNotes: {
        characters: actingByPanel.get(panel.panelIndex)?.characters ?? [],
      },
      photographyRules: JSON.stringify(
        photographyByPanel.get(panel.panelIndex) ?? {},
      ),
      linkedToNextPanel: panel.panelIndex < refinement.panels.length - 1,
      sourceEvidence: panel.sourceEvidence,
    }));
  });
  const sourceHash = sha256(
    JSON.stringify({
      clips: context.clips.map((clip) => ({
        id: clip.id,
        screenplay: clip.screenplay,
      })),
      panels,
    }),
  );
  const storyboard = await saveStoryboard(
    userId,
    input.projectId,
    input.episodeId,
    { status: "ready", sourceHash, panels },
  );
  if (!storyboard) throw new Error("STORYBOARD_PERSIST_FAILED");
  const promptTraces = results.flatMap((result) => result.traces ?? []);
  const publicResults = results.map((result) => {
    const publicResult = { ...result };
    delete publicResult.traces;
    return publicResult;
  });

  return {
    clipCount: results.length,
    panelCount: storyboard.panels.length,
    reusedPhaseCount: results.reduce(
      (total, result) => total + result.reusedPhases.length,
      0,
    ),
    continuityIssueCount: results.reduce(
      (total, result) => total + (result.continuity?.issues.length ?? 0),
      0,
    ),
    storyboardId: storyboard.id,
    results: publicResults,
    promptTraces,
  };
}

async function runPlanningPhase(
  input: ScriptToStoryboardStepInput,
  context: ClipContext,
  hooks: ScriptToStoryboardRuntimeHooks,
) {
  const prompt = renderPrompt({
    id: PROMPT_IDS.STORY_STORYBOARD_PLANNING,
    locale: input.locale ?? "zh",
    variables: {
      source_text: context.sourceText,
      characters_json: JSON.stringify(context.characters),
      locations_json: JSON.stringify(context.locations),
      props_json: JSON.stringify(context.props),
    },
  });
  return resolvePhase({
    artifactType: "storyboard.clip.phase1",
    traceRefId: `${context.clip.id}:phase1`,
    refId: context.clip.id,
    inputHash: hashJson({
      prompt: prompt.versionHash,
      text: context.sourceText,
    }),
    schema: storyboardPlanningSchema,
    validate: (data) =>
      validateStoryboardPlanning(data, {
        sourceText: context.sourceText,
        canonical: context.canonical,
      }),
    hooks,
    request: () =>
      requestOpenAiStructured({
        ...context.provider,
        prompt,
        schema: storyboardPlanningSchema,
        validate: (data) =>
          validateStoryboardPlanning(data, {
            sourceText: context.sourceText,
            canonical: context.canonical,
          }),
      }),
  });
}

async function runCinematographyPhase(
  input: ScriptToStoryboardStepInput,
  context: ClipContext,
  planning: StoryboardPlanning,
  hooks: ScriptToStoryboardRuntimeHooks,
) {
  const prompt = renderPrompt({
    id: PROMPT_IDS.STORY_CINEMATOGRAPHY,
    locale: input.locale ?? "zh",
    variables: {
      panels_json: JSON.stringify(planning.panels),
      locations_json: JSON.stringify(context.locations),
    },
  });
  const expectedIndices = planning.panels.map((panel) => panel.panelIndex);
  return resolvePhase({
    artifactType: "storyboard.clip.phase2.cine",
    traceRefId: `${context.clip.id}:phase2.cine`,
    refId: context.clip.id,
    inputHash: hashJson({ prompt: prompt.versionHash, planning }),
    schema: cinematographySchema,
    validate: (data) => validateCinematographyCoverage(data, expectedIndices),
    hooks,
    request: () =>
      requestOpenAiStructured({
        ...context.provider,
        prompt,
        schema: cinematographySchema,
        validate: (data) =>
          validateCinematographyCoverage(data, expectedIndices),
      }),
  });
}

async function runActingPhase(
  input: ScriptToStoryboardStepInput,
  context: ClipContext,
  planning: StoryboardPlanning,
  hooks: ScriptToStoryboardRuntimeHooks,
) {
  const prompt = renderPrompt({
    id: PROMPT_IDS.STORY_ACTING_DIRECTION,
    locale: input.locale ?? "zh",
    variables: {
      panels_json: JSON.stringify(planning.panels),
      characters_json: JSON.stringify(context.characters),
    },
  });
  return resolvePhase({
    artifactType: "storyboard.clip.phase2.acting",
    traceRefId: `${context.clip.id}:phase2.acting`,
    refId: context.clip.id,
    inputHash: hashJson({ prompt: prompt.versionHash, planning }),
    schema: actingDirectionSchema,
    validate: (data) => validateActingCoverage(data, planning.panels),
    hooks,
    request: () =>
      requestOpenAiStructured({
        ...context.provider,
        prompt,
        schema: actingDirectionSchema,
        validate: (data) => validateActingCoverage(data, planning.panels),
      }),
  });
}

async function runRefinementPhase(
  input: ScriptToStoryboardStepInput,
  context: ClipContext,
  planning: StoryboardPlanning,
  cinematography: Cinematography,
  acting: ActingDirection,
  hooks: ScriptToStoryboardRuntimeHooks,
) {
  const prompt = renderPrompt({
    id: PROMPT_IDS.STORY_STORYBOARD_REFINEMENT,
    locale: input.locale ?? "zh",
    variables: {
      source_text: context.sourceText,
      panels_json: JSON.stringify(planning.panels),
      cinematography_json: JSON.stringify(cinematography.rules),
      acting_json: JSON.stringify(acting.directions),
    },
  });
  return resolvePhase({
    artifactType: "storyboard.clip.phase3",
    traceRefId: `${context.clip.id}:phase3`,
    refId: context.clip.id,
    inputHash: hashJson({
      prompt: prompt.versionHash,
      planning,
      cinematography,
      acting,
    }),
    schema: storyboardRefinementSchema,
    validate: (data) => validateStoryboardRefinement(data, planning.panels),
    hooks,
    request: () =>
      requestOpenAiStructured({
        ...context.provider,
        prompt,
        schema: storyboardRefinementSchema,
        validate: (data) => validateStoryboardRefinement(data, planning.panels),
      }),
  });
}

async function runContinuityPhase(
  input: ScriptToStoryboardStepInput,
  context: ClipContext,
  refinement: StoryboardRefinement,
  hooks: ScriptToStoryboardRuntimeHooks,
) {
  const prompt = renderPrompt({
    id: PROMPT_IDS.STORY_CONTINUITY_REVIEW,
    locale: input.locale ?? "zh",
    variables: {
      panels_json: JSON.stringify(refinement.panels),
      characters_json: JSON.stringify(context.characters),
      locations_json: JSON.stringify(context.locations),
      props_json: JSON.stringify(context.props),
    },
  });
  const panelIndices = refinement.panels.map((panel) => panel.panelIndex);
  return resolvePhase({
    artifactType: "storyboard.clip.continuity",
    traceRefId: `${context.clip.id}:continuity`,
    refId: context.clip.id,
    inputHash: hashJson({ prompt: prompt.versionHash, refinement }),
    schema: continuityReviewSchema,
    validate: (data) =>
      validateContinuityReview(data, {
        panelIndices,
        canonical: context.canonical,
      }),
    hooks,
    request: () =>
      requestOpenAiStructured({
        ...context.provider,
        prompt,
        schema: continuityReviewSchema,
        validate: (data) =>
          validateContinuityReview(data, {
            panelIndices,
            canonical: context.canonical,
          }),
      }),
  });
}

async function resolvePhase<T>(input: {
  artifactType: string;
  traceRefId: string;
  refId: string;
  inputHash: string;
  schema: z.ZodType<T>;
  validate: (data: T) => readonly unknown[];
  hooks: ScriptToStoryboardRuntimeHooks;
  request: () => Promise<{ data: T; trace: PromptExecutionTrace }>;
}): Promise<PhaseResult<T>> {
  const stored = await input.hooks.loadArtifact?.(
    input.artifactType,
    input.refId,
  );
  const reused = parsePhaseArtifact(
    stored,
    input.inputHash,
    input.schema,
    input.validate,
  );
  if (reused) return { data: reused, reused: true };

  try {
    await input.hooks.assertActive();
    const result = await input.request();
    await input.hooks.assertActive();
    await input.hooks.persistArtifact(input.artifactType, input.refId, {
      success: true,
      inputHash: input.inputHash,
      data: result.data,
    });
    await input.hooks.persistArtifact(
      "prompt.trace",
      input.traceRefId,
      result.trace,
    );
    return { data: result.data, reused: false, trace: result.trace };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await input.hooks.persistArtifact(input.artifactType, input.refId, {
      success: false,
      inputHash: input.inputHash,
      error: message,
    });
    throw error;
  }
}

function parsePhaseArtifact<T>(
  value: unknown,
  inputHash: string,
  schema: z.ZodType<T>,
  validate: (data: T) => readonly unknown[],
) {
  if (
    !isRecord(value) ||
    value.success !== true ||
    value.inputHash !== inputHash
  )
    return null;
  const parsed = schema.safeParse(value.data);
  if (!parsed.success || validate(parsed.data).length) return null;
  return parsed.data;
}

type LoadedContext = Awaited<ReturnType<typeof loadStoryboardContext>>;
type ClipContext = ReturnType<typeof buildClipContext>;

function buildClipContext(clip: ProductionClip, context: LoadedContext) {
  const screenplay = parseScreenplay(clip, context.canonical);
  const characterNames = new Set(clip.characters);
  const locationNames = new Set(clip.locations);
  const propNames = new Set(clip.props);
  return {
    clip,
    sourceText: JSON.stringify(screenplay, null, 2),
    canonical: context.canonical,
    characters: context.characters.filter(
      (item) => !characterNames.size || characterNames.has(item.name),
    ),
    locations: context.locations.filter(
      (item) => !locationNames.size || locationNames.has(item.name),
    ),
    props: context.props.filter(
      (item) => !propNames.size || propNames.has(item.name),
    ),
    provider: context.provider,
  };
}

async function loadStoryboardContext(
  userId: string,
  input: ScriptToStoryboardStepInput,
) {
  const [
    episode,
    channel,
    configuredModel,
    characters,
    locations,
    props,
    clips,
  ] = await Promise.all([
    prisma.episode.findFirst({
      where: {
        id: input.episodeId,
        projectId: input.projectId,
        project: { userId },
      },
      select: { id: true },
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
    listProductionClips(userId, input.projectId, input.episodeId),
  ]);
  if (!episode) throw new Error("STORYBOARD_EPISODE_NOT_FOUND");
  if (!channel) throw new Error("STORYBOARD_CHANNEL_NOT_FOUND");
  if (!configuredModel) throw new Error("STORYBOARD_MODEL_NOT_CONFIGURED");
  if (!characters || !locations || !props)
    throw new Error("STORYBOARD_PROJECT_NOT_FOUND");
  if (!clips?.length) throw new Error("STORYBOARD_CLIPS_REQUIRED");
  if (
    channel.protocol !== "openai-compatible" &&
    channel.protocol !== "volcengine-ark"
  )
    throw new Error(`STORYBOARD_PROTOCOL_NOT_SUPPORTED:${channel.protocol}`);
  const apiKeys = parseApiKeys(channel.encryptedApiKeys);
  if (!apiKeys.length) throw new Error("STORYBOARD_CHANNEL_API_KEY_MISSING");
  return {
    characters: characters.map((character) => ({
      name: character.name,
      aliases: character.aliases,
      profile: character.profile,
      introduction: character.introduction,
    })),
    locations: locations.map((location) => ({
      name: location.name,
      summary: location.summary,
    })),
    props: props.map((prop) => ({
      name: prop.name,
      summary: prop.summary,
      metadata: prop.metadata,
    })),
    clips,
    canonical: {
      characters: characters.map((character) => character.name),
      locations: locations.map((location) => location.name),
      props: props.map((prop) => prop.name),
    },
    provider: {
      baseUrl: channel.baseUrl,
      apiKeys,
      model: input.model,
      temperature: 0.2,
      structuredOutputMode: supportsStoredStructuredOutputs(
        configuredModel.capabilitiesJson,
      )
        ? ("json_schema" as const)
        : ("json_object" as const),
    },
  };
}

function parseScreenplay(clip: ProductionClip, canonical: CanonicalContext) {
  if (!clip.screenplay)
    throw new Error(`STORYBOARD_SCREENPLAY_REQUIRED:${clip.id}`);
  try {
    const parsed = screenplayConversionSchema.safeParse(
      JSON.parse(clip.screenplay),
    );
    if (
      !parsed.success ||
      validateScreenplayConversion(parsed.data, {
        clipId: clip.id,
        clipText: clip.content,
        canonical,
      }).length
    )
      throw new Error("invalid screenplay");
    return parsed.data;
  } catch {
    throw new Error(`STORYBOARD_SCREENPLAY_INVALID:${clip.id}`);
  }
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

function required<T>(value: T | undefined, phase: string): T {
  if (value === undefined) throw new Error(`STORYBOARD_PHASE_MISSING:${phase}`);
  return value;
}

function neverPhase(): never {
  throw new Error("STORYBOARD_PHASE_SETTLEMENT_INVALID");
}

function normalizeConcurrency(value?: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(8, Math.floor(value)))
    : 3;
}

function hashJson(value: unknown) {
  return sha256(JSON.stringify(value));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
