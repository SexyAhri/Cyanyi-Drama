import { z } from "zod";
import { StoryProductionConstraintsSchema } from "@/lib/production/story-quality-contract";

export const storySetupSchema = z.object({
  storyIdea: z.string().trim().max(4000).default(""),
  genres: z.array(z.string().trim().min(1).max(80)).max(2).default([]),
  audience: z.array(z.string().trim().min(1).max(80)).max(2).default([]),
  characters: z.array(z.string().trim().min(1).max(80)).max(5).default([]),
  eras: z.array(z.string().trim().min(1).max(80)).max(2).default([]),
  hooks: z.array(z.string().trim().min(1).max(80)).max(3).default([]),
  artStyle: z.string().trim().min(1).max(1010).default("realistic"),
  episodeCount: z.number().int().min(1).max(100).default(20),
  structure: z.string().trim().min(1).max(80).default("自动适配"),
  productionConstraints: StoryProductionConstraintsSchema.optional(),
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

export function resolveAdaptationOptions(
  options?: StudioProductionOptions,
  request?: string,
) {
  const text = request?.trim() ?? "";
  const inferred = /润色|polish/i.test(text)
    ? "polish"
    : /戏剧化|drama/i.test(text)
      ? "drama"
      : /自定义改编|custom adaptation/i.test(text)
        ? "custom"
        : "faithful";
  return {
    mode: options?.adaptationMode ?? inferred,
    instructions: options?.instructions ?? text,
  };
}

export function resolveStorySetup(input: {
  options?: StudioProductionOptions;
  request?: string;
  artStyle?: string;
  description?: string | null;
  projectName: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
}): StorySetup {
  const request = input.request?.trim() ?? "";
  const userTurns = (input.conversation ?? [])
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content.trim())
    .filter(Boolean);
  // Assistant proposals are not user-approved canon. Freeze only user-authored material.
  const parts = [
    ...new Set(
      [input.options?.storySetup?.storyIdea, ...userTurns, request].filter(
        (part): part is string => Boolean(part),
      ),
    ),
  ];
  const fullIdea = parts.join("\n\n");
  const storyIdea =
    fullIdea.length > 4000
      ? `${fullIdea.slice(0, 1950)}\n[较早讨论中段已截取；以下为最近要求]\n${fullIdea.slice(-1950)}`
      : fullIdea;
  const count =
    requestedEpisodeCount(request) ??
    userTurns
      .map(requestedEpisodeCount)
      .findLast((value) => value !== undefined) ??
    input.options?.storySetup?.episodeCount;
  const structurePattern =
    /三幕式|五幕式|英雄之旅|英雄旅程|起承转合|长线阶段式|单元结构|平行结构|交叉结构|非线性结构|环形结构/;
  const structure =
    request.match(structurePattern)?.[0] ??
    userTurns
      .map((turn) => turn.match(structurePattern)?.[0])
      .findLast(Boolean) ??
    input.options?.storySetup?.structure;
  return storySetupSchema.parse({
    ...input.options?.storySetup,
    storyIdea:
      storyIdea ||
      input.description ||
      `为项目「${input.projectName}」创作一部原创短剧。`,
    artStyle:
      input.artStyle ?? input.options?.storySetup?.artStyle ?? "realistic",
    ...(count !== undefined ? { episodeCount: count } : {}),
    ...(structure ? { structure } : {}),
  });
}

export function isSerialStorySetup(
  setup: Pick<StorySetup, "storyIdea" | "structure">,
) {
  return /长线|长篇|持续连载|长期连载|无限续|几百集|数百集|长线阶段式|long.running|ongoing serial|open.ended/i.test(
    `${setup.storyIdea}\n${setup.structure}`,
  );
}

function requestedEpisodeCount(text: string): number | undefined {
  const pattern =
    /(\d{1,3}|[一二三四五六七八九十百两]+)\s*集|\b(\d{1,3})\s*episodes?\b/gi;
  for (const match of text.matchAll(pattern)) {
    // A cited episode, range, or approximate long-run ambition is not a batch count.
    if (
      /[第\d一二三四五六七八九十百几数\-–—~至到]\s*$/.test(
        text.slice(0, match.index),
      )
    )
      continue;
    const value = match[1] ?? match[2];
    if (/^\d+$/.test(value)) return Number(value);
    const digits: Record<string, number> = {
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    };
    let total = 0,
      digit = 0;
    for (const char of value) {
      if (char === "十" || char === "百") {
        total += (digit || 1) * (char === "十" ? 10 : 100);
        digit = 0;
      } else digit = digits[char] ?? 0;
    }
    return total + digit;
  }
}
