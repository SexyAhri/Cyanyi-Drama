import { z } from "zod";

import {
  screenplayAssemblySceneSchema,
  screenplayBeatPlanSchema,
  screenplayConversionSchema,
  screenplayDialoguePlanSchema,
  screenplayEffectsPlanSchema,
  screenplayNarrationPlanSchema,
} from "@/lib/prompts/schemas";
import { listProductionClips } from "@/lib/production/domain-store";
import { prisma } from "@/lib/server/prisma";

import {
  type ScreenplayAssemblyScene,
  type ScreenplayBeatPlan,
  type ScreenplayContent,
  type ScreenplayDialoguePlan,
  type ScreenplayEffectsPlan,
  type ScreenplayNarrationPlan,
} from "./screenplay-stage-normalization";
import { organizeApprovedScreenplayClip } from "./approved-screenplay-parser";
import {
  loadLocalScreenplayContext,
  mapWithConcurrency,
  type StoryToScriptRuntimeHooks,
  type StoryToScriptStepInput,
} from "./story-to-script-runtime";

type ProductionClip = NonNullable<
  Awaited<ReturnType<typeof listProductionClips>>
>[number];

type StageResult = {
  clipId: string;
  clipIndex: number;
  success: boolean;
  reused: boolean;
  locallyConverted: boolean;
  error?: string;
};

type SceneTarget = {
  clip: ProductionClip;
  sceneIndex: number;
  parts: SceneParts;
  fallback: ScreenplayAssemblyScene;
};

type SceneParts = {
  scene: ScreenplayBeatPlan["scenes"][number];
  dialogue: ScreenplayDialoguePlan["lines"];
  narration: ScreenplayNarrationPlan["lines"];
  effects: ScreenplayEffectsPlan["designs"];
};

export class ScreenplayStageBatchError extends Error {
  constructor(
    readonly stage: string,
    readonly results: StageResult[],
  ) {
    const failed = results.filter((result) => !result.success);
    super(
      `SCREENPLAY_STAGE_FAILED:${stage}:${failed.length}/${results.length}:${failed
        .slice(0, 3)
        .map(
          (result) =>
            `clip=${result.clipIndex + 1}:${result.error ?? "unknown"}`,
        )
        .join(" | ")}`,
    );
  }
}

export async function generateEpisodeScreenplayBeats(
  userId: string,
  input: StoryToScriptStepInput,
  hooks: StoryToScriptRuntimeHooks,
) {
  return runLocalClipStage({
    userId,
    input,
    hooks,
    artifactType: "screenplay.beats",
    rawArtifactType: "screenplay.beats.raw",
    schema: screenplayBeatPlanSchema,
    select: (organized) => organized.beats,
  });
}

export async function generateEpisodeScreenplayDialogue(
  userId: string,
  input: StoryToScriptStepInput,
  hooks: StoryToScriptRuntimeHooks,
) {
  return runLocalClipStage({
    userId,
    input,
    hooks,
    artifactType: "screenplay.dialogue",
    rawArtifactType: "screenplay.dialogue.raw",
    schema: screenplayDialoguePlanSchema,
    select: (organized) => organized.dialogue,
  });
}

export async function generateEpisodeScreenplayNarration(
  userId: string,
  input: StoryToScriptStepInput,
  hooks: StoryToScriptRuntimeHooks,
) {
  return runLocalClipStage({
    userId,
    input,
    hooks,
    artifactType: "screenplay.narration",
    rawArtifactType: "screenplay.narration.raw",
    schema: screenplayNarrationPlanSchema,
    select: (organized) => organized.narration,
  });
}

export async function generateEpisodeScreenplayEffects(
  userId: string,
  input: StoryToScriptStepInput,
  hooks: StoryToScriptRuntimeHooks,
) {
  return runLocalClipStage({
    userId,
    input,
    hooks,
    artifactType: "screenplay.effects",
    rawArtifactType: "screenplay.effects.raw",
    schema: screenplayEffectsPlanSchema,
    select: (organized) => organized.effects,
  });
}

