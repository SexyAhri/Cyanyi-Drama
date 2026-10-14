import { reconcileEpisodeVoiceLines } from "@/lib/voice/reconcile";
import { lockVideoAudioPerformance } from "@/lib/media/director-prompt-locks";
import { createHash } from "node:crypto";

import { screenplayConversionSchema } from "@/lib/prompts/schemas";
import { estimateSpeechDurationSeconds } from "@/lib/prompts/validators";
import {
  listProductionClips,
  listProductionProps,
} from "@/lib/production/domain-store";
import type {
  ActionPhase,
  SfxCueType,
  VfxCueCategory,
} from "@/lib/production/action-cues";
import { getProjectArtStyleDirective } from "@/lib/projects/art-style";
import { prisma } from "@/lib/server/prisma";

import { parseApprovedScreenplay } from "./approved-screenplay-parser";
import { getStoryboard, saveStoryboard } from "./domain-store";
import { splitSpokenTextForShots } from "./storyboard-dialogue-timing";
import { directStoryboard } from "./storyboard-director";
import { buildDirectorScenes } from "./storyboard-scene-contract";
import {
  parseAssetVisualProfile,
  compileAssetVisualProfile,
} from "@/lib/assets/visual-profile";
import { readProductionTemplate } from "@/lib/prompts/production-rules";
import type { WorkflowRequestUpdate } from "@/lib/workflow/request-events";

type ProductionClip = NonNullable<
  Awaited<ReturnType<typeof listProductionClips>>
>[number];
type Screenplay = ReturnType<typeof screenplayConversionSchema.parse>;

export type ScriptToStoryboardStepInput = {
  projectId: string;
  episodeId: string;
  locale?: "en" | "zh";
  channelId?: string;
  model?: string;
};

export type ScriptToStoryboardRuntimeHooks = {
  assertActive: () => Promise<void>;
  loadArtifact?: (
    artifactType: string,
    refId: string,
  ) => Promise<unknown | null>;
  persistArtifact: (
    artifactType: string,
    refId: string,
    payload: unknown,
  ) => Promise<void>;
  recordRequest?: (request: WorkflowRequestUpdate) => Promise<void>;
};

type SceneStoryboardContext = {
  artStyle: string;
  productionSpec: string;
  visualRules: string;
  propNames: string[];
  locale: "en" | "zh";
};

const STORYBOARD_PLANNER_VERSION = "scene-director-v6";
const TARGET_BEAT_SECONDS = 5;

