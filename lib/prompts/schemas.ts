import { z } from "zod";

import { PROMPT_IDS, type PromptId } from "./ids";

const text = z.string().trim().min(1);
const exactText = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Text cannot be whitespace only");
const optionalText = z.string().trim().min(1).nullish();
const stringList = z.array(text).max(100).default([]);
const evidenceQuotes = z.array(exactText).min(1).max(12);

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
          start: exactText,
          end: exactText,
          text: exactText,
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
  z.object({ type: z.literal("action"), text: exactText }).strict(),
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

export const storyboardPanelSchema = z
  .object({
    panelIndex: z.number().int().nonnegative(),
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
          })
          .strict(),
      )
      .min(1)
      .max(15),
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

export const PROMPT_SCHEMAS: Record<PromptId, z.ZodType> = {
  [PROMPT_IDS.STORY_CHARACTER_ANALYSIS]: characterAnalysisSchema,
  [PROMPT_IDS.STORY_LOCATION_PROP_ANALYSIS]: locationPropAnalysisSchema,
  [PROMPT_IDS.STORY_CLIP_SEGMENTATION]: clipSegmentationSchema,
  [PROMPT_IDS.STORY_SCREENPLAY_CONVERSION]: screenplayConversionSchema,
  [PROMPT_IDS.STORY_STORYBOARD_PLANNING]: storyboardPlanningSchema,
  [PROMPT_IDS.STORY_CINEMATOGRAPHY]: cinematographySchema,
  [PROMPT_IDS.STORY_ACTING_DIRECTION]: actingDirectionSchema,
  [PROMPT_IDS.STORY_STORYBOARD_REFINEMENT]: storyboardRefinementSchema,
  [PROMPT_IDS.STORY_VOICE_ANALYSIS]: voiceAnalysisSchema,
  [PROMPT_IDS.STORY_CONTINUITY_REVIEW]: continuityReviewSchema,
  [PROMPT_IDS.ASSET_VISUAL_EXTRACTION]: visualAssetExtractionSchema,
  [PROMPT_IDS.CHARACTER_REFERENCE_DESCRIPTION]: characterReferenceDescriptionSchema,
  [PROMPT_IDS.EPISODE_SPLIT]: episodeSplitSchema,
};
