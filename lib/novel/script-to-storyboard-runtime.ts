import { createHash } from "node:crypto";

import { z } from "zod";

import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import {
  getStoryWorldDirective,
  loadProjectAssetStoryWorldContext,
} from "@/lib/assets/story-world";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import {
  isRetryableStructuredProviderError,
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
  buildSourceEvents,
  estimateSpeechDurationSeconds,
  normalizeActingDirectionContract,
  normalizeCinematographyContract,
  normalizeReusableScreenplaySourceContract,
  normalizeStoryboardPlanningContract,
  normalizeStoryboardRefinementContract,
  sameStoryboardCharacterSet,
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
import { loadApprovedWorldBible } from "@/lib/production/world-bible";
import { getProjectArtStyleDirective } from "@/lib/projects/art-style";
import { decryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import { structuredRequestOptions } from "@/lib/settings/runtime-contract";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import {
  listNovelCharacters,
  listNovelLocations,
  saveStoryboard,
} from "./domain-store";
import {
  normalizeStoryboardDialogueTiming,
  STORYBOARD_DIALOGUE_TIMING_VERSION,
} from "./storyboard-dialogue-timing";
import { normalizeScreenplayDialogue } from "./screenplay-dialogue";
import { mapWithConcurrency } from "./story-to-script-runtime";

type StoryboardPlanning = z.infer<typeof storyboardPlanningSchema>;
type Cinematography = z.infer<typeof cinematographySchema>;
type ActingDirection = z.infer<typeof actingDirectionSchema>;
type StoryboardRefinement = z.infer<typeof storyboardRefinementSchema>;
type ContinuityReview = z.infer<typeof continuityReviewSchema>;
type ScreenplayActionDesign = NonNullable<
  Extract<
    z.infer<typeof screenplayConversionSchema>["scenes"][number]["content"][number],
    { type: "action" }
  >["actionDesign"]
>;
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
  degraded?: boolean;
  fallbackReason?: string;
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
    normalizeConcurrency(input.concurrency ?? context.workflowConcurrency),
    async (clip): Promise<StoryboardClipResult> => {
      let clipContext: ClipContext | undefined;
      try {
        clipContext = buildClipContext(clip, context);
        const fallbackInputHash = storyboardFallbackInputHash(clipContext);
        await prisma.storyClip.update({
          where: { id: clip.id },
          data: { status: "storyboard_running" },
        });
        const storedFallback = await hooks.loadArtifact?.(
          "storyboard.clip.fallback",
          clip.id,
        );
        const reusableFallback = parseStoryboardFallbackArtifact(
          storedFallback,
          fallbackInputHash,
          clipContext,
        );
        if (reusableFallback) {
          await prisma.storyClip.update({
            where: { id: clip.id },
            data: {
              status: "storyboard_ready",
              shotCount: reusableFallback.phases.refinement.panels.length,
            },
          });
          return {
            clipId: clip.id,
            clipIndex: clip.clipIndex,
            success: true,
            reusedPhases: ["fallback"],
            degraded: true,
            fallbackReason: reusableFallback.fallbackReason,
            ...reusableFallback.phases,
          };
        }

        const planning = await runPlanningPhase(input, clipContext, hooks);
        const phase2 = await Promise.allSettled([
          runCinematographyPhase(input, clipContext, planning.data, hooks),
          runActingPhase(input, clipContext, planning.data, hooks),
        ]);
        const rejected = phase2.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected" &&
            !isRetryableStructuredProviderError(result.reason),
        ) ?? phase2.find(
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
        let failure = error;
        if (
          clipContext &&
          (isRetryableStructuredProviderError(error) ||
            isStructuredModelContractError(error))
        ) {
          const fallback = buildDeterministicStoryboardPhases(clipContext);
          const fallbackIssues = validateStoryboardPlanning(
            fallback.planning,
            {
              sourceText: clipContext.sourceText,
              canonical: clipContext.canonical,
              screenplay: clipContext.screenplay,
            },
          );
          if (!fallbackIssues.length) {
            const fallbackReason = structuredProviderFailureCode(error);
            await hooks.persistArtifact(
              "storyboard.clip.fallback",
              clip.id,
              {
                success: true,
                degraded: true,
                inputHash: storyboardFallbackInputHash(clipContext),
                fallbackReason,
                data: fallback,
              },
            );
            await prisma.storyClip.update({
              where: { id: clip.id },
              data: {
                status: "storyboard_ready",
                shotCount: fallback.refinement.panels.length,
              },
            });
            return {
              clipId: clip.id,
              clipIndex: clip.clipIndex,
              success: true,
              reusedPhases: [],
              degraded: true,
              fallbackReason,
              ...fallback,
            };
          }
          failure = new Error(
            `STORYBOARD_FALLBACK_INVALID:${fallbackIssues
              .map((issue) => issue.code)
              .join(",")}`,
          );
        }
        const message =
          failure instanceof Error ? failure.message : String(failure);
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
  const rawPanels = results.flatMap((result) => {
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
    return refinement.panels.map((panel, panelOffset) => ({
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
      videoPrompt: formatMotionTimelinePrompt(
        panel,
        actingByPanel.get(panel.panelIndex)?.characters ?? [],
      ),
      durationSeconds: panel.durationSeconds,
      sceneNumber: panel.sceneNumber ?? null,
      speakingCharacter: panel.speakingCharacter ?? null,
      lipSyncText: panel.lipSyncText ?? null,
      voiceoverText: panel.voiceoverText ?? null,
      startState: panel.startState,
      endState: panel.endState,
      motionBeats: panel.motionTimeline,
      worldContext: panel.worldContext ?? {},
      vfxCues: panel.vfxCues ?? [],
      sfxCues: panel.sfxCues ?? [],
      phase: "continuity",
      status: continuity.passed ? "ready" : "continuity_warning",
      actingNotes: {
        characters: actingByPanel.get(panel.panelIndex)?.characters ?? [],
      },
      photographyRules: JSON.stringify(
        photographyByPanel.get(panel.panelIndex) ?? {},
      ),
      linkedToNextPanel:
        refinement.panels[panelOffset + 1]?.sceneNumber === panel.sceneNumber,
      sourceEvidence: panel.sourceEvidence,
    }));
  });
  const panels = stitchStoryboardClipBoundaries(rawPanels);
  const sourceHash = sha256(
    JSON.stringify({
      clips: context.clips.map((clip) => ({
        id: clip.id,
        screenplay: clip.screenplay,
      })),
      panels,
    }),
  );
  const reviewRequired =
    results.some((result) => (result.continuity?.issues.length ?? 0) > 0) ||
    context.clips.some((clip) => hasReviewableInference(clip.screenplay));
  const storyboard = await saveStoryboard(
    userId,
    input.projectId,
    input.episodeId,
    {
      status: reviewRequired ? "review_required" : "ready",
      sourceHash,
      panels,
    },
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
    degradedCount: results.filter((result) => result.degraded).length,
    reusedPhaseCount: results.reduce(
      (total, result) => total + result.reusedPhases.length,
      0,
    ),
    continuityIssueCount: results.reduce(
      (total, result) => total + (result.continuity?.issues.length ?? 0),
      0,
    ),
    storyboardId: storyboard.id,
    reviewRequired,
    results: publicResults,
    promptTraces,
  };
}

type StitchableStoryboardPanel = {
  clipId: string | null | undefined;
  locationName: string | null | undefined;
  characters: string[];
  startState?: StoryboardPlanning["panels"][number]["startState"];
  endState?: StoryboardPlanning["panels"][number]["endState"];
  linkedToNextPanel: boolean;
};

export function stitchStoryboardClipBoundaries<
  T extends StitchableStoryboardPanel,
>(panels: readonly T[]): T[] {
  const stitched = panels.map((panel, index) => {
    const previous = panels[index - 1];
    if (!isContinuousClipBoundary(previous, panel) || !previous.endState)
      return { ...panel } as T;
    return {
      ...panel,
      startState: { ...previous.endState },
    } as T;
  });
  return stitched.map(
    (panel, index) =>
      ({
        ...panel,
        linkedToNextPanel:
          panel.linkedToNextPanel ||
          isContinuousClipBoundary(panel, stitched[index + 1]),
      }) as T,
  );
}

function isContinuousClipBoundary(
  previous: StitchableStoryboardPanel | undefined,
  current: StitchableStoryboardPanel | undefined,
) {
  return Boolean(
    previous &&
      current &&
      previous.clipId !== current.clipId &&
      previous.locationName &&
      previous.locationName === current.locationName &&
      sameStoryboardCharacterSet(previous.characters, current.characters),
  );
}

async function runPlanningPhase(
  input: ScriptToStoryboardStepInput,
  context: ClipContext,
  hooks: ScriptToStoryboardRuntimeHooks,
) {
  const validationContext = {
    sourceText: context.sourceText,
    canonical: context.canonical,
    screenplay: context.screenplay,
    productionContextText: storyboardProductionContextText(context),
  };
  const prompt = renderPrompt({
    id: PROMPT_IDS.STORY_STORYBOARD_PLANNING,
    locale: input.locale ?? "zh",
    variables: {
      source_text: context.sourceText,
      characters_json: JSON.stringify(context.characters),
      locations_json: JSON.stringify(context.locations),
      props_json: JSON.stringify(context.props),
      world_bible_json: context.worldBibleText,
      project_style: context.projectStyleDirective,
      story_world_directive: context.storyWorldDirective,
      continuity_anchor_json: context.continuityAnchorText,
    },
  });
  const normalize = (data: StoryboardPlanning) =>
    normalizeStoryboardDialogueTiming(
      normalizeStoryboardPlanningContract(data, validationContext),
    );
  return resolvePhase({
    artifactType: "storyboard.clip.phase1",
    traceRefId: `${context.clip.id}:phase1`,
    refId: context.clip.id,
    inputHash: hashJson({
      prompt: prompt.versionHash,
      text: context.sourceText,
      characters: context.characters,
      locations: context.locations,
      props: context.props,
      worldBible: context.worldBibleText,
      projectStyle: context.projectStyleDirective,
      storyWorld: context.storyWorldDirective,
      continuityAnchor: context.continuityAnchorText,
      dialogueTimingVersion: STORYBOARD_DIALOGUE_TIMING_VERSION,
    }),
    schema: storyboardPlanningSchema,
    normalize,
    validate: (data) => validateStoryboardPlanning(data, validationContext),
    hooks,
    request: () =>
      requestOpenAiStructured({
        ...context.provider,
        prompt,
        schema: storyboardPlanningSchema,
        normalizeRaw: normalizeStoryboardPlanningProviderPayload,
        validate: (data) =>
          validateStoryboardPlanning(normalize(data), validationContext).filter(
            (issue) => issue.code !== "DIALOGUE_DURATION_OVERFLOW",
          ),
      }),
  });
}

export function normalizeStoryboardPlanningProviderPayload(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.panels)) return value;
  return {
    ...value,
    panels: value.panels.map((panel) => {
      if (!isRecord(panel)) return panel;
      return {
        ...panel,
        startState: normalizeStoryboardContinuityStatePayload(
          panel.startState,
        ),
        endState: normalizeStoryboardContinuityStatePayload(panel.endState),
      };
    }),
  };
}

function normalizeStoryboardContinuityStatePayload(value: unknown) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.props) ||
    !value.props.every((item) => typeof item === "string")
  )
    return value;
  const props = value.props.map((item) => item.trim()).filter(Boolean);
  return { ...value, props: props.join("、") || "无" };
}