export async function buildEpisodeStoryboard(
  userId: string,
  input: ScriptToStoryboardStepInput,
  hooks: ScriptToStoryboardRuntimeHooks,
) {
  await hooks.assertActive();
  const [episode, clips, props, existingStoryboard] = await Promise.all([
    prisma.episode.findFirst({
      where: {
        id: input.episodeId,
        projectId: input.projectId,
        project: { userId },
      },
      select: {
        novelText: true,
        project: { select: { config: { select: { artStyle: true, episodeTargetDurationSeconds: true } } } },
      },
    }),
    listProductionClips(userId, input.projectId, input.episodeId),
    listProductionProps(userId, input.projectId),
    getStoryboard(userId, input.projectId, input.episodeId),
  ]);
  if (!episode) throw new Error("STORYBOARD_EPISODE_NOT_FOUND");
  if (!clips?.length) throw new Error("STORYBOARD_SCENES_REQUIRED");
  if (!props) throw new Error("STORYBOARD_PROJECT_NOT_FOUND");

  const locale = input.locale === "en" ? "en" : "zh";
  const directives = extractProductionDirectives(episode.novelText ?? "");
  const context: SceneStoryboardContext = {
    artStyle: getProjectArtStyleDirective(
      episode.project.config?.artStyle,
      locale,
    ),
    productionSpec: directives.productionSpec,
    visualRules: visualOnly(directives.visualRules),
    propNames: props.map((prop) => prop.name),
    locale,
  };
  const scenes = buildDirectorScenes(clips, context.propNames);
  const basePanels =
    input.channelId && input.model
      ? []
      : buildSceneStoryboardPanels(clips, context);
  const assets =
    input.channelId && input.model
      ? await Promise.all([
          prisma.novelCharacter.findMany({
            where: {
              projectId: input.projectId,
              name: {
                in: unique(scenes.flatMap((scene) => scene.characters)),
              },
            },
            select: { name: true, visualProfileJson: true },
          }),
          prisma.novelLocation.findMany({
            where: {
              projectId: input.projectId,
              name: {
                in: unique(scenes.map((scene) => scene.heading.location)),
              },
            },
            select: { name: true, visualProfileJson: true },
          }),
          prisma.novelProp.findMany({
            where: {
              projectId: input.projectId,
              name: { in: unique(scenes.flatMap((scene) => scene.props)) },
            },
            select: { name: true, visualProfileJson: true },
          }),
        ])
      : null;
  const director =
    input.channelId && input.model
      ? await directStoryboard({
          userId,
          channelId: input.channelId,
          model: input.model,
          scenes,
          style: context.artStyle,
          productionSpec: context.productionSpec,
          targetDurationSeconds: episode.project.config?.episodeTargetDurationSeconds,
          visualRules: context.visualRules,
          locale,
          assets: assets
            ? {
                characters: assets[0].map(compactAsset),
                locations: assets[1].map(compactAsset),
                props: assets[2].map(compactAsset),
              }
            : { characters: [], locations: [], props: [] },
          assertActive: hooks.assertActive,
          persistArtifact: hooks.persistArtifact,
          loadArtifact: hooks.loadArtifact,
          recordRequest: hooks.recordRequest,
        })
      : null;
  const panels = director
    ? director.panels.map((panel) => ({
        ...panel,
        worldContext: {
          ...panel.worldContext,
          productionSpec: context.productionSpec,
          visualRules: context.visualRules,
          shotIntent: {
            primaryVisibleEvent: panel.description,
            endBeat: panel.endState.body,
          },
        },
      }))
    : basePanels;
  const sourceHash = sha256(
    JSON.stringify({
      clips: clips.map((clip) => ({
        id: clip.id,
        screenplay: clip.screenplay,
      })),
      artStyle: context.artStyle,
      productionSpec: context.productionSpec,
      targetDurationSeconds: episode.project.config?.episodeTargetDurationSeconds,
      visualRules: context.visualRules,
      plannerVersion: STORYBOARD_PLANNER_VERSION,
      directorModel: input.model ?? null,
      directorChannel: input.channelId ?? null,
      directorAssets: assets,
      directorTemplates: director
        ? [
            "storyboard-generation",
            "storyboard-review",
            "storyboard-repair",
          ].map((task) =>
            sha256(
              readProductionTemplate(
                task as
                  | "storyboard-generation"
                  | "storyboard-review"
                  | "storyboard-repair",
              ),
            ),
          )
        : [],
    }),
  );

  await hooks.assertActive();
  const [currentClips, currentEpisode, currentStoryboard] = await Promise.all([
    listProductionClips(userId, input.projectId, input.episodeId),
    prisma.episode.findFirst({
      where: {
        id: input.episodeId,
        projectId: input.projectId,
        project: { userId },
      },
      select: {
        novelText: true,
        project: { select: { config: { select: { artStyle: true, episodeTargetDurationSeconds: true } } } },
      },
    }),
    getStoryboard(userId, input.projectId, input.episodeId),
  ]);
  if (
    !currentEpisode ||
    JSON.stringify(
      currentClips?.map((clip) => ({
        id: clip.id,
        screenplay: clip.screenplay,
      })),
    ) !==
      JSON.stringify(
        clips.map((clip) => ({ id: clip.id, screenplay: clip.screenplay })),
      ) ||
    currentEpisode.novelText !== episode.novelText ||
    currentEpisode.project.config?.artStyle !== episode.project.config?.artStyle ||
    currentEpisode.project.config?.episodeTargetDurationSeconds !== episode.project.config?.episodeTargetDurationSeconds
  )
    throw new Error("生成期间剧本或风格已修改，已完成草稿保留，请重新生成分镜");
  if (currentStoryboard?.version !== existingStoryboard?.version)
    throw new Error("生成期间分镜已修改，已完成草稿保留，请重新加载后处理");
  const storyboard = await saveStoryboard(
    userId,
    input.projectId,
    input.episodeId,
    {
      expectedVersion: existingStoryboard?.version ?? null,
      status:
        director && !director.approved ? "director_review_required" : "ready",
      sourceHash,
      preserveImagePrompts:
        !director && existingStoryboard?.sourceHash === sourceHash,
      panels,
    },
  );
  if (!storyboard) throw new Error("STORYBOARD_PERSIST_FAILED");

  const voiceLineCount = await syncScreenplayVoiceLines(
    input.episodeId,
    clips,
    storyboard.panels,
  );

  await Promise.all(
    clips.map((clip) =>
      prisma.storyClip.update({
        where: { id: clip.id },
        data: {
          status: "storyboard_ready",
          shotCount: panels.filter((panel) => panel.clipId === clip.id).length,
        },
      }),
    ),
  );
  const artifact = {
    source: director ? "storyboard-director" : "local-production-script",
    directorReviews: director?.reviews ?? [],
    clipCount: clips.length,
    sceneCount: scenes.length,
    storyboardId: storyboard.id,
    sourceHash,
    voiceLineCount,
  };
  await hooks.persistArtifact("storyboard.scenes", input.episodeId, artifact);

  return {
    ...artifact,
    panelCount: storyboard.panels.length,
    promptTraces: director?.traces ?? [],
  };
}

