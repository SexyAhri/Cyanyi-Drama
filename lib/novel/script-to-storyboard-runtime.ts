import { createHash } from "node:crypto";

import { screenplayConversionSchema } from "@/lib/prompts/schemas";
import { listProductionClips, listProductionProps } from "@/lib/production/domain-store";
import { getProjectArtStyleDirective } from "@/lib/projects/art-style";
import { prisma } from "@/lib/server/prisma";

import { parseApprovedScreenplay } from "./approved-screenplay-parser";
import { getStoryboard, saveStoryboard } from "./domain-store";

type ProductionClip = NonNullable<
  Awaited<ReturnType<typeof listProductionClips>>
>[number];
type Screenplay = ReturnType<typeof screenplayConversionSchema.parse>;

export type ScriptToStoryboardStepInput = {
  projectId: string;
  episodeId: string;
  locale?: "en" | "zh";
};

export type ScriptToStoryboardRuntimeHooks = {
  assertActive: () => Promise<void>;
  persistArtifact: (
    artifactType: string,
    refId: string,
    payload: unknown,
  ) => Promise<void>;
};

type SceneStoryboardContext = {
  artStyle: string;
  productionSpec: string;
  visualRules: string;
  propNames: string[];
  locale: "en" | "zh";
};

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
        project: { select: { config: { select: { artStyle: true } } } },
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
  const panels = buildSceneStoryboardPanels(clips, context);
  const sourceHash = sha256(
    JSON.stringify({
      clips: clips.map((clip) => ({ id: clip.id, screenplay: clip.screenplay })),
      artStyle: context.artStyle,
      productionSpec: context.productionSpec,
      visualRules: context.visualRules,
    }),
  );

  await hooks.assertActive();
  const storyboard = await saveStoryboard(
    userId,
    input.projectId,
    input.episodeId,
    {
      status: "ready",
      sourceHash,
      preserveImagePrompts: existingStoryboard?.sourceHash === sourceHash,
      panels,
    },
  );
  if (!storyboard) throw new Error("STORYBOARD_PERSIST_FAILED");

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
    source: "local-production-script",
    clipCount: clips.length,
    sceneCount: panels.length,
    storyboardId: storyboard.id,
    sourceHash,
  };
  await hooks.persistArtifact("storyboard.scenes", input.episodeId, artifact);

  return {
    ...artifact,
    panelCount: storyboard.panels.length,
    promptTraces: [],
  };
}