function storyboardProductionContextText(context: ClipContext) {
  return [
    context.projectStyleDirective,
    context.storyWorldDirective,
    context.continuityAnchorText,
    context.worldBibleText,
    JSON.stringify(context.characters),
    JSON.stringify(context.locations),
    JSON.stringify(context.props),
  ].join("\n");
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
      project_style: context.projectStyleDirective,
      story_world_directive: context.storyWorldDirective,
    },
  });
  const expectedIndices = planning.panels.map((panel) => panel.panelIndex);
  const normalize = (data: Cinematography) =>
    normalizeCinematographyContract(data, planning.panels);
  return resolvePhase({
    artifactType: "storyboard.clip.phase2.cine",
    traceRefId: `${context.clip.id}:phase2.cine`,
    refId: context.clip.id,
    inputHash: hashJson({
      prompt: prompt.versionHash,
      planning,
      locations: context.locations,
      projectStyle: context.projectStyleDirective,
      storyWorld: context.storyWorldDirective,
    }),
    schema: cinematographySchema,
    normalize,
    validate: (data) => validateCinematographyCoverage(data, expectedIndices),
    hooks,
    request: () =>
      requestOpenAiStructured({
        ...context.provider,
        prompt,
        schema: cinematographySchema,
        validate: (data) =>
          validateCinematographyCoverage(normalize(data), expectedIndices),
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
      world_bible_json: context.worldBibleText,
      continuity_anchor_json: context.continuityAnchorText,
    },
  });
  const normalize = (data: ActingDirection) =>
    normalizeActingDirectionContract(data, planning.panels);
  return resolvePhase({
    artifactType: "storyboard.clip.phase2.acting",
    traceRefId: `${context.clip.id}:phase2.acting`,
    refId: context.clip.id,
    inputHash: hashJson({
      prompt: prompt.versionHash,
      planning,
      characters: context.characters,
      worldBible: context.worldBibleText,
      continuityAnchor: context.continuityAnchorText,
    }),
    schema: actingDirectionSchema,
    normalize,
    validate: (data) => validateActingCoverage(data, planning.panels),
    hooks,
    request: () =>
      requestOpenAiStructured({
        ...context.provider,
        prompt,
        schema: actingDirectionSchema,
        validate: (data) =>
          validateActingCoverage(normalize(data), planning.panels),
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
      production_design_json: storyboardProductionContextText(context),
    },
  });
  const normalize = (data: StoryboardRefinement) =>
    normalizeStoryboardRefinementContract(data, planning.panels);
  return resolvePhase({
    artifactType: "storyboard.clip.phase3",
    traceRefId: `${context.clip.id}:phase3`,
    refId: context.clip.id,
    inputHash: hashJson({
      prompt: prompt.versionHash,
      planning,
      cinematography,
      acting,
      productionDesign: storyboardProductionContextText(context),
    }),
    schema: storyboardRefinementSchema,
    normalize,
    validate: (data) => validateStoryboardRefinement(data, planning.panels),
    hooks,
    request: () =>
      requestOpenAiStructured({
        ...context.provider,
        prompt,
        schema: storyboardRefinementSchema,
        normalizeRaw: normalizeStoryboardRefinementProviderPayload,
        validate: (data) =>
          validateStoryboardRefinement(normalize(data), planning.panels),
      }),
  });
}

export function normalizeStoryboardRefinementProviderPayload(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.panels)) return value;
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("clipId") ||
    !keys.includes("panels")
  )
    return value;
  const normalized = { ...value };
  delete normalized.clipId;
  return normalized;
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
      project_style: context.projectStyleDirective,
      story_world_directive: context.storyWorldDirective,
      continuity_anchor_json: context.continuityAnchorText,
    },
  });
  const panelIndices = refinement.panels.map((panel) => panel.panelIndex);
  return resolvePhase({
    artifactType: "storyboard.clip.continuity",
    traceRefId: `${context.clip.id}:continuity`,
    refId: context.clip.id,
    inputHash: hashJson({
      prompt: prompt.versionHash,
      refinement,
      characters: context.characters,
      locations: context.locations,
      props: context.props,
      projectStyle: context.projectStyleDirective,
      storyWorld: context.storyWorldDirective,
      continuityAnchor: context.continuityAnchorText,
    }),
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
  normalize?: (data: T) => T;
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
    input.normalize,
    input.validate,
  );
  if (reused) return { data: reused, reused: true };

  try {
    await input.hooks.assertActive();
    const result = await input.request();
    await input.hooks.assertActive();
    const parsed = input.schema.parse(result.data);
    const data = input.schema.parse(input.normalize?.(parsed) ?? parsed);
    if (input.validate(data).length)
      throw new Error("STRUCTURED_OUTPUT_NORMALIZATION_FAILED");
    await input.hooks.persistArtifact(input.artifactType, input.refId, {
      success: true,
      inputHash: input.inputHash,
      data,
    });
    await input.hooks.persistArtifact(
      "prompt.trace",
      input.traceRefId,
      result.trace,
    );
    return { data, reused: false, trace: result.trace };
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
  normalize: ((data: T) => T) | undefined,
  validate: (data: T) => readonly unknown[],
) {
  if (
    !isRecord(value) ||
    value.success !== true ||
    value.inputHash !== inputHash
  )
    return null;
  const parsed = schema.safeParse(value.data);
  if (!parsed.success) return null;
  const normalized = schema.safeParse(normalize?.(parsed.data) ?? parsed.data);
  if (!normalized.success || validate(normalized.data).length) return null;
  return normalized.data;
}

type LoadedContext = Awaited<ReturnType<typeof loadStoryboardContext>>;
type ClipContext = ReturnType<typeof buildClipContext>;

function buildClipContext(clip: ProductionClip, context: LoadedContext) {
  const screenplay = parseScreenplay(
    clip,
    context.canonical,
    context.worldBibleText,
  );
  const screenplayCharacterNames = Array.from(
    new Set(
      screenplay.scenes.flatMap((scene) => [
        ...scene.characters,
        ...scene.content.flatMap((content) =>
          content.type !== "action" && content.character
            ? [content.character]
            : [],
        ),
      ]),
    ),
  );
  const characterNames = new Set([
    ...clip.characters,
    ...screenplayCharacterNames,
  ]);
  const locationNames = new Set(clip.locations);
  const propNames = new Set(clip.props);
  const characters = context.characters.filter(
    (item) => !characterNames.size || characterNames.has(item.name),
  );
  const knownCharacterNames = new Set(characters.map((item) => item.name));
  const temporaryCharacters = screenplayCharacterNames
    .filter((name) => !knownCharacterNames.has(name))
    .map((name) => ({
      name,
      aliases: [],
      profile: {},
      visualProfile: undefined,
      introduction: null,
    }));
  const continuityAnchorText = JSON.stringify(
    buildClipContinuityAnchor(clip, context),
  );
  return {
    clip,
    screenplay,
    sourceText: JSON.stringify(screenplay, null, 2),
    canonical: {
      ...context.canonical,
      characters: Array.from(
        new Set([...context.canonical.characters, ...screenplayCharacterNames]),
      ),
    },
    characters: [...characters, ...temporaryCharacters],
    locations: context.locations.filter(
      (item) => !locationNames.size || locationNames.has(item.name),
    ),
    props: context.props.filter(
      (item) => !propNames.size || propNames.has(item.name),
    ),
    provider: context.provider,
    worldBibleText: context.worldBibleText,
    projectStyleDirective: context.projectStyleDirective,
    storyWorldDirective: context.storyWorldDirective,
    continuityAnchorText,
  };
}

function buildClipContinuityAnchor(
  clip: ProductionClip,
  context: LoadedContext,
) {
  const index = context.clips.findIndex((item) => item.id === clip.id);
  const previousClip = context.clips[index - 1];
  const nextClip = context.clips[index + 1];
  return {
    previousEpisodeEnding:
      index === 0 ? context.previousEpisodeEnding : null,
    previousClip: previousClip
      ? {
          clipIndex: previousClip.clipIndex,
          summary: previousClip.summary,
          endingSource: textBoundary(previousClip.content, "end"),
        }
      : null,
    currentClip: {
      clipIndex: clip.clipIndex,
      summary: clip.summary,
      openingSource: textBoundary(clip.content, "start"),
      endingSource: textBoundary(clip.content, "end"),
    },
    nextClip: nextClip
      ? {
          clipIndex: nextClip.clipIndex,
          summary: nextClip.summary,
          openingSource: textBoundary(nextClip.content, "start"),
        }
      : null,
    policy:
      "Use prior ending only as the opening-state anchor when narrative time and location continue; canonical visual profiles never reset, while weather, damage, ownership, pose, and other episode state change only when the supplied story does so.",
  };
}

function textBoundary(value: string, edge: "start" | "end") {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= 500) return text;
  return edge === "start" ? `${text.slice(0, 500)}...` : `...${text.slice(-500)}`;
}