function compactAsset(asset: { name: string; visualProfileJson: unknown }) {
  let value = asset.visualProfileJson;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  return {
    name: asset.name,
    visualSpec: compileAssetVisualProfile(parseAssetVisualProfile(value)),
  };
}

type StoryboardVoicePanel = {
  id: string;
  clipId: string | null;
  panelIndex: number;
  sceneNumber: number | null;
  speakingCharacter?: string | null;
  lipSyncText?: string | null;
  voiceoverText?: string | null;
  actingNotes?: Record<string, unknown>;
};

type ScreenplayVoiceLine = {
  lineIndex: number;
  speaker: string;
  content: string;
  delivery: "dialogue" | "inner_monologue" | "voiceover";
  emotionPrompt: string | null;
  emotionStrength: number;
  matchedPanelId: string;
};

export function buildScreenplayVoiceLines(
  clips: ProductionClip[],
  panels: StoryboardVoicePanel[],
) {
  const lines: ScreenplayVoiceLine[] = [];
  let sceneNumber = 0;

  for (const clip of clips) {
    const screenplay = parseScreenplay(clip);
    for (const scene of screenplay.scenes) {
      const scenePanels = panels
        .filter(
          (panel) =>
            panel.clipId === clip.id && panel.sceneNumber === sceneNumber,
        )
        .sort((left, right) => left.panelIndex - right.panelIndex);
      sceneNumber += 1;
      if (!scenePanels.length) continue;

      const actionCount = scene.content.filter(
        (content) => content.type === "action",
      ).length;
      let completedActions = 0;
      for (const [contentIndex, content] of scene.content.entries()) {
        if (content.type === "action") {
          completedActions += 1;
          continue;
        }
        const speaker =
          content.type === "dialogue"
            ? content.character
            : (content.character ?? "旁白");
        const delivery =
          content.type === "dialogue"
            ? ("dialogue" as const)
            : content.character
              ? ("inner_monologue" as const)
              : ("voiceover" as const);
        const spokenContent =
          content.type === "dialogue" ? content.lines : content.text;
        const performed = performedVoiceSegments(
          content.type,
          speaker,
          spokenContent,
          scenePanels.filter((panel) => {
            const source = panel.actingNotes?.sourceSpeech;
            return (
              !source ||
              typeof source !== "object" ||
              (source as Record<string, unknown>).contentIndex === contentIndex
            );
          }),
        );
        const fallbackPanel =
          scenePanels[
            actionCount
              ? Math.round(
                  (completedActions / actionCount) * (scenePanels.length - 1),
                )
              : Math.floor((scenePanels.length - 1) / 2)
          ];
        const segments = performed.length
          ? performed
          : [{ content: spokenContent, panel: fallbackPanel }];
        for (const segment of segments) {
          lines.push({
            lineIndex: lines.length,
            speaker,
            content: segment.content,
            delivery,
            emotionPrompt:
              content.type === "dialogue"
                ? (content.parenthetical ?? null)
                : null,
            emotionStrength: 0.5,
            matchedPanelId: segment.panel.id,
          });
        }
      }
    }
  }
  return lines;
}

function performedVoiceSegments(
  type: "dialogue" | "voiceover",
  speaker: string,
  content: string,
  panels: StoryboardVoicePanel[],
) {
  let consumed = "";
  const segments: Array<{ content: string; panel: StoryboardVoicePanel }> = [];
  for (const panel of panels) {
    const value =
      type === "dialogue"
        ? panel.speakingCharacter === speaker
          ? panel.lipSyncText
          : null
        : panel.voiceoverText;
    if (!value || !content.startsWith(consumed + value)) continue;
    consumed += value;
    segments.push({ content: value, panel });
    if (consumed === content) return segments;
  }
  return [];
}

async function syncScreenplayVoiceLines(
  episodeId: string,
  clips: ProductionClip[],
  panels: StoryboardVoicePanel[],
) {
  const lines = buildScreenplayVoiceLines(clips, panels);
  await reconcileEpisodeVoiceLines(episodeId, lines);
  return lines.length;
}

