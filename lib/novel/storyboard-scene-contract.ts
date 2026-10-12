import { z } from "zod";
import { screenplayConversionSchema } from "@/lib/prompts/schemas";
import { estimateSpeechDurationSeconds } from "@/lib/prompts/validators";
import { MAX_STORYBOARD_SHOT_SECONDS, splitSpokenTextForShots } from "./storyboard-dialogue-timing";
import { lockSilentVideoPerformance } from "@/lib/media/director-prompt-locks";
import { PanelProductionDesignSchema, validatePanelProductionDesign } from "@/lib/production/panel-production-design";

export type DirectorScene = ReturnType<typeof buildDirectorScenes>[number];
export function buildDirectorScenes(
  clips: Array<{ id: string; screenplay: string | null; props: string[] }>,
  propNames: string[],
) {
  let sceneNumber = 0;
  return clips.flatMap((clip) => {
    if (!clip.screenplay) throw new Error("STORYBOARD_SCREENPLAY_REQUIRED");
    const screenplay = screenplayConversionSchema.parse(
      JSON.parse(clip.screenplay),
    );
    return screenplay.scenes.map((scene, localIndex) => {
      const id = `${clip.id}:${localIndex}`;
      const units = scene.content.map((item, contentIndex) => ({
        id: `${id}:${contentIndex}`,
        contentIndex,
        type: item.type,
        text: item.type === "dialogue" ? item.lines : item.text,
        speaker: item.type === "action" ? null : (item.character ?? null),
        parenthetical:
          item.type === "dialogue" ? (item.parenthetical ?? null) : null,
        actionDesign:
          item.type === "action" ? (item.actionDesign ?? null) : null,
      }));
      const text = [scene.description, ...units.map((unit) => unit.text)].join(
        "\n",
      );
      return {
        id,
        clipId: clip.id,
        sceneNumber: sceneNumber++,
        heading: scene.heading,
        description: scene.description,
        characters: [
          ...new Set([
            ...scene.characters,
            ...units.flatMap((unit) =>
              unit.type === "dialogue" && unit.speaker ? [unit.speaker] : [],
            ),
          ]),
        ],
        props: [
          ...new Set([
            ...clip.props,
            ...propNames.filter((name) => text.includes(name)),
          ]),
        ],
        units,
      };
    });
  });
}

