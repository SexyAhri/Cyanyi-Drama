import { z } from "zod";
import { AssetVisualProfileSpecSchema } from "@/lib/assets/visual-profile";
import { PanelProductionDesignSchema } from "./panel-production-design";

const text = z.string().trim().min(1);

const imagePrompt = z
  .string()
  .trim()
  .min(40)
  .describe("One continuous, production-ready image prompt paragraph.");

const referenceSlots = z.array(
  z.object({
    number: z.number().int().positive(),
    kind: z.enum(["character", "location", "prop"]),
    name: text,
  }),
);

const resolvedSetting = text.refine(
  value => !/^(自动|未指定|由\s*AI\s*拟定|auto|AI decides)$/i.test(value),
  "Specify a concrete creative setting instead of an automatic placeholder",
);
export const ResolvedStorySetupSchema = z.object({
  audience: z.array(resolvedSetting).min(1),
  characters: z.array(resolvedSetting).min(1),
  eras: z.array(resolvedSetting).min(1),
  hooks: z.array(resolvedSetting).min(1),
});

export const StoryPackageSchema = z.object({
  resolvedSetup: ResolvedStorySetupSchema.optional(),
  title: text,
  logline: text,
  coreAppeal: z.array(text).min(2),
  emotionalCurve: text,
  synopsis: text,
  backgroundSetting: text,
  format: z.object({
    episodeCount: z.number().int().positive(),
    episodeDurationSeconds: z.number().int().positive(),
    structure: text,
    aspectRatio: text,
    artStyle: text,
  }),
  worldRules: z
    .array(
      z.object({
        rule: text,
        consequence: text,
      }),
    )
    .min(3),
  volumes: z
    .array(
      z.object({
        volume: z.number().int().positive(),
        title: text,
        episodeRange: text,
        phaseGoal: text,
        informationRelease: text,
        distinctiveness: text,
        synopsis: text,
        climax: text,
        endingHook: text,
      }),
    )
    .min(1),
  episodeOutlines: z
    .array(
      z.object({
        episodeNumber: z.number().int().positive(),
        title: text,
        summary: text,
        endingHook: text,
        plantedClue: text,
        payoff: text,
      }),
    )
    .min(1),
  hooks: z
    .array(
      z.object({
        episodeNumber: z.number().int().positive(),
        hook: text,
        questionRaised: text,
        promisedPayoff: text,
      }),
    )
    .min(1),
  foreshadowing: z
    .array(
      z.object({
        clue: text,
        introducedAt: text,
        introducedForm: text,
        payoffAt: text,
        payoff: text,
      }),
    )
    .min(1),
  reversals: z
    .array(
      z.object({
        reveal: text,
        setup: text,
        episodeNumber: z.number().int().positive(),
      }),
    )
    .min(1),
  creativeProhibitions: z.array(text).min(3),
  whyWatch: z.object({
    earlyEpisodes: z
      .array(
        z.object({
          episodeNumber: z.number().int().positive(),
          moment: text,
          questionRaised: text,
        }),
      )
      .min(1),
    nonInterchangeabilityReason: text,
  }),
  characters: z
    .array(
      z.object({
        name: text,
        role: text,
        storyFunction: text,
        tags: z.array(text).min(1),
        ageAndAppearance: text,
        personality: text,
        motivation: text,
        arc: text,
        relationships: text,
        voiceStyle: text,
        speakingTell: text,
        signatureDetail: text,
        pressureBehavior: text,
        addressingRules: text,
        firstAppearanceEpisode: z.number().int().positive(),
        keyEpisodes: z.array(z.number().int().positive()).min(1),
        imageReferenceSlot: z.number().int().positive(),
        imagePrompt,
        visualProfile: AssetVisualProfileSpecSchema.optional(),
      }),
    )
    .min(1),
  props: z.array(
    z.object({
      name: text,
      type: text,
      storyFunction: text,
      appearance: text,
      capabilities: text,
      limits: text,
      costOrConsequence: text,
      firstAppearanceEpisode: z.number().int().positive(),
      keyEpisodes: z.array(z.number().int().positive()).min(1),
      imageReferenceSlot: z.number().int().positive(),
      imagePrompt,
      visualProfile: AssetVisualProfileSpecSchema.optional(),
    }),
  ),
  locations: z
    .array(
      z.object({
        name: text,
        type: text,
        storyFunction: text,
        spatialRules: text,
        atmosphere: text,
        reusableActions: text,
        keyEpisodes: z.array(z.number().int().positive()).min(1),
        imageReferenceSlot: z.number().int().positive(),
        imagePrompt,
        visualProfile: AssetVisualProfileSpecSchema.optional(),
      }),
    )
    .min(1),
  firstEpisode: z.object({
    title: text,
    synopsis: text,
    endingHook: text,
    targetDurationSeconds: z.number().int().positive(),
    scenes: z
      .array(
        z.object({
          sceneNumber: z.number().int().positive(),
          heading: text,
          durationSeconds: z.number().int().positive(),
          location: text,
          characters: z.array(text),
          props: z.array(text),
          action: text,
          dialogue: z.array(
            z.object({
              speaker: text,
              line: text,
            }),
          ),
          camera: text,
          sound: text,
          endState: text,
          imageReferenceSlots: referenceSlots,
          imagePrompt,
          videoPrompt: text.min(100),
          productionDesign: PanelProductionDesignSchema.optional(),
        }),
      )
      .min(4),
  }),
});

export const StoryPackagePlanSchema = StoryPackageSchema.pick({
  resolvedSetup: true,
  title: true,
  logline: true,
  coreAppeal: true,
  emotionalCurve: true,
  synopsis: true,
  backgroundSetting: true,
  format: true,
  worldRules: true,
  volumes: true,
  creativeProhibitions: true,
  whyWatch: true,
});

export const StoryPackageAssetsSchema = StoryPackageSchema.pick({
  characters: true,
  props: true,
  locations: true,
});

export const StoryPackageAssetsGenerationSchema = z.object({
  characters: z.array(
    StoryPackageSchema.shape.characters.element.extend({
      visualProfile: AssetVisualProfileSpecSchema,
    }),
  ).min(1),
  props: z.array(
    StoryPackageSchema.shape.props.element.extend({
      visualProfile: AssetVisualProfileSpecSchema,
    }),
  ),
  locations: z.array(
    StoryPackageSchema.shape.locations.element.extend({
      visualProfile: AssetVisualProfileSpecSchema,
    }),
  ).min(1),
});

export const StoryPackageEpisodeBatchSchema = z.object({
  episodeOutlines: StoryPackageSchema.shape.episodeOutlines,
  hooks: StoryPackageSchema.shape.hooks,
  foreshadowing: StoryPackageSchema.shape.foreshadowing,
  reversals: StoryPackageSchema.shape.reversals,
});

export const StoryPackageFirstEpisodeSchema = StoryPackageSchema.pick({
  firstEpisode: true,
});

// Old approved packages remain readable; newly generated scenes must include directing data.
export const StoryPackageFirstEpisodeGenerationSchema = z.object({
  firstEpisode: StoryPackageSchema.shape.firstEpisode.extend({
    scenes: z.array(StoryPackageSchema.shape.firstEpisode.shape.scenes.element.extend({
      durationSeconds: z.literal(15),
      productionDesign: PanelProductionDesignSchema,
    })).min(4),
  }),
});

export type StoryPackage = z.infer<typeof StoryPackageSchema>;
