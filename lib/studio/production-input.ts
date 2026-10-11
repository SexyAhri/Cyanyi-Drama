import { z } from "zod";

export const storySetupSchema = z.object({
  storyIdea: z.string().trim().max(4000).default(""),
  genres: z.array(z.string().trim().min(1).max(80)).max(2).default([]),
  audience: z.array(z.string().trim().min(1).max(80)).max(2).default([]),
  characters: z.array(z.string().trim().min(1).max(80)).max(5).default([]),
  eras: z.array(z.string().trim().min(1).max(80)).max(2).default([]),
  hooks: z.array(z.string().trim().min(1).max(80)).max(3).default([]),
  artStyle: z.string().trim().min(1).max(1010).default("realistic"),
  episodeCount: z.number().int().min(1).max(100).default(20),
  structure: z.string().trim().min(1).max(80).default("三幕式"),
});

export type StorySetup = z.infer<typeof storySetupSchema>;
export const studioProductionOptionsSchema = z.object({
  fillMissingVoiceDesign: z.boolean().optional(),
  storySetup: storySetupSchema.nullable().optional(),
  adaptationMode: z
    .enum(["faithful", "polish", "drama", "custom"])
    .nullable()
    .optional(),
  instructions: z.string().trim().max(4000).nullable().optional(),
});
export type StudioProductionOptions = z.infer<
  typeof studioProductionOptionsSchema
>;

export function resolveAdaptationOptions(options?: StudioProductionOptions, request?: string) {
  const text = request?.trim() ?? "";
  const inferred = /润色|polish/i.test(text) ? "polish" : /戏剧化|drama/i.test(text) ? "drama" : /自定义改编|custom adaptation/i.test(text) ? "custom" : "faithful";
  return { mode: options?.adaptationMode ?? inferred, instructions: options?.instructions ?? text };
}

export function resolveStorySetup(input: {
  options?: StudioProductionOptions;
  request?: string;
  artStyle?: string;
  description?: string | null;
  projectName: string;
}): StorySetup {
  const request = input.request?.trim() ?? "";
  const count = request.match(
    /(?:共|总共|写|生成|做成|计划)?\s*(\d{1,3})\s*集|\b(\d{1,3})\s*episodes?\b/i,
  );
  const structure = request.match(/三幕式|五幕式|英雄之旅|起承转合/);
  return storySetupSchema.parse({
    ...input.options?.storySetup,
    storyIdea:
      input.options?.storySetup?.storyIdea ||
      request.slice(0, 4000) ||
      input.description ||
      `为项目「${input.projectName}」创作一部原创短剧。`,
    artStyle:
      input.artStyle ?? input.options?.storySetup?.artStyle ?? "realistic",
    ...(count ? { episodeCount: Number(count[1] ?? count[2]) } : {}),
    ...(structure ? { structure: structure[0] } : {}),
  });
}