export async function assembleEpisodeScreenplays(
  userId: string,
  input: StoryToScriptStepInput,
  hooks: StoryToScriptRuntimeHooks,
) {
  await hooks.assertActive();
  const context = await loadLocalScreenplayContext(userId, input);
  const clips = await requireClips(userId, input);
  const targets: SceneTarget[] = [];
  for (const clip of clips) {
    const [beats, dialogue, narration, effects] = await Promise.all([
      requireRunArtifact(
        hooks,
        "screenplay.beats",
        clip.id,
        screenplayBeatPlanSchema,
      ),
      requireRunArtifact(
        hooks,
        "screenplay.dialogue",
        clip.id,
        screenplayDialoguePlanSchema,
      ),
      requireRunArtifact(
        hooks,
        "screenplay.narration",
        clip.id,
        screenplayNarrationPlanSchema,
      ),
      requireRunArtifact(
        hooks,
        "screenplay.effects",
        clip.id,
        screenplayEffectsPlanSchema,
      ),
    ]);
    beats.scenes.forEach((scene, sceneIndex) => {
      const parts = buildSceneParts(scene, sceneIndex, beats.scenes.length, {
        dialogue,
        narration,
        effects,
      });
      targets.push({
        clip,
        sceneIndex,
        parts,
        fallback: assembleSceneLocally(parts),
      });
    });
  }

  const results = await mapWithConcurrency(
    targets,
    input.concurrency ?? context.workflowConcurrency,
    async (
      target,
    ): Promise<StageResult & { scene?: ScreenplayAssemblyScene }> => {
      const refId = sceneRef(target.clip.id, target.sceneIndex);
      await hooks.assertActive();
      if (input.resumeExisting) {
        const existing = await tryLoadRunArtifact(
          hooks,
          "screenplay.scene",
          refId,
          screenplayAssemblySceneSchema,
        );
        if (existing)
          return {
            clipId: target.clip.id,
            clipIndex: target.clip.clipIndex,
            success: true,
            reused: true,
            locallyConverted: false,
            scene: existing,
          };
      }
      try {
        const scene = target.fallback;
        await hooks.persistArtifact("screenplay.scene", refId, scene);
        return {
          clipId: target.clip.id,
          clipIndex: target.clip.clipIndex,
          success: true,
          reused: false,
          locallyConverted: false,
          scene,
        };
      } catch (error) {
        const message = errorMessage(error);
        await hooks.persistArtifact("screenplay.scene.failure", refId, {
          clipId: target.clip.id,
          clipIndex: target.clip.clipIndex,
          sceneIndex: target.sceneIndex,
          error: message,
        });
        return {
          clipId: target.clip.id,
          clipIndex: target.clip.clipIndex,
          success: false,
          reused: false,
          locallyConverted: false,
          error: message,
        };
      }
    },
  );

  const completedClips = [];
  for (const clip of clips) {
    const clipResults = results.filter((result) => result.clipId === clip.id);
    if (clipResults.some((result) => !result.success)) {
      await markClipStatus(clip.id, "screenplay_failed");
      continue;
    }
    const scenes = clipResults
      .map((result) => result.scene)
      .filter((scene): scene is ScreenplayAssemblyScene => !!scene)
      .map((result, sceneNumber) => ({ sceneNumber, ...result.scene }));
    const screenplay = screenplayConversionSchema.parse({
      clipId: clip.id,
      originalText: clip.content,
      scenes,
    });
    if (!isProducibleScreenplay(screenplay)) {
      await markClipStatus(clip.id, "screenplay_failed");
      const failed = clipResults[0];
      if (failed) {
        failed.success = false;
        failed.error = "SCREENPLAY_HAS_NO_PRODUCIBLE_CONTENT";
      }
      continue;
    }
    await hooks.assertActive();
    await prisma.storyClip.update({
      where: { id: clip.id },
      data: {
        screenplay: JSON.stringify(screenplay),
        status: "screenplay_ready",
      },
    });
    const artifact = {
      clipId: clip.id,
      clipIndex: clip.clipIndex,
      success: true,
      sceneCount: screenplay.scenes.length,
      screenplay,
    };
    await hooks.persistArtifact("screenplay.clip", clip.id, artifact);
    completedClips.push(artifact);
  }

  if (results.some((result) => !result.success))
    throw new ScreenplayStageBatchError("assembly", results);
  return {
    clipCount: completedClips.length,
    sceneCount: completedClips.reduce(
      (total, clip) => total + clip.sceneCount,
      0,
    ),
    locallyConvertedCount: results.filter((result) => result.locallyConverted)
      .length,
    results: completedClips,
    promptTraces: [],
  };
}