export function buildDeterministicStoryboardPhases(
  context: Pick<
    ClipContext,
    "clip" | "screenplay" | "sourceText" | "canonical" | "props"
  >,
) {
  const panelDrafts = context.screenplay.scenes.flatMap((scene) => {
    const contentSegments = scene.content.flatMap((item) => {
      const value = item.type === "dialogue" ? item.lines : item.text;
      const chunks = splitFallbackShotText(
        value,
        item.type === "action" && item.actionDesign ? 220 : 48,
      );
      return chunks.map((text, chunkIndex) => ({
        characters:
          item.type === "dialogue" || item.type === "voiceover"
            ? item.character
              ? [item.character]
              : []
            : scene.characters.filter((name) => text.includes(name)),
        kind: item.type,
        text,
        actionDesign:
          item.type === "action" && chunkIndex === 0
            ? item.actionDesign
            : undefined,
      }));
    });
    const segments = contentSegments.length
      ? contentSegments
      : splitFallbackShotText(scene.description).map((text) => ({
          characters: scene.characters.filter((name) => text.includes(name)),
          kind: "action" as const,
          text,
          actionDesign: undefined,
        }));
    return (segments.length
      ? segments
      : [
          {
            characters: scene.characters,
            kind: "action" as const,
            text: `${scene.heading.location}中的剧情画面`,
            actionDesign: undefined,
          },
        ]
    ).map((segment) => ({ scene, segment }));
  });
  const panels: StoryboardPlanning["panels"] = panelDrafts.map(
    ({ scene, segment }, panelIndex) => {
      const characters = segment.characters.length
        ? segment.characters
        : scene.characters;
      const props = context.props
        .map((prop) => prop.name)
        .filter(
          (name) =>
            context.canonical.props.includes(name) &&
            isVisualPropMentioned(segment.text, name),
        );
      const evidence = [
        segment.text,
        scene.heading.location,
        ...characters,
        context.screenplay.clipId,
      ].find((value) => Boolean(value) && context.sourceText.includes(value));
      const coverageEvidence = (context.screenplay.coverage ?? [])
        .filter(
          (event) =>
            !event.modes.includes("omitted") &&
            (event.evidence.includes(segment.text) ||
              segment.text.includes(event.evidence)),
        )
        .map((event) => event.evidence);
      const description = compactShotDescription(segment.text);
      const actionDesign = segment.actionDesign;
      const characterLabel = characters.join("、") || "环境";
      const spokenText =
        segment.kind === "dialogue" || segment.kind === "voiceover"
          ? segment.text
          : null;
      const durationSeconds = spokenText
        ? Math.min(15, estimateSpeechDurationSeconds(spokenText))
        : actionDesign
          ? Math.max(
              fallbackShotDuration(description),
              Math.min(15, actionDesign.choreography.length),
            )
          : fallbackShotDuration(description);
      const cameraMove =
        segment.kind === "dialogue" || segment.kind === "voiceover"
          ? "从稳定中景缓慢推近，保持人物视线方向连续"
          : "稳定跟随主体动作，沿动作方向轻缓移动";
      return {
        panelIndex,
        sceneNumber: scene.sceneNumber,
        shotType: characters.length > 1 ? "全景" : "中景",
        cameraMove,
        durationSeconds,
        startState: fallbackContinuityState(characters, props),
        endState: fallbackContinuityState(characters, props),
        speakingCharacter:
          segment.kind === "dialogue" ? characters[0] ?? null : null,
        lipSyncText: segment.kind === "dialogue" ? segment.text : null,
        voiceoverText: segment.kind === "voiceover" ? segment.text : null,
        motionTimeline: actionDesign
          ? buildFallbackActionTimeline(
              actionDesign,
              description,
              durationSeconds,
              cameraMove,
            )
          : buildFallbackMotionTimeline(
              description,
              durationSeconds,
              cameraMove,
            ),
        worldContext: actionDesign
          ? fallbackActionWorldContext(actionDesign)
          : undefined,
        vfxCues: actionDesign
          ? buildFallbackVfxCues(actionDesign, durationSeconds)
          : [],
        sfxCues: actionDesign
          ? buildFallbackSfxCues(actionDesign, durationSeconds)
          : [],
        description,
        locationName: scene.heading.location,
        characters: [...characters],
        props,
        imagePrompt: `${scene.heading.intExt} ${scene.heading.location}，${scene.heading.time}，${characterLabel}，${description}，电影级构图，统一角色设定与光影`,
        videoPrompt: `镜头保持场景与角色连续性，表现：${description}`,
        sourceEvidence: [
          ...new Set([
            evidence ?? context.screenplay.clipId,
            ...coverageEvidence,
          ]),
        ],
      };
    },
  );
  panels.forEach((panel, index) => {
    const previous = panels[index - 1];
    if (
      previous?.sceneNumber === panel.sceneNumber &&
      sameStoryboardCharacterSet(previous.characters, panel.characters) &&
      previous.endState &&
      panel.startState
    )
      panel.startState = {
        ...panel.startState,
        hands: previous.endState.hands,
        screenDirection: previous.endState.screenDirection,
        props: previous.endState.props,
        characterStates: previous.endState.characterStates,
        propStates: previous.endState.propStates,
        environmentState: previous.endState.environmentState,
      };
  });
  const planning = normalizeStoryboardPlanningContract(
    normalizeStoryboardDialogueTiming({ panels }),
    {
      sourceText: context.sourceText,
      screenplay: context.screenplay,
    },
  );
  const cinematography: Cinematography = {
    rules: planning.panels.map((panel) => ({
      panelIndex: panel.panelIndex,
      camera: panel.shotType ?? "中景",
      cameraPosition: "平视，主体正前方",
      focalLength: panel.shotType === "全景" ? "35mm" : "50mm",
      lighting: "遵循场景时间的自然主光，保持人物轮廓清晰",
      composition: "主体位于视觉重心，预留动作与视线空间",
      depthOfField: panel.shotType === "全景" ? "中等景深" : "浅景深",
      colorTone: "统一场景色温与电影级对比度",
      cameraStart: {
        position: "主体正前方并遵守既定轴线",
        height: "平视高度",
        angle: "平视",
        shotSize: panel.shotType ?? "中景",
        composition: "主体位于视觉重心并保留动作空间",
        focus: panel.speakingCharacter ?? panel.characters[0] ?? "主要剧情对象",
      },
      cameraPath: {
        primaryMovement:
          panel.speakingCharacter || panel.voiceoverText
            ? ("push" as const)
            : ("track" as const),
        direction: panel.speakingCharacter ? "缓慢向主体推进" : "沿主体动作方向",
        speed: "均匀克制",
        distance: "仅覆盖本镜构图变化所需距离",
        stabilization: "稳定器，保持画面轴线与地平线",
        focusChange: "持续锁定当前叙事主体",
      },
      cameraEnd: {
        shotSize: panel.speakingCharacter ? "近景" : panel.shotType ?? "中景",
        composition: "收住动作结果与角色反应，保持剪辑匹配点",
        focus: panel.speakingCharacter ?? panel.characters[0] ?? "动作结果",
        nextCutPoint: panel.worldContext?.shotIntent?.endBeat ?? panel.description,
      },
    })),
  };
  const acting: ActingDirection = {
    directions: planning.panels.map((panel) => ({
      panelIndex: panel.panelIndex,
      characters: panel.characters.map((name) => ({
        name,
        emotion: "遵循当前剧情情绪",
        action: "按剧本动作自然表演",
        expression: "细腻克制，保持角色连续性",
        performancePriority:
          panel.speakingCharacter === name
            ? ("primary" as const)
            : panel.motionTimeline.some((beat) => beat.target === name)
              ? ("reaction" as const)
              : ("background" as const),
        allowedMicroMotion:
          "仅允许与情绪和动作因果一致的呼吸、眨眼、视线、手指和重心微动",
        evidence: [
          panel.sourceEvidence[0] ??
            panel.motionTimeline[0]?.action ??
            panel.description,
        ],
        beats: [
          {
            startSecond: 0,
            endSecond: panel.durationSeconds,
            objective: "完成本镜已经确定的动作与反应",
            subtext: null,
            trigger:
              panel.motionTimeline.find(
                (beat) => beat.actor === name || beat.target === name,
              )?.trigger ?? "承接本镜起始状态与上一角色反应",
            microPause: "在意图形成或受力反馈后保留短暂停顿，不冻结表演",
            breath: "呼吸节奏随情绪张力和发力阶段连续变化",
            weightShift: "重心随准备、发力、接触和收势连续转移",
            action:
              panel.motionTimeline
                .filter(
                  (beat) =>
                    beat.actor === name || beat.target === name || !beat.actor,
                )
                .map((beat) => beat.action)
                .join("；") || "保持与本镜动作连续的自然表演",
            expression: "按动作因果保持视线、呼吸与表情连续",
            gazeTarget:
              panel.motionTimeline.find((beat) => beat.actor === name)?.target ?? null,
            reactionTo:
              panel.motionTimeline.find(
                (beat) => beat.target === name && beat.actor !== name,
              )?.beatId ?? null,
            evidence: [
              panel.sourceEvidence[0] ??
                panel.motionTimeline[0]?.action ??
                panel.description,
            ],
          },
        ],
      })),
    })),
  };
  const refinement: StoryboardRefinement = {
    panels: planning.panels.map((panel) => ({ ...panel })),
  };
  const continuity: ContinuityReview = { passed: true, issues: [] };
  return { planning, cinematography, acting, refinement, continuity };
}

