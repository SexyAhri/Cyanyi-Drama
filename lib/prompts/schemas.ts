import { z } from "zod";

import { PROMPT_IDS, type PromptId } from "./ids";
import {
  ACTION_DESIGN_KINDS,
  ACTION_PHASES,
  SFX_CUE_TYPES,
  VFX_CUE_CATEGORIES,
} from "@/lib/production/action-cues";

const text = z.string().trim().min(1);
const exactText = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Text cannot be whitespace only");
const optionalText = z.string().trim().min(1).nullish();
const stringList = z.array(text).max(100).default([]);
const evidenceQuotes = z.array(exactText).min(1).max(12);
const interactionContact = z.enum([
  "none",
  "touch",
  "grab",
  "strike",
  "block",
  "transfer",
  "support",
]);

const actionDesignSchema = z
  .object({
    kind: z.enum(ACTION_DESIGN_KINDS),
    performer: text,
    target: optionalText,
    realm: optionalText,
    technique: optionalText,
    visualMotif: optionalText,
    visualMotifSource: z
      .enum(["source", "world_bible", "production_inference"])
      .nullish(),
    visualMotifRationale: optionalText,
    choreography: z.array(text).min(1).max(12),
    impact: optionalText,
    environmentResponse: optionalText,
    vfxPlan: z
      .array(
        z
          .object({
            phase: z.enum(ACTION_PHASES),
            category: z.enum(VFX_CUE_CATEGORIES),
            description: text,
          })
          .strict(),
      )
      .max(12),
    sfxPlan: z
      .array(
        z
          .object({
            phase: z.enum(ACTION_PHASES),
            type: z.enum(SFX_CUE_TYPES),
            description: text,
          })
          .strict(),
      )
      .max(12),
    evidence: evidenceQuotes,
  })
  .strict();

const characterSchema = z
  .object({
    name: text,
    aliases: stringList,
    profile: z.record(z.string(), z.unknown()).default({}),
    introduction: optionalText,
    evidence: evidenceQuotes,
  })
  .strict();

const locationSchema = z
  .object({
    name: text,
    summary: optionalText,
    evidence: evidenceQuotes,
  })
  .strict();

const propSchema = z
  .object({
    name: text,
    summary: optionalText,
    evidence: evidenceQuotes,
  })
  .strict();

export const characterAnalysisSchema = z
  .object({ characters: z.array(characterSchema).max(200) })
  .strict();

export const locationPropAnalysisSchema = z
  .object({
    locations: z.array(locationSchema).max(200),
    props: z.array(propSchema).max(100),
  })
  .strict();

export const clipSegmentationSchema = z
  .object({
    clips: z.array(
      z
        .object({
          endUnitId: z.string().regex(/^U\d{4,}$/),
          summary: text,
          location: z.string().trim().nullable(),
          characters: stringList,
          props: stringList,
        })
        .strict(),
    ).min(1),
  })
  .strict();

const screenplayContentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("action"),
      text: exactText,
      // Bridges complete an explicit event; inferred actions enrich performance or continuity.
      origin: z.enum(["source", "bridge", "inferred"]).optional(),
      evidence: evidenceQuotes.optional(),
      inferenceType: z
        .enum(["performance", "continuity", "production_detail"])
        .optional(),
      rationale: optionalText,
      confidence: z.number().min(0).max(1).optional(),
      actionDesign: actionDesignSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("dialogue"),
      character: text,
      parenthetical: optionalText,
      lines: exactText,
    })
    .strict(),
  z
    .object({
      type: z.literal("voiceover"),
      character: optionalText,
      text: exactText,
    })
    .strict(),
]);

export const screenplayConversionSchema = z
  .object({
    clipId: text,
    originalText: exactText,
    coverage: z
      .array(
        z
          .object({
            eventId: z.string().regex(/^E\d{3,}$/),
            evidence: exactText,
            modes: z
              .array(z.enum(["visual", "dialogue", "voiceover", "omitted"]))
              .min(1)
              .max(4),
            reason: optionalText,
          })
          .strict(),
      )
      .max(500)
      .optional(),
    scenes: z.array(
      z
        .object({
          sceneNumber: z.number().int().nonnegative(),
          heading: z
            .object({
              intExt: z.enum(["INT", "EXT"]),
              location: text,
              time: text,
            })
            .strict(),
          description: z.string(),
          characters: stringList,
          content: z.array(screenplayContentSchema).min(1),
        })
        .strict(),
    ).min(1).max(200),
  })
  .strict();

export type ScreenplayConversion = z.infer<typeof screenplayConversionSchema>;

const continuityStateSchema = z
  .object({
    body: text,
    hands: text,
    gaze: text,
    screenDirection: text,
    props: text,
    characterStates: z
      .array(
        z
          .object({
            name: text,
            position: text,
            posture: text,
            facing: text,
            gazeTarget: optionalText,
            leftHand: text,
            rightHand: text,
            contact: optionalText,
          })
          .strict(),
      )
      .max(30)
      .optional(),
    propStates: z
      .array(
        z
          .object({
            name: text,
            holder: optionalText,
            position: text,
            state: text,
          })
          .strict(),
      )
      .max(30)
      .optional(),
  })
  .strict();

