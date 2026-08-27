import { createHash } from "node:crypto";

import { z } from "zod";

import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
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
    normalizeConcurrency(input.concurrency),
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
        if (clipContext && isRetryableStructuredProviderError(error)) {
          const fallback = buildDeterministicStoryboardPhases(clipContext);
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
      videoPrompt: formatMotionTimelinePrompt(panel),
      durationSeconds: panel.durationSeconds,
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
    screenplay,
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

export function buildDeterministicStoryboardPhases(
  context: Pick<
    ClipContext,
    "clip" | "screenplay" | "sourceText" | "canonical" | "props"
  >,
) {
  const panelDrafts = context.screenplay.scenes.flatMap((scene) => {
    const contentSegments = scene.content.flatMap((item) => {
      const value = item.type === "dialogue" ? item.lines : item.text;
      return splitFallbackShotText(value).map((text) => ({
        characters:
          item.type === "dialogue" || item.type === "voiceover"
            ? item.character
              ? [item.character]
              : []
            : scene.characters.filter((name) => text.includes(name)),
        kind: item.type,
        text,
      }));
    });
    const segments = contentSegments.length
      ? contentSegments
      : splitFallbackShotText(scene.description).map((text) => ({
          characters: scene.characters.filter((name) => text.includes(name)),
          kind: "action" as const,
          text,
        }));
    return (segments.length
      ? segments
      : [
          {
            characters: scene.characters,
            kind: "action" as const,
            text: `${scene.heading.location}中的剧情画面`,
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
      const description = compactShotDescription(segment.text);
      const characterLabel = characters.join("、") || "环境";
      const durationSeconds = fallbackShotDuration(description);
      const cameraMove =
        segment.kind === "dialogue" || segment.kind === "voiceover"
          ? "从稳定中景缓慢推近，保持人物视线方向连续"
          : "稳定跟随主体动作，沿动作方向轻缓移动";
      return {
        panelIndex,
        shotType: characters.length > 1 ? "全景" : "中景",
        cameraMove,
        durationSeconds,
        motionTimeline: buildFallbackMotionTimeline(
          description,
          durationSeconds,
          cameraMove,
        ),
        description,
        locationName: scene.heading.location,
        characters: [...characters],
        props,
        imagePrompt: `${scene.heading.intExt} ${scene.heading.location}，${scene.heading.time}，${characterLabel}，${description}，电影级构图，统一角色设定与光影`,
        videoPrompt: `镜头保持场景与角色连续性，表现：${description}`,
        sourceEvidence: [evidence ?? context.screenplay.clipId],
      };
    },
  );
  const planning: StoryboardPlanning = { panels };
  const cinematography: Cinematography = {
    rules: panels.map((panel) => ({
      panelIndex: panel.panelIndex,
      camera: panel.shotType ?? "中景",
      cameraPosition: "平视，主体正前方",
      focalLength: panel.shotType === "全景" ? "35mm" : "50mm",
      lighting: "遵循场景时间的自然主光，保持人物轮廓清晰",
      composition: "主体位于视觉重心，预留动作与视线空间",
      depthOfField: panel.shotType === "全景" ? "中等景深" : "浅景深",
      colorTone: "统一场景色温与电影级对比度",
    })),
  };
  const acting: ActingDirection = {
    directions: panels.map((panel) => ({
      panelIndex: panel.panelIndex,
      characters: panel.characters.map((name) => ({
        name,
        emotion: "遵循当前剧情情绪",
        action: "按剧本动作自然表演",
        expression: "细腻克制，保持角色连续性",
      })),
    })),
  };
  const refinement: StoryboardRefinement = {
    panels: panels.map((panel) => ({ ...panel })),
  };
  const continuity: ContinuityReview = { passed: true, issues: [] };
  return { planning, cinematography, acting, refinement, continuity };
}

function formatMotionTimelinePrompt(
  panel: StoryboardRefinement["panels"][number],
) {
  const beats = panel.motionTimeline.map(
    (beat) =>
      `${beat.startSecond}-${beat.endSecond}s | 动作：${beat.action} | 镜头：${beat.camera}`,
  );
  return [
    `总时长：${panel.durationSeconds}s`,
    `整体运镜：${panel.cameraMove}`,
    `连续动作：${panel.videoPrompt}`,
    "逐秒节拍：",
    ...beats,
    "连续性：保持角色身份、服装、姿态、视线、运动方向、速度、场景空间和镜头轨迹前后连贯，无跳帧、瞬移或动作重置。",
  ].join("\n");
}

function buildFallbackMotionTimeline(
  description: string,
  durationSeconds: number,
  cameraMove: string,
) {
  return Array.from({ length: durationSeconds }, (_, second) => ({
    startSecond: second,
    endSecond: second + 1,
    action:
      second === 0
        ? `建立主体、环境和初始姿态，开始表现：${description}`
        : second === 1
          ? `主体从上一秒姿态自然启动动作：${description}`
        : second === durationSeconds - 1
          ? `完成并收束动作：${description}，保持姿态与视线连续`
          : `动作按上一秒的方向和速度连续推进：${description}`,
    camera:
      second === durationSeconds - 1
        ? "保持构图连续并自然停稳"
        : `${cameraMove}，承接上一秒机位与运动速度`,
  }));
}

function fallbackShotDuration(description: string) {
  return Math.max(3, Math.min(15, Math.ceil(description.length / 12)));
}

function splitFallbackShotText(value: string, maxLength = 96) {
  const sentences = value
    .split(/(?<=[。！？!?；;\n])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
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
      fallbackVersion: 4,
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
  context: Pick<ClipContext, "sourceText" | "canonical">,
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

function structuredProviderFailureCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const status = message.match(/^STRUCTURED_PROVIDER_FAILED:(\d{3}):/)?.[1];
  if (status) return `PROVIDER_HTTP_${status}`;
  if (message.startsWith("STRUCTURED_PROVIDER_TIMEOUT:"))
    return "PROVIDER_TIMEOUT";
  return "PROVIDER_TEMPORARY_FAILURE";
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