function formatMotionTimelinePrompt(
  panel: StoryboardRefinement["panels"][number],
  actingDirections: ActingDirection["directions"][number]["characters"],
) {
  const beats = panel.motionTimeline.map(
    (beat) =>
      `${beat.startSecond}-${beat.endSecond}s | 节拍：${beat.beatId ?? "普通动作"} | 触发：${beat.trigger ?? "承接上一状态"} | 施动者：${beat.actor ?? "未指定"} | 目标：${beat.target ?? "无"} | 准备：${beat.preparation ?? "按动作建立姿态"} | 发力来源：${beat.forceSource ?? "按角色重心与肢体动力链"} | 肢体/道具：${[beat.bodyPart, beat.prop].filter(Boolean).join("+") || "未指定"} | 动作：${beat.action} | 编舞步骤：${beat.choreographyStep ?? "普通动作"} | 轨迹：${beat.trajectory ?? "按动作描述"} | 接触：${beat.contact ?? "none"}${beat.contactPoint ? `@${beat.contactPoint}` : ""} | 接触材质：${beat.contactMaterial ?? "无实体接触"} | 反应：${beat.reaction ?? "无明确接触反应"} | 结果：${beat.result ?? "保持本节拍既定结果"} | 收势：${beat.settle ?? "稳定到结束状态"} | 因果前项：${beat.causedBy ?? "无"} | 镜头：${beat.camera}`,
  );
  const world = panel.worldContext
    ? [
        panel.worldContext.realm ? `境界：${panel.worldContext.realm}` : "",
        panel.worldContext.technique
          ? `功法/招式：${panel.worldContext.technique}`
          : "",
        panel.worldContext.powerRule
          ? `能力规则：${panel.worldContext.powerRule}`
          : "",
        panel.worldContext.visualMotif
          ? `跨集特效视觉母题：${panel.worldContext.visualMotif}`
          : "",
        panel.worldContext.environmentScale
          ? `场景尺度：${panel.worldContext.environmentScale}`
          : "",
      ].filter(Boolean)
    : [];
  const vfx = (panel.vfxCues ?? []).map(
    (cue) =>
      `${cue.atSecond}s | ${cue.phase} | ${cue.category} | ${cue.description}`,
  );
  const sfx = (panel.sfxCues ?? []).map(
    (cue) =>
      `${cue.startSecond}-${cue.endSecond}s | ${cue.type} | ${cue.description}`,
  );
  const performance = actingDirections.map(
    (direction) =>
      `${direction.name} | 表演优先级：${direction.performancePriority ?? "primary"} | 允许微动作：${direction.allowedMicroMotion ?? "仅限剧情支持的呼吸、眨眼、视线和重心变化"} | 心理与情绪：${direction.emotion} | 动作与反应：${direction.action} | 表情变化：${direction.expression}${direction.beats?.length ? ` | 分拍表演：${direction.beats.map((beat) => `${beat.startSecond}-${beat.endSecond}s 触发=${beat.trigger ?? "承接上一状态"} 目标=${beat.objective} 潜台词=${beat.subtext ?? "无"} 微停顿=${beat.microPause ?? "无额外停顿"} 呼吸=${beat.breath ?? "连续自然"} 重心=${beat.weightShift ?? "随动作连续"} 动作=${beat.action} 表情=${beat.expression} 视线=${beat.gazeTarget ?? "未指定"} 反应于=${beat.reactionTo ?? "无"}`).join("；")}` : ""}`,
  );
  return [
    `总时长：${panel.durationSeconds}s`,
    `整体运镜：${panel.cameraMove}`,
    `连续动作：${panel.videoPrompt}`,
    "关键动作节拍：",
    ...beats,
    ...(performance.length
      ? [
          "角色表演与心理外化：",
          ...performance,
          "表演要求：除非指导明确要求面无表情，否则角色必须通过视线焦点与转移、眨眼节奏、呼吸深浅、眉眼嘴角、下颌张力、手部微动作和重心变化持续外化心理活动；动作前有意图，动作中有情绪阻力，动作后有余韵或对他人的无声反应。不得新增剧情事实或夸张表演。",
        ]
      : []),
    ...(world.length ? ["世界观与战力约束：", ...world] : []),
    ...(vfx.length ? ["VFX 时间点：", ...vfx] : []),
    ...(sfx.length ? ["环境声与动作音效时间点：", ...sfx] : []),
    "连续性：保持角色身份、服装、姿态、视线、运动方向、速度、场景空间和镜头轨迹前后连贯，无跳帧、瞬移或动作重置。",
    "音频边界：视频只生成环境声和动作音效，禁止角色对白、旁白、喊叫、吟唱或其他可辨识人声；角色配音由独立声音模型生成后合成。",
  ].join("\n");
}