export function assembleSceneLocally(
  parts: SceneParts,
): ScreenplayAssemblyScene {
  const content: ScreenplayContent[] = [];
  appendPlacedLines(content, parts, null);
  parts.scene.beats.forEach((beat, beatIndex) => {
    const design = parts.effects.find((item) => item.beatIndex === beatIndex);
    content.push({
      type: "action",
      text: beat.text,
      ...(design ? { actionDesign: design.actionDesign } : {}),
    });
    appendPlacedLines(content, parts, beatIndex);
  });
  return {
    scene: {
      heading: parts.scene.heading,
      description: parts.scene.description,
      characters: Array.from(
        new Set([
          ...parts.scene.characters,
          ...parts.dialogue.map((line) => line.character),
          ...parts.narration.flatMap((line) =>
            line.character ? [line.character] : [],
          ),
        ]),
      ),
      content,
    },
  };
}

export function isProducibleScreenplay(
  screenplay: z.infer<typeof screenplayConversionSchema>,
) {
  return screenplay.scenes.some((scene) =>
    scene.content.some((item) => {
      if (item.type === "action") return !!item.text.trim();
      if (item.type === "dialogue") return !!item.lines.trim();
      return !!item.text.trim();
    }),
  );
}

async function runLocalClipStage<T>(config: {
  userId: string;
  input: StoryToScriptStepInput;
  hooks: StoryToScriptRuntimeHooks;
  artifactType: string;
  rawArtifactType: string;
  schema: z.ZodType<T>;
  select: (
    organized: ReturnType<typeof organizeApprovedScreenplayClip>,
  ) => unknown;
}) {
  await config.hooks.assertActive();
  const context = await loadLocalScreenplayContext(config.userId, config.input);
  const clips = await requireClips(config.userId, config.input);
  const results = await mapWithConcurrency(
    clips,
    config.input.concurrency ?? context.workflowConcurrency,
    async (clip): Promise<StageResult> => {
      await config.hooks.assertActive();
      if (config.input.resumeExisting) {
        const existing = await tryLoadRunArtifact(
          config.hooks,
          config.artifactType,
          clip.id,
          config.schema,
        );
        if (existing)
          return {
            clipId: clip.id,
            clipIndex: clip.clipIndex,
            success: true,
            reused: true,
            locallyConverted: false,
          };
      }
      try {
        await markClipStatus(clip.id, "screenplay_running");
        const organized = organizeApprovedScreenplayClip(
          clip.id,
          clip.content,
          context.canonical,
        );
        const data = config.schema.parse(config.select(organized));
        await persistRawArtifact(
          config.hooks,
          config.rawArtifactType,
          clip.id,
          {
            clipId: clip.id,
            clipIndex: clip.clipIndex,
            sourceText: clip.content,
            locallyConverted: true,
          },
        );
        await config.hooks.persistArtifact(config.artifactType, clip.id, data);
        return {
          clipId: clip.id,
          clipIndex: clip.clipIndex,
          success: true,
          reused: false,
          locallyConverted: true,
        };
      } catch (error) {
        const message = errorMessage(error);
        await markClipStatus(clip.id, "screenplay_failed");
        await config.hooks.persistArtifact(
          `${config.artifactType}.failure`,
          clip.id,
          {
            clipId: clip.id,
            clipIndex: clip.clipIndex,
            error: message,
          },
        );
        return {
          clipId: clip.id,
          clipIndex: clip.clipIndex,
          success: false,
          reused: false,
          locallyConverted: false,
          error: message,
        };
      }
    },
  );
  if (results.some((result) => !result.success))
    throw new ScreenplayStageBatchError(config.artifactType, results);
  return {
    clipCount: results.length,
    reusedCount: results.filter((result) => result.reused).length,
    locallyConvertedCount: results.filter((result) => result.locallyConverted)
      .length,
    results,
    promptTraces: [],
  };
}