export const directorShotsSchema = z.object({
  shots: z
    .array(
      z.object({
        title: z.string().min(1),
        shot_type: z.string().min(1),
        duration_seconds: z.number().min(1).max(MAX_STORYBOARD_SHOT_SECONDS),
        source_unit_ids: z.array(z.string()).min(1),
        characters: z.array(z.string()),
        asset_names: z.array(z.string()),
        scene_description: z.string().min(1),
        action_description: z.string().min(1),
        camera_move: z.string(),
        start_state: z.string().min(1),
        end_state: z.string().min(1),
        motion_beats: z
          .array(
            z.object({
              start_second: z.number().nonnegative(),
              end_second: z.number().positive(),
              action: z.string().min(1),
              camera: z.string(),
            }),
          )
          .min(1),
        speech: z
          .object({ source_id: z.string(), text: z.string().min(1) })
          .nullable(),
        image_prompt: z.string().min(1),
        video_prompt: z.string().min(1),
        productionDesign: PanelProductionDesignSchema.optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type DirectorShot = z.infer<typeof directorShotsSchema>["shots"][number];
export const directorShotsGenerationSchema = z.object({
  shots: z.array(directorShotsSchema.shape.shots.element.omit({
    start_state: true,
    motion_beats: true,
  }).extend({
    productionDesign: PanelProductionDesignSchema,
  })).min(1).max(200),
});

/** Generate the production design once; materialize legacy fields for stored panels. */
export function materializeDirectorShots(
  shots: z.infer<typeof directorShotsGenerationSchema>["shots"],
): DirectorShot[] {
  return shots.map(shot => ({
    ...shot,
    start_state: shot.productionDesign.startState.body,
    motion_beats: shot.productionDesign.motionBeats.map(beat => ({
      start_second: beat.startSecond,
      end_second: beat.endSecond,
      action: beat.action,
      camera: beat.camera,
    })),
  }));
}

export function directorSpeechTiming(scene: DirectorScene) {
  return scene.units.filter(unit => unit.type !== "action").map(unit => ({
    source_id: unit.id,
    minimum_seconds: estimateSpeechDurationSeconds(unit.text),
    suggested_fragments: splitSpokenTextForShots(unit.text).map(text => ({
      text,
      minimum_seconds: estimateSpeechDurationSeconds(text),
    })),
  }));
}

export function validateDirectorShots(
  scene: DirectorScene,
  shots: DirectorShot[],
) {
  const errors: string[] = [];
  const allowed = new Set([
    ...scene.characters,
    ...scene.props,
    scene.heading.location,
  ]);
  const covered = new Set<string>();
  const spoken = new Map<string, string>();
  let lastSpeechIndex = -1;
  let lastSourceIndex = -1;
  for (const [index, shot] of shots.entries()) {
    const label = `shots.${index}`;
    if (shot.productionDesign) {
      errors.push(...validatePanelProductionDesign(shot.productionDesign, shot.duration_seconds, shot.characters)
        .map(message => `${label}: ${message}`));
      if (shot.productionDesign.startState.body !== shot.start_state ||
          JSON.stringify(shot.productionDesign.motionBeats) !== JSON.stringify(shot.motion_beats.map(beat => ({
            startSecond: beat.start_second, endSecond: beat.end_second, action: beat.action, camera: beat.camera,
          })))) errors.push(`${label}: productionDesign must agree with start_state and motion_beats`);
    }
    const sources = shot.source_unit_ids.map((id) =>
      scene.units.find((unit) => unit.id === id),
    );
    if (sources.some((unit) => !unit))
      errors.push(`${label}: unknown source_unit_ids`);
    const indices = sources.flatMap((unit) =>
      unit ? [unit.contentIndex] : [],
    );
    if (indices.length && Math.max(...indices) < lastSourceIndex)
      errors.push(`${label}: source chronology reversed`);
    if (indices.length)
      lastSourceIndex = Math.max(lastSourceIndex, Math.min(...indices));
    shot.source_unit_ids.forEach((id) => covered.add(id));
    if (
      shot.asset_names.some((name) => !allowed.has(name)) ||
      shot.characters.some((name) => !scene.characters.includes(name))
    )
      errors.push(`${label}: unknown asset or character`);
    if (new Set(shot.asset_names).size !== shot.asset_names.length)
      errors.push(`${label}: duplicate asset_names`);
    if (shot.characters.some((name) => !shot.asset_names.includes(name)))
      errors.push(
        `${label}: visible character must be included in asset_names`,
      );
    if (!shot.asset_names.includes(scene.heading.location))
      errors.push(`${label}: scene location must be included in asset_names`);
    const shotVisualText = [
      shot.scene_description,
      shot.action_description,
      shot.start_state,
      shot.end_state,
      ...shot.motion_beats.map((beat) => beat.action),
      shot.image_prompt,
      shot.video_prompt,
    ].join("\n");
    for (const prop of scene.props) {
      if (
        shotVisualText.includes(prop) &&
        !shot.asset_names.includes(prop)
      )
        errors.push(`${label}: referenced prop ${prop} must be included in asset_names`);
    }
    let beatEnd = 0;
    for (const beat of shot.motion_beats) {
      if (
        beat.start_second < beatEnd ||
        beat.end_second <= beat.start_second ||
        beat.end_second > shot.duration_seconds
      )
        errors.push(`${label}: invalid motion beat interval`);
      beatEnd = beat.end_second;
    }
    if (shot.speech) {
      const source = scene.units.find(
        (unit) => unit.id === shot.speech!.source_id,
      );
      if (
        !source ||
        source.type === "action" ||
        !shot.source_unit_ids.includes(source.id)
      ) {
        errors.push(`${label}: invalid speech source`);
        continue;
      }
      if (source.contentIndex < lastSpeechIndex)
        errors.push(`${label}: dialogue order changed`);
      lastSpeechIndex = source.contentIndex;
      const value = (spoken.get(source.id) ?? "") + shot.speech.text;
      spoken.set(source.id, value);
      if (!source.text.startsWith(value))
        errors.push(`${label}: speech is not an exact source fragment`);
      if (
        source.type === "dialogue" &&
        source.speaker &&
        !shot.characters.includes(source.speaker)
      )
        errors.push(`${label}: speaking character must be visible`);
      const minimumSeconds = estimateSpeechDurationSeconds(shot.speech.text);
      if (minimumSeconds > shot.duration_seconds)
        errors.push(`${label}: speech exceeds shot duration: source_id=${source.id}, needs at least ${minimumSeconds}s, declared ${shot.duration_seconds}s. ${minimumSeconds > MAX_STORYBOARD_SHOT_SECONDS ? "Split into more shots using exact source substrings; each shot must be at most 15s." : "Increase duration and update motion beats, cue timing and video prompt, or split into exact source substrings."}`);
    }
    const previous = shots[index - 1];
    if (
      previous &&
      previous.action_description === shot.action_description &&
      previous.image_prompt === shot.image_prompt &&
      !shot.speech
    )
      errors.push(`${label}: duplicated shot`);
  }
  for (const unit of scene.units) {
    if (!covered.has(unit.id)) errors.push(`missing source unit ${unit.id}`);
    if (unit.type !== "action" && spoken.get(unit.id) !== unit.text)
      errors.push(`speech must exactly cover ${unit.id}: ${unit.text}`);
  }
  return errors;
}

export function directorScenePanels(
  scene: DirectorScene,
  shots: DirectorShot[],
  locale: "zh" | "en",
) {
  const cueShot = (unitId: string, phase: string) => {
    const indices = shots.flatMap((shot, index) =>
      shot.source_unit_ids.includes(unitId) ? [index] : [],
    );
    const phaseIndex = Math.max(
      0,
      [
        "anticipation",
        "charge",
        "release",
        "travel",
        "impact",
        "aftermath",
      ].indexOf(phase),
    );
    return indices[
      Math.min(
        indices.length - 1,
        Math.floor((phaseIndex * indices.length) / 6),
      )
    ];
  };
  return shots.map((shot, localIndex) => {
    const speech = scene.units.find(
      (unit) => unit.id === shot.speech?.source_id,
    );
    const speakingCharacter =
      speech?.type === "dialogue" ? speech.speaker : null;
    const voiceoverText =
      speech?.type === "voiceover" ? shot.speech!.text : null;
    return {
      previewId: `${scene.id}:shot:${localIndex}`,
      sceneId: scene.id,
      localIndex,
      clipId: scene.clipId,
      clipPanelIndex: localIndex,
      panelIndex: localIndex,
      sceneNumber: scene.sceneNumber,
      shotType: shot.shot_type,
      cameraMove: shot.camera_move,
      description: shot.action_description,
      locationName: scene.heading.location,
      characters: shot.characters,
      props: scene.props.filter((name) => shot.asset_names.includes(name)),
      imagePrompt: shot.image_prompt,
      videoPrompt: lockSilentVideoPerformance(shot.video_prompt, {
        speakingCharacter,
        voiceoverText,
        locale,
      }),
      durationSeconds: shot.duration_seconds,
      subtitleText: null,
      speakingCharacter,
      lipSyncText: speakingCharacter ? shot.speech!.text : null,
      voiceoverText,
      startState: shot.productionDesign?.startState ?? { body: shot.start_state },
      endState: { body: shot.end_state },
      motionBeats: shot.motion_beats.map((beat) => ({
        startSecond: beat.start_second,
        endSecond: beat.end_second,
        action: beat.action,
        camera: beat.camera,
      })),
      actingNotes: {
        title: shot.title,
        sourceSceneId: scene.id,
        sourceUnitIds: shot.source_unit_ids,
        sourceSpeech: speech
          ? { contentIndex: speech.contentIndex, sourceId: speech.id }
          : null,
        characters: shot.productionDesign?.acting ?? shot.characters.map((name) => ({
          name,
          emotion: "",
          expression: "",
          action: shot.action_description,
        })),
      },
      photographyRules: JSON.stringify(shot.productionDesign?.photography ?? {
        camera: shot.camera_move,
        composition: shot.shot_type,
        cameraPosition: shot.scene_description,
      }),
      phase: "scene",
      status: "ready",
      worldContext: shot.productionDesign?.worldContext,
      linkedToNextPanel: localIndex < shots.length - 1,
      vfxCues: shot.productionDesign?.vfxCues ?? scene.units.flatMap((unit) =>
        (unit.actionDesign?.vfxPlan ?? [])
          .filter((cue) => cueShot(unit.id, cue.phase) === localIndex)
          .map((cue) => ({
            ...cue,
            atSecond: Math.max(0, shot.duration_seconds / 2),
            evidence: [unit.text],
          })),
      ),
      sfxCues: shot.productionDesign?.sfxCues ?? scene.units.flatMap((unit) =>
        (unit.actionDesign?.sfxPlan ?? [])
          .filter((cue) => cueShot(unit.id, cue.phase) === localIndex)
          .map((cue) => ({
            ...cue,
            startSecond: 0,
            endSecond: shot.duration_seconds,
            evidence: [unit.text],
          })),
      ),
      sourceEvidence: scene.units
        .filter((unit) => shot.source_unit_ids.includes(unit.id))
        .map((unit) => unit.text),
    };
  });
}