function buildFallbackMotionTimeline(
  description: string,
  durationSeconds: number,
  cameraMove: string,
) {
  const beatCount = durationSeconds <= 4 ? 1 : durationSeconds <= 9 ? 2 : 3;
  return Array.from({ length: beatCount }, (_, index) => {
    const startSecond = Math.floor((durationSeconds * index) / beatCount);
    const endSecond = Math.floor((durationSeconds * (index + 1)) / beatCount);
    return {
      startSecond,
      endSecond,
      action:
        index === 0
          ? `从已建立的姿态开始表现：${description}`
          : index === beatCount - 1
            ? `连续完成并收束：${description}`
            : `沿上一节拍的姿态与方向推进：${description}`,
      camera:
        index === beatCount - 1
          ? "保持轴线与构图连续并自然停稳"
          : `${cameraMove}，承接上一节拍的机位与速度`,
    };
  });
}

function buildFallbackActionTimeline(
  design: ScreenplayActionDesign,
  description: string,
  durationSeconds: number,
  cameraMove: string,
) {
  const actions = design.choreography.length
    ? design.choreography.slice(0, durationSeconds)
    : [description];
  const phases = [
    ...design.vfxPlan.map((cue) => cue.phase),
    ...design.sfxPlan.map((cue) => cue.phase),
  ];
  return actions.map((action, index) => ({
    startSecond: Math.floor((durationSeconds * index) / actions.length),
    endSecond: Math.floor((durationSeconds * (index + 1)) / actions.length),
    action,
    beatId: `B${String(index + 1).padStart(3, "0")}`,
    actor: design.performer,
    target: design.target ?? null,
    bodyPart: "完成该编舞步骤所需的主要肢体动作链",
    prop: null,
    trigger:
      index > 0
        ? `承接B${String(index).padStart(3, "0")}的动作结果`
        : `由起始姿态和动作意图触发：${action}`,
    preparation: `建立完成该编舞步骤所需的距离、重心与预备姿态：${action}`,
    forceSource: `${design.performer}通过核心重心与主要发力肢体传递力量`,
    trajectory: `沿既定动作方向连续完成：${action}`,
    contact:
      design.target && index === actions.length - 1
        ? ("strike" as const)
        : ("none" as const),
    contactPoint:
      design.target && index === actions.length - 1
        ? "既定命中或接触区域"
        : null,
    contactMaterial:
      design.target && index === actions.length - 1
        ? "按施动肢体、服装、目标身体或道具的既定材质表现接触"
        : null,
    reaction:
      design.target && index === actions.length - 1
        ? design.impact ?? `${design.target}按既定剧情产生可见受力或防御反馈`
        : null,
    result:
      index === actions.length - 1
        ? design.impact ?? design.environmentResponse ?? action
        : action,
    settle:
      index === actions.length - 1
        ? `在${design.impact ?? design.environmentResponse ?? action}后保持可见余势并稳定到结束状态`
        : `完成本步骤后保持方向与惯性，连续进入下一动作`,
    causedBy:
      index > 0 ? `B${String(index).padStart(3, "0")}` : null,
    choreographyStep: action,
    camera:
      index === actions.length - 1
        ? "保持轴线并收住动作结果与环境反馈"
        : `${cameraMove}，连续跟随动作因果`,
    ...(phases[index] ? { phase: phases[index] } : {}),
  }));
}