export function buildSceneStoryboardPanels(
  clips: ProductionClip[],
  context: SceneStoryboardContext,
) {
  let panelIndex = 0;
  let sceneNumber = 0;
  return clips.flatMap((clip) => {
    const screenplay = parseScreenplay(clip);
    const sourceScenes = parseApprovedScreenplay(clip.content);
    let clipPanelIndex = 0;
    return screenplay.scenes.flatMap((scene, screenplaySceneIndex) => {
      const sourceScene = sourceScenes[screenplaySceneIndex] ?? sourceScenes[0];
      const action = scene.content
        .filter((item) => item.type === "action")
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join("\n");
      const voiceover = scene.content
        .filter((item) => item.type === "voiceover")
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join("\n");
      const sceneText = [sourceScene?.sourceText, action]
        .filter(Boolean)
        .join("\n");
      const props = unique([
        ...clip.props,
        ...context.propNames.filter((name) => sceneText.includes(name)),
      ]);
      const characters = unique([
        ...scene.characters,
        ...scene.content.flatMap((item) =>
          item.type === "dialogue" && item.character ? [item.character] : [],
        ),
      ]);
      const requestedDurationSeconds = sourceScene?.durationSeconds ?? 8;
      const camera =
        sourceScene?.camera || cameraFromDescription(scene.description);
      const actionBeats = buildSemanticBeats(
        action,
        requestedDurationSeconds,
        context.locale,
        characters,
        props,
      );
      const dialogueByBeat = assignDialogueToBeats(
        scene.content,
        actionBeats.length,
      );
      const lastDialogueBeat = Math.max(-1, ...dialogueByBeat.keys());
      const extraDialogueBeats = Array.from(
        { length: Math.max(0, lastDialogueBeat + 1 - actionBeats.length) },
        (_, index) => {
          const speaker = dialogueByBeat.get(
            actionBeats.length + index,
          )?.speaker;
          return context.locale === "en"
            ? `${speaker} continues speaking as the other character reacts.`
            : `${speaker}继续说话，对方自然回应。`;
        },
      );
      const actions = [...actionBeats, ...extraDialogueBeats];
      const actionDurations = beatDurations(
        requestedDurationSeconds,
        actionBeats.length,
      );
      const voiceovers = distributeTextAcrossBeats(
        voiceover,
        actionBeats.length,
      );
      const vfxCues = collectVfxCues(scene, sourceScene?.visualEffects ?? "");
      const sfxCues = collectSfxCues(scene, sourceScene?.sound ?? "");
      const currentSceneNumber = sceneNumber++;
      let startState = buildInitialState({
        action: actions[0] ?? "",
        characters,
        locale: context.locale,
        location: scene.heading.location,
        props,
      });

      return actions.map((beatAction, beatIndex) => {
        const dialogue = dialogueByBeat.get(beatIndex);
        const durationSeconds = Math.max(
          actionDurations[beatIndex] ?? 0,
          dialogue ? estimateSpeechDurationSeconds(dialogue.text) : 0,
          beatIndex >= actionBeats.length ? 3 : 1,
        );
        const plannedCamera = cameraForBeat(
          camera,
          beatIndex,
          actions.length,
          context.locale,
        );
        const beatCamera = dialogue
          ? speakingCamera(plannedCamera, dialogue.speaker, context.locale)
          : plannedCamera;
        const endState = buildEndState(beatAction, context.locale);
        const assignedVfx =
          beatIndex < actionBeats.length
            ? cuesForBeat(vfxCues, beatIndex, actionBeats.length)
            : [];
        const assignedSfx =
          beatIndex < actionBeats.length
            ? cuesForBeat(sfxCues, beatIndex, actionBeats.length)
            : [];
        const globalIndex = panelIndex++;
        const currentClipPanelIndex = clipPanelIndex++;
        const promptFacts = {
          location: scene.heading.location,
          time: scene.heading.time,
          camera: beatCamera,
          characters,
          props,
          action: beatAction,
          speakingCharacter: dialogue?.speaker,
          lipSyncText: dialogue?.text,
          voiceoverText: voiceovers[beatIndex],
          durationSeconds,
          startState: stateBody(startState),
          endState: stateBody(endState),
          visualEffects: assignedVfx.map((cue) => cue.description).join("；"),
          soundEffects: assignedSfx.map((cue) => cue.description).join("；"),
        };
        const panel = {
          clipId: clip.id,
          clipPanelIndex: currentClipPanelIndex,
          panelIndex: globalIndex,
          sceneNumber: currentSceneNumber,
          shotType: inferShotType(camera, characters.length),
          cameraMove: beatCamera,
          description: beatAction,
          locationName: scene.heading.location,
          characters,
          props,
          imagePrompt: buildImagePrompt(context, promptFacts),
          videoPrompt: buildVideoPrompt(context, promptFacts),
          durationSeconds,
          subtitleText: null,
          speakingCharacter: dialogue?.speaker ?? null,
          lipSyncText: dialogue?.text ?? null,
          voiceoverText: voiceovers[beatIndex] || null,
          startState,
          endState,
          motionBeats: [
            {
              startSecond: 0,
              endSecond: durationSeconds,
              action: beatAction,
              camera: beatCamera,
            },
          ],
          worldContext: {
            productionSpec: context.productionSpec,
            visualRules: context.visualRules,
            shotIntent: {
              audienceTakeaway: beatAction,
              primaryVisibleEvent: beatAction,
              endBeat: stateBody(endState),
            },
            constraints: {
              mustHold: [continuityConstraint(context.locale)],
              changesHere: [beatAction],
              mustNotAppear: [futureActionConstraint(context.locale)],
            },
          },
          vfxCues: assignedVfx.map((cue) => ({
            atSecond: Math.max(
              0,
              Math.min(durationSeconds - 1, Math.floor(durationSeconds / 2)),
            ),
            phase: cue.phase,
            category: cue.category,
            description: cue.description,
            evidence: [cue.description],
          })),
          sfxCues: assignedSfx.map((cue) => ({
            startSecond: 0,
            endSecond: durationSeconds,
            type: cue.type,
            description: cue.description,
            evidence: [cue.description],
          })),
          actingNotes: {},
          photographyRules: beatCamera,
          phase: "scene",
          status: "ready",
          linkedToNextPanel: beatIndex < actions.length - 1,
          sourceEvidence: action ? [action] : [],
        };
        startState = endState;
        return panel;
      });
    });
  });
}