const worldContextSchema = z
  .object({
    realm: optionalText,
    technique: optionalText,
    powerRule: optionalText,
    visualMotif: optionalText,
    environmentScale: optionalText,
    evidence: evidenceQuotes.optional(),
  })
  .strict();

const vfxCueSchema = z
  .object({
    atSecond: z.number().int().min(0).max(15),
    phase: z.enum(ACTION_PHASES),
    category: z.enum(VFX_CUE_CATEGORIES),
    description: text,
    evidence: evidenceQuotes,
  })
  .strict();

const sfxCueSchema = z
  .object({
    startSecond: z.number().int().min(0).max(15),
    endSecond: z.number().int().min(0).max(15),
    type: z.enum(SFX_CUE_TYPES),
    description: text,
    evidence: evidenceQuotes,
  })
  .strict();

export const storyboardPanelSchema = z
  .object({
    panelIndex: z.number().int().nonnegative(),
    sceneNumber: z.number().int().nonnegative().optional(),
    shotType: text,
    cameraMove: text,
    durationSeconds: z.number().int().min(1).max(15),
    motionTimeline: z
      .array(
        z
          .object({
            startSecond: z.number().int().min(0).max(14),
            endSecond: z.number().int().min(1).max(15),
            action: text,
            camera: text,
            phase: z.enum(ACTION_PHASES).optional(),
            beatId: optionalText,
            actor: optionalText,
            target: optionalText,
            bodyPart: optionalText,
            prop: optionalText,
            trajectory: optionalText,
            contact: interactionContact.optional(),
            contactPoint: optionalText,
            reaction: optionalText,
            result: optionalText,
            causedBy: optionalText,
            choreographyStep: optionalText,
          })
          .strict(),
      )
      .min(1)
      .max(15),
    startState: continuityStateSchema.optional(),
    endState: continuityStateSchema.optional(),
    worldContext: worldContextSchema.optional(),
    vfxCues: z.array(vfxCueSchema).max(24).default([]),
    sfxCues: z.array(sfxCueSchema).max(24).default([]),
    speakingCharacter: optionalText,
    lipSyncText: optionalText,
    voiceoverText: optionalText,
    description: text,
    locationName: optionalText,
    characters: stringList,
    props: stringList,
    imagePrompt: optionalText,
    videoPrompt: text,
    sourceEvidence: evidenceQuotes,
  })
  .strict();

export const storyboardPlanningSchema = z
  .object({ panels: z.array(storyboardPanelSchema).min(1).max(500) })
  .strict();

export const cinematographySchema = z
  .object({
    rules: z.array(
      z
        .object({
          panelIndex: z.number().int().nonnegative(),
          camera: text,
          cameraPosition: text,
          focalLength: text,
          lighting: text,
          composition: text,
          depthOfField: text,
          colorTone: text,
        })
        .strict(),
    ),
  })
  .strict();