function fallbackActionWorldContext(design: ScreenplayActionDesign) {
  return {
    realm: design.realm ?? null,
    technique: design.technique ?? null,
    powerRule:
      [design.impact, design.environmentResponse].filter(Boolean).join("；") ||
      null,
    visualMotif: design.visualMotif ?? null,
    environmentScale: design.environmentResponse ?? null,
    evidence: design.evidence,
  };
}

function buildFallbackVfxCues(
  design: ScreenplayActionDesign,
  durationSeconds: number,
) {
  return design.vfxPlan.map((cue, index) => ({
    atSecond: fallbackCueSecond(index, design.vfxPlan.length, durationSeconds),
    phase: cue.phase,
    category: cue.category,
    description: design.visualMotif
      ? `${cue.description}；严格执行视觉母题：${design.visualMotif}`
      : cue.description,
    evidence: design.evidence,
  }));
}

function buildFallbackSfxCues(
  design: ScreenplayActionDesign,
  durationSeconds: number,
) {
  const plans = design.sfxPlan.length
    ? design.sfxPlan
    : [
        {
          phase: "anticipation" as const,
          type: "foley" as const,
          description: design.choreography[0] ?? "动作衣料与重心变化",
        },
      ];
  return plans.map((cue, index) => {
    const startSecond = fallbackCueSecond(index, plans.length, durationSeconds);
    return {
      startSecond,
      endSecond: Math.min(durationSeconds, startSecond + 1),
      type: cue.type,
      description: cue.description,
      evidence: design.evidence,
    };
  });
}