function assignDialogueToBeats(
  content: Screenplay["scenes"][number]["content"],
  actionBeatCount: number,
) {
  const assignments = new Map<number, { speaker: string; text: string }>();
  const actionCount = content.filter((item) => item.type === "action").length;
  let completedActions = 0;
  let nextFreeBeat = 0;
  for (const item of content) {
    if (item.type === "action") {
      completedActions += 1;
      continue;
    }
    if (
      item.type !== "dialogue" ||
      !item.character?.trim() ||
      !item.lines.trim()
    )
      continue;
    const preferred = actionCount
      ? Math.round((completedActions / actionCount) * (actionBeatCount - 1))
      : 0;
    for (const text of splitSpokenTextForShots(
      item.lines,
      TARGET_BEAT_SECONDS,
    )) {
      const beatIndex = Math.max(preferred, nextFreeBeat);
      assignments.set(beatIndex, {
        speaker: item.character.trim(),
        text,
      });
      nextFreeBeat = beatIndex + 1;
    }
  }
  return assignments;
}

export function extractProductionDirectives(sourceText: string) {
  return {
    productionSpec: readLabeledValue(sourceText, [
      "成片规格",
      "production specification",
      "production spec",
    ]),
    visualRules: readLabeledValue(sourceText, [
      "全局视听规则",
      "全局视觉规则",
      "global audiovisual rules",
      "global visual rules",
    ]),
  };
}

function buildImagePrompt(context: SceneStoryboardContext, facts: PromptFacts) {
  const framing = startingFraming(facts.camera, context.locale);
  const values =
    context.locale === "en"
      ? [
          context.artStyle,
          context.productionSpec &&
            `Production specification: ${context.productionSpec}`,
          context.visualRules && `Global visual rules: ${context.visualRules}`,
          `Scene: ${facts.location}; time: ${facts.time}`,
          framing && `Starting composition: ${framing}`,
          facts.characters.length &&
            `Characters: ${facts.characters.join(", ")}`,
          facts.speakingCharacter &&
            `Visible speaker: show ${facts.speakingCharacter}'s face and mouth clearly in this frame.`,
          facts.props.length && `Props: ${facts.props.join(", ")}`,
          `Opening pose at t=0: ${facts.startState}`,
          "Show a natural cinematic moment at the action's onset, with believable weight, breath, and eyelines. Keep the action outcome for the video.",
          "No subtitles, captions, logos, watermarks, or readable text.",
        ]
      : [
          context.artStyle,
          context.productionSpec && `成片规格：${context.productionSpec}`,
          context.visualRules && `全局视觉规则：${context.visualRules}`,
          `场景：${facts.location}；时间：${facts.time}`,
          framing && `起始构图与机位：${framing}`,
          facts.characters.length && `出场角色：${facts.characters.join("、")}`,
          facts.speakingCharacter &&
            `可见说话人：${facts.speakingCharacter}的面部与口部必须清晰入画。`,
          facts.props.length && `画面道具：${facts.props.join("、")}`,
          `t=0 起始姿态：${facts.startState}`,
          "呈现动作起势时自然的电影画面，保留人物重心、呼吸和视线；动作结果留给视频表现。",
          "画面中不得出现字幕、标题、标识、水印或任何可读文字。",
        ];
  return values.filter(Boolean).join("\n");
}