async function requireRunArtifact<T>(
  hooks: StoryToScriptRuntimeHooks,
  artifactType: string,
  refId: string,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!hooks.loadRunArtifact)
    throw new Error("WORKFLOW_RUN_ARTIFACT_LOADER_REQUIRED");
  const value = await hooks.loadRunArtifact(artifactType, refId);
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error(`WORKFLOW_ARTIFACT_REQUIRED:${artifactType}:${refId}`);
}

async function tryLoadRunArtifact<T>(
  hooks: StoryToScriptRuntimeHooks,
  artifactType: string,
  refId: string,
  schema: z.ZodType<T>,
) {
  if (!hooks.loadRunArtifact) return null;
  const value = await hooks.loadRunArtifact(artifactType, refId);
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function requireClips(userId: string, input: StoryToScriptStepInput) {
  const clips = await listProductionClips(
    userId,
    input.projectId,
    input.episodeId,
  );
  if (!clips?.length) throw new Error("STORY_CLIPS_REQUIRED");
  return clips;
}

function buildSceneParts(
  scene: ScreenplayBeatPlan["scenes"][number],
  sceneIndex: number,
  sceneCount: number,
  plans: {
    dialogue: ScreenplayDialoguePlan;
    narration: ScreenplayNarrationPlan;
    effects: ScreenplayEffectsPlan;
  },
): SceneParts {
  return {
    scene,
    dialogue: plans.dialogue.lines
      .filter((line) => clampIndex(line.sceneIndex, sceneCount) === sceneIndex)
      .map((line) => ({
        ...line,
        sceneIndex,
        afterBeatIndex: clampOptionalIndex(
          line.afterBeatIndex,
          scene.beats.length,
        ),
      })),
    narration: plans.narration.lines
      .filter((line) => clampIndex(line.sceneIndex, sceneCount) === sceneIndex)
      .map((line) => ({
        ...line,
        sceneIndex,
        afterBeatIndex: clampOptionalIndex(
          line.afterBeatIndex,
          scene.beats.length,
        ),
      })),
    effects: plans.effects.designs
      .filter(
        (design) => clampIndex(design.sceneIndex, sceneCount) === sceneIndex,
      )
      .map((design) => ({
        ...design,
        sceneIndex,
        beatIndex: clampIndex(design.beatIndex, scene.beats.length),
      })),
  };
}

function appendPlacedLines(
  content: ScreenplayContent[],
  parts: SceneParts,
  afterBeatIndex: number | null,
) {
  content.push(
    ...parts.dialogue
      .filter((line) => line.afterBeatIndex === afterBeatIndex)
      .map((line) => ({
        type: "dialogue" as const,
        character: line.character,
        parenthetical: line.parenthetical,
        lines: line.lines,
      })),
    ...parts.narration
      .filter((line) => line.afterBeatIndex === afterBeatIndex)
      .map((line) => ({
        type: "voiceover" as const,
        character: line.character,
        text: line.text,
      })),
  );
}

function clampIndex(value: number, length: number) {
  return Math.max(0, Math.min(Math.max(0, length - 1), Math.floor(value)));
}

function clampOptionalIndex(value: number | null, length: number) {
  return value === null ? null : clampIndex(value, length);
}

function sceneRef(clipId: string, sceneIndex: number) {
  return `${clipId}:scene:${sceneIndex}`;
}

async function markClipStatus(clipId: string, status: string) {
  await prisma.storyClip.update({ where: { id: clipId }, data: { status } });
}

async function persistRawArtifact(
  hooks: StoryToScriptRuntimeHooks,
  artifactType: string,
  refId: string,
  payload: unknown,
) {
  await hooks.persistArtifact(artifactType, refId, payload);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