function fallbackCueSecond(
  index: number,
  count: number,
  durationSeconds: number,
) {
  return Math.min(
    Math.max(0, durationSeconds - 1),
    Math.floor((durationSeconds * (index + 1)) / Math.max(1, count + 1)),
  );
}

function fallbackContinuityState(characters: string[], props: string[]) {
  return {
    body: characters.length ? `${characters.join("、")}保持当前站位` : "环境空镜",
    hands: "手部占用保持与剧本动作一致",
    gaze: "视线沿当前叙事对象保持",
    screenDirection: "保持当前画面运动方向与轴线",
    props: props.length ? `${props.join("、")}状态保持` : "无关键道具变化",
    characterStates: characters.map((name) => ({
      name,
      position: "保持本镜已建立的空间位置",
      posture: "保持与当前动作阶段一致的身体姿态",
      facing: "保持当前运动方向与轴线",
      gazeTarget: null,
      leftHand: "按剧本动作保持左手占用",
      rightHand: "按剧本动作保持右手占用",
      contact: null,
    })),
    propStates: props.map((name) => ({
      name,
      holder: null,
      position: "保持本镜已建立的位置",
      state: "保持当前剧情状态",
    })),
    environmentState: {
      keyLightSource: "沿用场景已建立的主光源",
      lightDirection: "保持场景已建立的光线方向",
      weather: "保持剧本与连续性锚点已建立的天气",
      windDirection: null,
      damageState: [],
      particles: [],
      ambientAudioKey: "保持本场景已建立的环境底噪",
    },
  };
}

function fallbackShotDuration(description: string) {
  return Math.max(3, Math.min(15, Math.ceil(description.length / 12)));
}

function splitFallbackShotText(value: string, maxLength = 48) {
  const sentences = value
    .split(/(?<=[。！？!?；;\n])/u)
    .filter((sentence) => Boolean(sentence.trim()));
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      if (current) chunks.push(current);
      current = "";
      for (let start = 0; start < sentence.length; start += maxLength)
        chunks.push(sentence.slice(start, start + maxLength));
      continue;
    }
    if (current && current.length + sentence.length > maxLength) {
      chunks.push(current);
      current = sentence;
    } else current += sentence;
  }
  if (current) chunks.push(current);
  return chunks;
}

function storyboardFallbackInputHash(
  context: Pick<ClipContext, "sourceText" | "canonical">,
) {
  return hashJson({
    fallbackVersion: 6,
    dialogueTimingVersion: STORYBOARD_DIALOGUE_TIMING_VERSION,
    sourceText: context.sourceText,
    canonical: context.canonical,
  });
}

function isVisualPropMentioned(text: string, canonicalName: string) {
  if (text.includes(canonicalName)) return true;
  const suffix = canonicalName.trim().slice(-2);
  return suffix.length === 2 && text.includes(suffix);
}

function compactShotDescription(value: string, maxLength = 240) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const window = normalized.slice(0, maxLength);
  const boundary = Math.max(
    window.lastIndexOf("。"),
    window.lastIndexOf("！"),
    window.lastIndexOf("？"),
    window.lastIndexOf("."),
    window.lastIndexOf("!"),
    window.lastIndexOf("?"),
  );
  const end = boundary >= Math.floor(maxLength / 2) ? boundary + 1 : maxLength;
  return `${window.slice(0, end).trim()}...`;
}