function buildVideoPrompt(context: SceneStoryboardContext, facts: PromptFacts) {
  const values =
    context.locale === "en"
      ? [
          `Continue from the reference frame for ${facts.durationSeconds} seconds, carrying the pose, gaze, and motion into this shot.`,
          `Visible action: ${facts.action}`,
          facts.speakingCharacter &&
            `During this shot, ${facts.speakingCharacter} speaks with natural facial and mouth movement; the others listen or react.`,
          `End state: ${facts.endState}`,
          `Camera: ${facts.camera || fixedCamera(context.locale)}. Let the framing follow the action smoothly.`,
          facts.visualEffects &&
            `Effect synchronized to the action: ${facts.visualEffects}`,
          facts.soundEffects && `Synchronized sound effects: ${facts.soundEffects}`,
          "Keep contact, weight, breathing, gaze, and reactions continuous. No on-screen text.",
        ]
      : [
          `从参考画面自然承接 ${facts.durationSeconds} 秒，延续人物姿态、视线和动作趋势。`,
          `可见动作：${facts.action}`,
          facts.speakingCharacter &&
            `本镜由${facts.speakingCharacter}说话，面部与嘴部自然活动；其他人物倾听或回应。`,
          `结束状态：${facts.endState}`,
          `摄影机：${facts.camera || fixedCamera(context.locale)}；随动作平顺调整构图。`,
          facts.visualEffects && `随动作同步出现的效果：${facts.visualEffects}`,
          facts.soundEffects && `同步音效：${facts.soundEffects}`,
          "保持接触、重量、呼吸、视线和人物反应的连续性。不生成画面文字。",
        ];
  return lockVideoAudioPerformance(values.filter(Boolean).join("\n"), { ...facts, locale: context.locale });
}

type PromptFacts = {
  location: string;
  time: string;
  camera: string;
  characters: string[];
  props: string[];
  action: string;
  speakingCharacter?: string;
  lipSyncText?: string;
  voiceoverText?: string;
  durationSeconds: number;
  startState: string;
  endState: string;
  visualEffects: string;
  soundEffects: string;
};

type VfxCue = {
  phase: ActionPhase;
  category: VfxCueCategory;
  description: string;
};

type SfxCue = {
  phase: ActionPhase;
  type: SfxCueType;
  description: string;
};

function buildSemanticBeats(
  action: string,
  requestedDurationSeconds: number,
  locale: "en" | "zh",
  characters: string[],
  props: string[],
) {
  const units = anchorImplicitSubjects(
    semanticUnits(action),
    characters,
    props,
    locale,
  );
  if (!units.length)
    return [
      locale === "en" ? "Hold the current visual state." : "保持当前画面状态。",
    ];
  const normalizedDuration = Math.max(1, Math.round(requestedDurationSeconds));
  const desiredCount = Math.max(
    1,
    Math.min(
      units.length,
      Math.ceil(normalizedDuration / TARGET_BEAT_SECONDS),
      Math.max(1, Math.floor(normalizedDuration / 3)),
    ),
  );
  const separator = locale === "en" ? ", " : "，";
  const terminal = locale === "en" ? "." : "。";
  return distributeUnits(units, desiredCount).map(
    (group) =>
      `${group.join(separator).replace(/[，,。！？!?；;]+$/u, "")}${terminal}`,
  );
}

function semanticUnits(value: string) {
  return (value.match(/[^，,。！？!?；;\n]+[，,。！？!?；;]?/gu) ?? [])
    .map((item) => item.trim().replace(/[，,。！？!?；;]+$/u, ""))
    .filter(Boolean);
}

function anchorImplicitSubjects(
  units: string[],
  characters: string[],
  props: string[],
  locale: "en" | "zh",
) {
  let activeCharacter = characters.length === 1 ? characters[0] : "";
  return units.map((unit) => {
    const explicitCharacter = characters.find((name) => unit.includes(name));
    if (explicitCharacter) {
      activeCharacter = explicitCharacter;
      return unit;
    }
    if (!activeCharacter || props.some((name) => unit.includes(name)))
      return unit;
    if (locale === "en")
      return /^(?:he|she|they)\b/iu.test(unit)
        ? unit.replace(/^(?:he|she|they)\b/iu, activeCharacter)
        : unit;
    return /^(?:他|她|他们|她们|其)/u.test(unit)
      ? unit.replace(/^(?:他|她|他们|她们|其)/u, activeCharacter)
      : needsChineseSubject(unit)
        ? `${activeCharacter}${unit}`
        : unit;
  });
}

function needsChineseSubject(value: string) {
  return /^(?:猛然|突然|随即|立刻|缓缓|慢慢|迅速|继续|开始|再次|咬|抬|转|看|望|握|抓|举|推|拉|冲|跃|退|站|坐|跪|挥|挡|劈|刺|踢|出拳|发力|收势|停下)/u.test(
    value,
  );
}

function distributeUnits<T>(units: T[], count: number) {
  const result: T[][] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const remainingGroups = count - index;
    const remainingUnits = units.length - cursor;
    const take = Math.max(1, Math.ceil(remainingUnits / remainingGroups));
    result.push(units.slice(cursor, cursor + take));
    cursor += take;
  }
  return result;
}

