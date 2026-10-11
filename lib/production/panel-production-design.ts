import { z } from "zod";

const text = z.string().trim().min(1);

/** Same field names as the storyboard editor; no second production data model. */
export const PanelProductionDesignSchema = z.object({
  photography: z.object({
    camera: text, cameraPosition: text, focalLength: text, lighting: text,
    composition: text, depthOfField: text, colorTone: text,
  }),
  acting: z.array(z.object({ name: text, emotion: text, action: text, expression: text })),
  startState: z.object({ body: text, hands: text, gaze: text, screenDirection: text, props: text }),
  motionBeats: z.array(z.object({
    startSecond: z.number().nonnegative(), endSecond: z.number().positive(),
    action: text, camera: text,
  })).min(1),
  worldContext: z.object({
    realm: text, technique: text, powerRule: text, environmentScale: text,
    evidence: z.array(text).min(1),
  }),
  vfxCues: z.array(z.object({
    atSecond: z.number().nonnegative(), category: text, description: text,
    evidence: z.array(text).min(1),
  })),
  sfxCues: z.array(z.object({
    startSecond: z.number().nonnegative(), endSecond: z.number().positive(),
    category: text, description: text, evidence: z.array(text).min(1),
  })),
});

export type PanelProductionDesign = z.infer<typeof PanelProductionDesignSchema>;

export function validatePanelProductionDesign(
  design: PanelProductionDesign, duration: number, characters: string[],
) {
  const errors: string[] = [];
  const names = design.acting.map(actor => actor.name);
  if (new Set(names).size !== names.length || names.some(name => !characters.includes(name)) ||
      characters.some(name => !names.includes(name))) errors.push("acting must cover each visible character exactly once");
  let end = 0;
  for (const beat of design.motionBeats) {
    if (Math.abs(beat.startSecond - end) > 0.01 || beat.endSecond <= beat.startSecond || beat.endSecond > duration)
      errors.push("motionBeats must continuously cover the duration in order");
    end = beat.endSecond;
  }
  if (Math.abs(end - duration) > 0.01) errors.push("motionBeats must end at the declared duration");
  if (design.vfxCues.some(cue => cue.atSecond > duration)) errors.push("VFX cue exceeds duration");
  if (design.sfxCues.some(cue => cue.endSecond <= cue.startSecond || cue.endSecond > duration))
    errors.push("SFX cue has invalid timing");
  return errors;
}

export const PANEL_PRODUCTION_DESIGN_INSTRUCTIONS = `Include productionDesign using the provided schema. It supplies the existing storyboard editor's photography, acting, startState, motionBeats, worldContext, vfxCues and sfxCues.
Design actionable camera position, focal length, composition/blocking, lighting, depth of field and color tone, consistent with the image/video prompts. These are proposed directing choices, not claims quoted from the screenplay.
acting must cover every visible character exactly once, with emotion, action and visible expression. Empty acting is allowed only when no character is visible.
motionBeats must cover the declared duration continuously from 0, without gaps or overlaps, and agree with the video prompt.
World constraints must follow supplied canon with evidence; explicitly state 'not applicable' for absent realms or techniques instead of inventing powers. Describe practical environment scale even for ordinary scenes.
Derive timed VFX and SFX/Foley from visible events and supplied sound direction, keep times within duration, cite evidence. Use empty cue arrays when genuinely unnecessary; do not invent effects to fill fields. SFX cues are sound design instructions; generated video remains silent.`;