function parseStoryboardFallbackArtifact(
  value: unknown,
  inputHash: string,
  context: Pick<ClipContext, "sourceText" | "canonical" | "screenplay">,
) {
  if (
    !isRecord(value) ||
    value.success !== true ||
    value.degraded !== true ||
    value.inputHash !== inputHash ||
    typeof value.fallbackReason !== "string" ||
    !isRecord(value.data)
  )
    return null;
  const planning = storyboardPlanningSchema.safeParse(value.data.planning);
  const cinematography = cinematographySchema.safeParse(
    value.data.cinematography,
  );
  const acting = actingDirectionSchema.safeParse(value.data.acting);
  const refinement = storyboardRefinementSchema.safeParse(
    value.data.refinement,
  );
  const continuity = continuityReviewSchema.safeParse(value.data.continuity);
  if (
    !planning.success ||
    !cinematography.success ||
    !acting.success ||
    !refinement.success ||
    !continuity.success
  )
    return null;
  const panelIndices = planning.data.panels.map((panel) => panel.panelIndex);
  if (
    validateStoryboardPlanning(planning.data, context).length ||
    validateCinematographyCoverage(cinematography.data, panelIndices).length ||
    validateActingCoverage(acting.data, planning.data.panels).length ||
    validateStoryboardRefinement(refinement.data, planning.data.panels).length ||
    validateContinuityReview(continuity.data, {
      panelIndices,
      canonical: context.canonical,
    }).length
  )
    return null;
  return {
    fallbackReason: value.fallbackReason,
    phases: {
      planning: planning.data,
      cinematography: cinematography.data,
      acting: acting.data,
      refinement: refinement.data,
      continuity: continuity.data,
    },
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
    worldBible,
    runtimeSettings,
  ] = await Promise.all([
    prisma.episode.findFirst({
      where: {
        id: input.episodeId,
        projectId: input.projectId,
        project: { userId },
      },
      select: {
        id: true,
        name: true,
        description: true,
        novelText: true,
        episodeNumber: true,
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
    listProductionClips(userId, input.projectId, input.episodeId),
    loadApprovedWorldBible(userId, input.projectId),
    loadUserRuntimeSettings(userId),
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
  const [storyWorld, previousEpisodeEnding] = await Promise.all([
    loadProjectAssetStoryWorldContext({
      userId,
      projectId: input.projectId,
      assetName: "",
      assetFacts: {
        episodeName: episode.name,
        episodeDescription: episode.description,
        episodeSource: episode.novelText,
        clips: clips.map((clip) => ({
          summary: clip.summary,
          content: clip.content,
        })),
      },
    }),
    loadPreviousEpisodeEnding(input.projectId, episode.episodeNumber),
  ]);
  const locale = input.locale === "en" ? "en" : "zh";
  const artStyle = episode.project.config?.artStyle;
  return {
    characters: characters.map((character) => ({
      name: character.name,
      aliases: character.aliases,
      profile: character.profile,
      visualProfile: character.visualProfile,
      introduction: character.introduction,
    })),
    locations: locations.map((location) => ({
      name: location.name,
      summary: location.summary,
      visualProfile: location.visualProfile,
    })),
    props: props.map((prop) => ({
      name: prop.name,
      summary: prop.summary,
      metadata: prop.metadata,
      visualProfile: prop.visualProfile,
    })),
    worldBible,
    worldBibleText: JSON.stringify(worldBible?.payload ?? {}),
    workflowConcurrency: runtimeSettings.workflowConcurrency,
    previousEpisodeEnding,
    projectStyleDirective: getProjectArtStyleDirective(artStyle, locale),
    storyWorldDirective: getStoryWorldDirective(storyWorld.lock, locale),
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
      ...structuredRequestOptions(runtimeSettings),
      structuredOutputMode: supportsStoredStructuredOutputs(
        configuredModel.capabilitiesJson,
      )
        ? ("json_schema" as const)
        : ("json_object" as const),
    },
  };
}

async function loadPreviousEpisodeEnding(
  projectId: string,
  episodeNumber: number,
) {
  const previous = await prisma.episode.findFirst({
    where: { projectId, episodeNumber: { lt: episodeNumber } },
    orderBy: { episodeNumber: "desc" },
    select: {
      id: true,
      episodeNumber: true,
      name: true,
      description: true,
      storyboard: {
        select: {
          status: true,
          panels: {
            orderBy: { panelIndex: "desc" },
            take: 1,
            select: {
              panelIndex: true,
              description: true,
              locationName: true,
              charactersJson: true,
              propsJson: true,
              endStateJson: true,
              worldContextJson: true,
            },
          },
        },
      },
    },
  });
  const panel = previous?.storyboard?.panels[0];
  if (!previous || !panel) return null;
  return {
    episodeId: previous.id,
    episodeNumber: previous.episodeNumber,
    episodeName: previous.name,
    episodeSummary: previous.description,
    storyboardStatus: previous.storyboard?.status ?? null,
    finalPanel: {
      panelIndex: panel.panelIndex,
      description: panel.description,
      locationName: panel.locationName,
      characters: parseStoredJson(panel.charactersJson, []),
      props: parseStoredJson(panel.propsJson, []),
      endState: parseStoredJson(panel.endStateJson, {}),
      worldContext: parseStoredJson(panel.worldContextJson, {}),
    },
  };
}

function parseStoredJson<T>(value: string | null, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function parseScreenplay(
  clip: ProductionClip,
  canonical: CanonicalContext,
  knowledgeText: string,
) {
  if (!clip.screenplay)
    throw new Error(`STORYBOARD_SCREENPLAY_REQUIRED:${clip.id}`);
  try {
    const parsed = screenplayConversionSchema.safeParse(
      JSON.parse(clip.screenplay),
    );
    if (!parsed.success) throw new Error("invalid screenplay");
    const sourceEvents = buildSourceEvents(clip.content);
    const screenplay = normalizeScreenplayDialogue(
      normalizeReusableScreenplaySourceContract(parsed.data, {
        clipId: clip.id,
        clipText: clip.content,
        sourceEvents,
        knowledgeText,
      }),
    );
    if (
      validateScreenplayConversion(screenplay, {
        clipId: clip.id,
        clipText: clip.content,
        canonical,
        sourceEvents,
        knowledgeText,
      }).length
    )
      throw new Error("invalid screenplay");
    return screenplay;
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

function structuredProviderFailureCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const contract = message.match(
    /^(STRUCTURED_(?:JSON|SCHEMA|SEMANTIC)_INVALID):/,
  )?.[1];
  if (contract) return contract;
  const status = message.match(/^STRUCTURED_PROVIDER_FAILED:(\d{3}):/)?.[1];
  if (status) return `PROVIDER_HTTP_${status}`;
  if (message.startsWith("STRUCTURED_PROVIDER_TIMEOUT:"))
    return "PROVIDER_TIMEOUT";
  return "PROVIDER_TEMPORARY_FAILURE";
}

function isStructuredModelContractError(error: unknown) {
  return (
    error instanceof Error &&
    /^STRUCTURED_(?:JSON|SCHEMA|SEMANTIC)_INVALID:/.test(error.message)
  );
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
  return sha256(JSON.stringify(stableJsonValue(value)));
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableJsonValue(value[key])]),
  );
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasReviewableInference(value: string | null) {
  if (!value) return false;
  try {
    const parsed = screenplayConversionSchema.safeParse(JSON.parse(value));
    return parsed.success && parsed.data.scenes.some((scene) =>
      scene.content.some(
        (content) => content.type === "action" && content.origin === "inferred",
      ),
    );
  } catch {
    return false;
  }
}