export const actingDirectionSchema = z
  .object({
    directions: z.array(
      z
        .object({
          panelIndex: z.number().int().nonnegative(),
          characters: z.array(
            z
              .object({
                name: text,
                emotion: text,
                action: text,
                expression: text,
                evidence: evidenceQuotes,
                beats: z
                  .array(
                    z
                      .object({
                        startSecond: z.number().int().min(0).max(14),
                        endSecond: z.number().int().min(1).max(15),
                        objective: text,
                        subtext: optionalText,
                        action: text,
                        expression: text,
                        gazeTarget: optionalText,
                        reactionTo: optionalText,
                        evidence: evidenceQuotes,
                      })
                      .strict(),
                  )
                  .max(15)
                  .optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();

export const storyboardRefinementSchema = z
  .object({ panels: z.array(storyboardPanelSchema).min(1).max(500) })
  .strict();

export const voiceAnalysisSchema = z
  .object({
    lines: z.array(
      z
        .object({
          speaker: text,
          content: exactText,
          delivery: z
            .enum(["dialogue", "inner_monologue", "voiceover"])
            .default("dialogue"),
          emotionPrompt: optionalText,
          emotionStrength: z.number().min(0).max(1),
          matchedPanelIndex: z.number().int().nonnegative().nullable(),
        })
        .strict(),
    ).max(500),
  })
  .strict();

export const continuityReviewSchema = z
  .object({
    passed: z.boolean(),
    issues: z.array(
      z
        .object({
          code: text,
          severity: z.enum(["error", "warning"]),
          panelIndex: z.number().int().nonnegative().nullable(),
          entityType: z
            .enum(["character", "location", "prop", "camera", "timeline"])
            .nullable(),
          entityName: optionalText,
          message: text,
          suggestedFix: optionalText,
        })
        .strict(),
    ).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    const hasErrors = value.issues.some((issue) => issue.severity === "error");
    if (value.passed === hasErrors)
      context.addIssue({
        code: "custom",
        message: "passed must be false exactly when error issues exist",
        path: ["passed"],
      });
  });

const visualEntitySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(4_000),
    evidence: z.array(z.string().trim().min(1)).min(1).max(12),
  })
  .strict();

export const visualAssetExtractionSchema = z
  .object({
    characters: z.array(visualEntitySchema).max(30),
    locations: z.array(visualEntitySchema).max(30),
    props: z.array(visualEntitySchema).max(50),
  })
  .strict();

export const characterReferenceDescriptionSchema = z
  .object({
    description: z.string().trim().min(1).max(8_000),
    uncertainties: z.array(z.string().trim().min(1)).max(20),
  })
  .strict();

export const episodeSplitSchema = z
  .object({
    episodes: z
      .array(
        z
          .object({
            number: z.number().int().positive(),
            title: z.string().trim().min(1).max(160),
            summary: z.string().trim().max(4_000),
            startMarker: exactText,
            endMarker: exactText,
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const episodeAdaptationSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(4_000),
    adaptedText: z.string().trim().min(1).max(500_000),
    changeSummary: z.array(z.string().trim().min(1).max(600)).max(30),
    sourceEvidence: z
      .array(z.string().trim().min(2).max(1_000))
      .min(1)
      .max(30),
    eventCoverage: z
      .array(
        z
          .object({
            eventId: z.string().regex(/^A\d{3,}$/),
            sourceEvidence: z.string().trim().min(2).max(1_000),
            adaptedEvidence: z.string().trim().min(2).max(2_000),
            treatment: z.enum(["preserved", "condensed", "visualized"]),
          })
          .strict(),
      )
      .min(1)
      .max(120),
  })
  .strict();

export const assetVisualDesignSchema = z
  .object({
    visualIdentity: z.string().trim().min(1).max(1_200),
    shapeAndStructure: z.string().trim().min(1).max(2_000),
    surfaceAndStyling: z.string().trim().min(1).max(2_000),
    colorPalette: z.string().trim().min(1).max(1_200),
    lightingAndPresentation: z.string().trim().min(1).max(1_200),
    signatureDetails: z.array(z.string().trim().min(1).max(600)).min(1).max(12),
    consistencyRules: z.array(z.string().trim().min(1).max(600)).min(2).max(16),
    negativePrompt: z.string().trim().min(1).max(2_000),
    inferenceNotes: z.array(z.string().trim().min(1).max(600)).max(16),
  })
  .strict();

export const studioWorkflowAgentSchema = z
  .object({
    reply: z.string().trim().min(1).max(4_000),
    operation: z
      .enum([
        "cancel_media_task",
        "cancel_workflow",
        "pause_workflow",
        "resume_workflow",
        "revise_screenplay",
        "retry_media_task",
        "retry_workflow",
      ])
      .nullable(),
    targetId: z.string().trim().min(1).nullable(),
  })
  .strict();

export const PROMPT_SCHEMAS: Record<PromptId, z.ZodType> = {
  [PROMPT_IDS.STORY_CHARACTER_ANALYSIS]: characterAnalysisSchema,
  [PROMPT_IDS.STORY_LOCATION_PROP_ANALYSIS]: locationPropAnalysisSchema,
  [PROMPT_IDS.STORY_CLIP_SEGMENTATION]: clipSegmentationSchema,
  [PROMPT_IDS.STORY_SCREENPLAY_CONVERSION]: screenplayConversionSchema,
  [PROMPT_IDS.STORY_SCREENPLAY_REVISION]: screenplayConversionSchema,
  [PROMPT_IDS.STORY_STORYBOARD_PLANNING]: storyboardPlanningSchema,
  [PROMPT_IDS.STORY_CINEMATOGRAPHY]: cinematographySchema,
  [PROMPT_IDS.STORY_ACTING_DIRECTION]: actingDirectionSchema,
  [PROMPT_IDS.STORY_STORYBOARD_REFINEMENT]: storyboardRefinementSchema,
  [PROMPT_IDS.STORY_VOICE_ANALYSIS]: voiceAnalysisSchema,
  [PROMPT_IDS.STORY_CONTINUITY_REVIEW]: continuityReviewSchema,
  [PROMPT_IDS.ASSET_VISUAL_EXTRACTION]: visualAssetExtractionSchema,
  [PROMPT_IDS.ASSET_VISUAL_DESIGN]: assetVisualDesignSchema,
  [PROMPT_IDS.CHARACTER_REFERENCE_DESCRIPTION]: characterReferenceDescriptionSchema,
  [PROMPT_IDS.EPISODE_SPLIT]: episodeSplitSchema,
  [PROMPT_IDS.EPISODE_ADAPTATION]: episodeAdaptationSchema,
  [PROMPT_IDS.STUDIO_WORKFLOW_AGENT]: studioWorkflowAgentSchema,
};