function beatDurations(requestedDurationSeconds: number, count: number) {
  const total = Math.min(
    Math.max(1, Math.round(requestedDurationSeconds)),
    count * TARGET_BEAT_SECONDS,
  );
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from(
    { length: count },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

function distributeTextAcrossBeats(value: string, count: number) {
  const result = Array.from({ length: count }, () => [] as string[]);
  const units =
    value
      .match(/[^。！？!?；;\n]+[。！？!?；;]?/gu)
      ?.map((item) => item.trim())
      .filter(Boolean) ?? [];
  units.forEach((unit, index) => {
    result[
      Math.min(count - 1, Math.floor((index * count) / units.length))
    ].push(unit);
  });
  return result.map((items) => items.join(""));
}

function buildInitialState(input: {
  action: string;
  characters: string[];
  locale: "en" | "zh";
  location: string;
  props: string[];
}) {
  const subject = input.characters.length
    ? input.characters.join(input.locale === "en" ? ", " : "、")
    : input.locale === "en"
      ? "The visible subjects"
      : "画面主体";
  const propState = input.props.length
    ? input.locale === "en"
      ? `${input.props.join(", ")} remain in their pre-action positions`
      : `${input.props.join("、")}保持在动作开始前的位置`
    : input.locale === "en"
      ? "all visible objects remain in place"
      : "画面内物件保持原位";
  const interaction = initialPropInteraction(input);
  return {
    body:
      input.locale === "en"
        ? `${subject} are at ${input.location}; ${propState}; carry forward the prior pose with natural breathing and readiness.${interaction.body}`
        : `${subject}位于${input.location}；${propState}；承接上一镜姿态，保持自然呼吸与动作起势。${interaction.body}`,
    hands:
      interaction.hands ||
      (input.locale === "en"
        ? "Keep the pre-action hand position."
        : "保持动作前的手部位置。"),
    gaze:
      input.locale === "en"
        ? "Keep the established gaze direction."
        : "保持既定视线方向。",
    screenDirection:
      input.locale === "en"
        ? "Keep the approved screen direction."
        : "保持已批准的画面朝向。",
    props: interaction.props || propState,
  };
}

function initialPropInteraction(input: {
  action: string;
  locale: "en" | "zh";
  props: string[];
}) {
  const action = input.action.trim();
  const interactingProps = input.props.filter((prop) => action.includes(prop));
  const usesHands =
    /(?:握|抓|拿|拾|捡|举|抬|推|拉|按|触|扶|扛|抱|持|hold|grip|grab|pick|lift|raise|push|pull|press|touch|carry)/iu.test(
      action,
    );
  if (!interactingProps.length || !usesHands)
    return { body: "", hands: "", props: "" };
  const names = interactingProps.join(input.locale === "en" ? ", " : "、");
  return input.locale === "en"
    ? {
        body: ` Stage ${names} within immediate hand reach and keep the character, both hands, and the complete prop clearly visible in the same composition.`,
        hands: `Both hands are a few centimeters from the load-bearing contact points of ${names}, ready to begin the action but not yet completing it.`,
        props: `${names} stay directly in front of and within reach of the character, never behind them, off-screen, or in the distant background.`,
      }
    : {
        body: `为动作预留可执行构图：${names}位于角色双手正前方且触手可及，角色、双手与完整道具必须在同一构图中清晰可见。`,
        hands: `双手距${names}受力接触点仅数厘米，已经做好发力准备但尚未完成本镜动作。`,
        props: `${names}必须位于角色正前方近处且触手可及，不得放在人物身后、画外或远景。`,
      };
}

function buildEndState(action: string, locale: "en" | "zh") {
  const cleaned = action.replace(/[。.!]+$/u, "");
  return {
    body:
      locale === "en"
        ? `${cleaned}; the action completes and settles.`
        : `${cleaned}，动作完成后停稳。`,
    hands:
      locale === "en"
        ? "Hands settle at the completed action position."
        : "手部停在本次动作完成的位置。",
    gaze:
      locale === "en"
        ? "Gaze settles with the completed action."
        : "视线随本次动作结束后稳定。",
    screenDirection:
      locale === "en"
        ? "Keep the approved screen direction."
        : "保持已批准的画面朝向。",
    props:
      locale === "en"
        ? "Props settle at the completed action position."
        : "道具停在本次动作完成的位置。",
  };
}

function stateBody(state: Record<string, unknown>) {
  return typeof state.body === "string" ? state.body : "";
}

function collectVfxCues(scene: Screenplay["scenes"][number], fallback: string) {
  return uniqueCues<VfxCue>([
    ...(fallback
      ? [
          {
            phase: "release" as const,
            category: "environment_interaction" as const,
            description: fallback,
          },
        ]
      : []),
    ...scene.content.flatMap((item) =>
      item.type === "action" ? (item.actionDesign?.vfxPlan ?? []) : [],
    ),
  ]);
}

function collectSfxCues(scene: Screenplay["scenes"][number], fallback: string) {
  return uniqueCues<SfxCue>([
    ...(fallback
      ? [
          {
            phase: "release" as const,
            type: "environment" as const,
            description: fallback,
          },
        ]
      : []),
    ...scene.content.flatMap((item) =>
      item.type === "action" ? (item.actionDesign?.sfxPlan ?? []) : [],
    ),
  ]);
}

function uniqueCues<T extends { description: string }>(cues: T[]) {
  const seen = new Set<string>();
  return cues.filter((cue) => {
    const description = cue.description.trim();
    if (!description || seen.has(description)) return false;
    seen.add(description);
    return true;
  });
}

function cuesForBeat<T extends { phase: ActionPhase }>(
  cues: T[],
  beatIndex: number,
  beatCount: number,
) {
  return cues.filter((cue) => cueBeatIndex(cue.phase, beatCount) === beatIndex);
}

function cueBeatIndex(phase: ActionPhase, beatCount: number) {
  const phaseIndex = [
    "anticipation",
    "charge",
    "release",
    "travel",
    "impact",
    "aftermath",
  ].indexOf(phase);
  return Math.min(beatCount - 1, Math.floor((phaseIndex * beatCount) / 6));
}

function fixedCamera(locale: "en" | "zh") {
  return locale === "en" ? "locked-off camera" : "固定机位";
}

function cameraForBeat(
  camera: string,
  beatIndex: number,
  beatCount: number,
  locale: "en" | "zh",
) {
  const normalized = camera.trim().replace(/[。.!；;]+$/u, "");
  if (!normalized) return fixedCamera(locale);
  if (beatCount <= 1 || !hasCameraMovement(normalized)) return normalized;
  if (beatIndex === Math.floor(beatCount / 2)) return normalized;
  const framing = startingFraming(normalized, locale);
  return [framing, fixedCamera(locale)]
    .filter(Boolean)
    .join(locale === "en" ? ", " : "，");
}

function speakingCamera(camera: string, speaker: string, locale: "en" | "zh") {
  return locale === "en"
    ? `${camera}; keep ${speaker}'s face and mouth visible while preserving the eyeline`
    : `${camera}；保持视线轴线，清楚呈现${speaker}的面部与口部`;
}

function hasCameraMovement(value: string) {
  return /(?:推镜|推进|拉镜|后拉|摇镜|移镜|横移|跟拍|跟镜|升降|环绕|旋转|变焦|运镜|镜头运动|dolly|zoom|pan|tilt|track|crane|orbit|camera move|push in|pull out)/iu.test(
    value,
  );
}

function continuityConstraint(locale: "en" | "zh") {
  return locale === "en"
    ? "Preserve character identity, spatial layout, prop state, light, and screen direction from the first frame."
    : "承接首帧的人物身份、空间布局、道具状态、光线和画面朝向。";
}

function futureActionConstraint(locale: "en" | "zh") {
  return locale === "en"
    ? "Any action from a later beat."
    : "任何后续镜头动作。";
}

function startingFraming(value: string, locale: "en" | "zh") {
  return value
    .split(/[，,。；;\n]/u)
    .map((part) => part.trim())
    .filter((part) => part && !hasCameraMovement(part))
    .join(locale === "en" ? ", " : "，");
}

function parseScreenplay(clip: ProductionClip): Screenplay {
  if (!clip.screenplay)
    throw new Error(`STORYBOARD_SCREENPLAY_REQUIRED:${clip.id}`);
  try {
    return screenplayConversionSchema.parse(JSON.parse(clip.screenplay));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`STORYBOARD_SCREENPLAY_INVALID:${clip.id}:${message}`);
  }
}

function readLabeledValue(sourceText: string, labels: string[]) {
  const escaped = labels.map(escapeRegExp).join("|");
  const match = sourceText.match(
    new RegExp(
      `(?:^|\\n)\\s*(?:\\*{1,2}|_{1,2})?\\s*(?:${escaped})\\s*(?:\\*{1,2}|_{1,2})?\\s*[：:]\\s*(?:\\*{1,2}|_{1,2})?\\s*([^\\n]+)`,
      "iu",
    ),
  );
  return match?.[1]?.replace(/(?:\*{1,2}|_{1,2})\s*$/u, "").trim() ?? "";
}

function visualOnly(value: string) {
  return value
    .split(/[，,。；;]/u)
    .map((part) => part.trim())
    .filter(
      (part) =>
        part &&
        !/(?:声音|音效|配乐|旁白|对白|人声|sound|audio|music|dialogue|narration)/iu.test(
          part,
        ),
    )
    .join("；");
}

function cameraFromDescription(value: string) {
  return (
    value
      .split(/\r?\n/u)
      .find((line) => /^(?:镜头表达|镜头|camera)\s*[：:]/iu.test(line.trim()))
      ?.replace(/^[^：:]+[：:]\s*/u, "")
      .trim() ?? ""
  );
}

function inferShotType(camera: string, characterCount: number) {
  const match = camera.match(
    /(?:大远景|远景|全景|中景|近景|特写|wide shot|medium shot|close-up)/iu,
  );
  return match?.[0] ?? (characterCount > 1 ? "双人中景" : "中景");
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