export function buildSceneStoryboardPanels(
  clips: ProductionClip[],
  context: SceneStoryboardContext,
) {
  let panelIndex = 0;
  return clips.flatMap((clip) => {
    const screenplay = parseScreenplay(clip);
    const sourceScenes = parseApprovedScreenplay(clip.content);
    return screenplay.scenes.map((scene, clipPanelIndex) => {
      const sourceScene = sourceScenes[clipPanelIndex] ?? sourceScenes[0];
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
      const sceneText = [sourceScene?.sourceText, action].filter(Boolean).join("\n");
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
      const durationSeconds = sourceScene?.durationSeconds ?? 8;
      const camera = sourceScene?.camera || cameraFromDescription(scene.description);
      const visualEffects = unique([
        sourceScene?.visualEffects ?? "",
        ...scene.content.flatMap((item) =>
          item.type === "action"
            ? (item.actionDesign?.vfxPlan ?? []).map((cue) => cue.description)
            : [],
        ),
      ]).join("；");
      const sound = unique([
        sourceScene?.sound ?? "",
        ...scene.content.flatMap((item) =>
          item.type === "action"
            ? (item.actionDesign?.sfxPlan ?? []).map((cue) => cue.description)
            : [],
        ),
      ]).join("；");
      const globalIndex = panelIndex++;
      const promptFacts = {
        location: scene.heading.location,
        time: scene.heading.time,
        camera,
        characters,
        props,
        action,
        visualEffects,
      };
      return {
        clipId: clip.id,
        clipPanelIndex,
        panelIndex: globalIndex,
        sceneNumber: globalIndex,
        shotType: inferShotType(camera, characters.length),
        cameraMove: camera || null,
        description: action || scene.description || sceneText.trim(),
        locationName: scene.heading.location,
        characters,
        props,
        imagePrompt: buildImagePrompt(context, promptFacts),
        videoPrompt: buildSilentVideoPrompt(context, promptFacts),
        durationSeconds,
        subtitleText: null,
        speakingCharacter: null,
        lipSyncText: null,
        voiceoverText: voiceover || null,
        startState: {},
        endState: {},
        motionBeats: action
          ? [{ startSecond: 0, endSecond: durationSeconds, action, camera }]
          : [],
        worldContext: {
          productionSpec: context.productionSpec,
          visualRules: context.visualRules,
        },
        vfxCues: visualEffects
          ? [{ atSecond: 0, phase: "release", description: visualEffects }]
          : [],
        sfxCues: sound
          ? [{ startSecond: 0, endSecond: durationSeconds, description: sound }]
          : [],
        actingNotes: {},
        photographyRules: camera || null,
        phase: "scene",
        status: "ready",
        linkedToNextPanel: false,
        sourceEvidence: action ? [action] : [],
      };
    });
  });
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

function buildImagePrompt(
  context: SceneStoryboardContext,
  facts: PromptFacts,
) {
  const values =
    context.locale === "en"
      ? [
          context.artStyle,
          context.productionSpec && `Production specification: ${context.productionSpec}`,
          context.visualRules && `Global visual rules: ${context.visualRules}`,
          `Scene: ${facts.location}; time: ${facts.time}`,
          facts.camera && `Framing and camera: ${facts.camera}`,
          facts.characters.length && `Characters: ${facts.characters.join(", ")}`,
          facts.props.length && `Props: ${facts.props.join(", ")}`,
          `Visible action: ${facts.action}`,
          facts.visualEffects && `Visible effects: ${facts.visualEffects}`,
          "No subtitles, captions, logos, watermarks, or readable text.",
        ]
      : [
          context.artStyle,
          context.productionSpec && `成片规格：${context.productionSpec}`,
          context.visualRules && `全局视觉规则：${context.visualRules}`,
          `场景：${facts.location}；时间：${facts.time}`,
          facts.camera && `构图与镜头：${facts.camera}`,
          facts.characters.length && `出场角色：${facts.characters.join("、")}`,
          facts.props.length && `画面道具：${facts.props.join("、")}`,
          `可见画面与动作：${facts.action}`,
          facts.visualEffects && `可见特效：${facts.visualEffects}`,
          "画面中不得出现字幕、标题、标识、水印或任何可读文字。",
        ];
  return values.filter(Boolean).join("\n");
}

function buildSilentVideoPrompt(
  context: SceneStoryboardContext,
  facts: PromptFacts,
) {
  const visualPrompt = buildImagePrompt(context, facts);
  const guard =
    context.locale === "en"
      ? "Generate silent video only: no speech, voices, dialogue, narration, lip-synced speaking, music, or sound effects. Characters keep their mouths naturally closed unless the visible action explicitly requires otherwise. Do not render text."
      : "仅生成静音视频：禁止人声、对白、旁白、口型说话、音乐和音效；除非可见动作明确需要，角色嘴部自然闭合；不得渲染任何文字。";
  return `${visualPrompt}\n${guard}`;
}

type PromptFacts = {
  location: string;
  time: string;
  camera: string;
  characters: string[];
  props: string[];
  action: string;
  visualEffects: string;
};

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
  return value
    .split(/\r?\n/u)
    .find((line) => /^(?:镜头表达|镜头|camera)\s*[：:]/iu.test(line.trim()))
    ?.replace(/^[^：:]+[：:]\s*/u, "")
    .trim() ?? "";
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
