import { randomUUID } from "node:crypto";

import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import { decryptSecret } from "@/lib/server/crypto";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { PROMPT_IDS, renderPrompt, type PromptLocale } from "@/lib/prompts";
import { episodeSplitSchema } from "@/lib/prompts/schemas";
import { prisma } from "@/lib/server/prisma";
import { structuredRequestOptions } from "@/lib/settings/runtime-contract";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";

export type EpisodeSplitDraft = {
  number: number;
  title: string;
  summary: string;
  content: string;
  wordCount: number;
  startIndex: number;
  endIndex: number;
};

export type EpisodeMarkerResult = {
  hasMarkers: boolean;
  markerType: string;
  confidence: "high" | "medium" | "low";
  matches: Array<{ index: number; text: string; episodeNumber: number }>;
  episodes: EpisodeSplitDraft[];
};

export class EpisodeSplitError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
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

const MARKER_PATTERNS = [
  {
    type: "第X集",
    regex: /^第([零〇一二两三四五六七八九十百千\d]+)集(?:[：:][ \t]*(.*)|[ \t]+(.+))?[ \t]*$/gm,
  },
  {
    type: "第X章",
    regex: /^第([零〇一二两三四五六七八九十百千\d]+)章(?:[：:][ \t]*(.*)|[ \t]+(.+))?[ \t]*$/gm,
  },
  {
    type: "第X幕",
    regex: /^第([零〇一二两三四五六七八九十百千\d]+)幕(?:[：:][ \t]*(.*)|[ \t]+(.+))?[ \t]*$/gm,
  },
  {
    type: "Episode X",
    regex: /^Episode\s*(\d+)[：:\s]*(.*)?$/gim,
  },
  {
    type: "Chapter X",
    regex: /^Chapter\s*(\d+)[：:\s]*(.*)?$/gim,
  },
  {
    type: "X-Y 场景",
    regex: /^(\d+)-\d+[【\[].*?[】\]].*$/gm,
  },
] as const;

export function detectEpisodeMarkers(content: string): EpisodeMarkerResult {
  if (content.length < 100)
    return {
      hasMarkers: false,
      markerType: "",
      confidence: "low",
      matches: [],
      episodes: [],
    };
  let best: EpisodeMarkerResult["matches"] = [];
  let markerType = "";
  for (const pattern of MARKER_PATTERNS) {
    const matches: EpisodeMarkerResult["matches"] = [];
    const seenSceneEpisodes = new Set<number>();
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const episodeNumber = chineseNumber(match[1]);
      if (!Number.isInteger(episodeNumber) || episodeNumber <= 0) continue;
      if (pattern.type === "X-Y 场景") {
        if (seenSceneEpisodes.has(episodeNumber)) continue;
        seenSceneEpisodes.add(episodeNumber);
      }
      matches.push({ index: match.index, text: match[0], episodeNumber });
    }
    if (matches.length >= 2 && matches.length > best.length) {
      best = matches;
      markerType = pattern.type;
    }
  }
  if (best.length < 2)
    return {
      hasMarkers: false,
      markerType: "",
      confidence: "low",
      matches: [],
      episodes: [],
    };
  best.sort((left, right) => left.index - right.index);
  const episodes = best.map((match, index) => {
    const startIndex = index === 0 ? 0 : match.index;
    const endIndex = best[index + 1]?.index ?? content.length;
    const episodeContent = content.slice(startIndex, endIndex);
    const titleSuffix = match.text
      .replace(/^第.+?[集章幕][：:\s]*/i, "")
      .replace(/^(?:Episode|Chapter)\s*\d+[：:\s]*/i, "")
      .trim();
    return {
      number: match.episodeNumber,
      title: titleSuffix || `第 ${match.episodeNumber} 集`,
      summary: "",
      content: episodeContent,
      wordCount: countWords(episodeContent),
      startIndex,
      endIndex,
    };
  });
  const averageDistance =
    (best[best.length - 1].index - best[0].index) / (best.length - 1);
  return {
    hasMarkers: true,
    markerType,
    confidence:
      best.length >= 3 && averageDistance >= 300 && averageDistance <= 20_000
        ? "high"
        : "medium",
    matches: best,
    episodes,
  };
}

export async function splitEpisodesWithAi(input: {
  userId: string;
  projectId: string;
  content: string;
  channelId: string;
  model: string;
  locale?: PromptLocale;
}) {
  await assertProjectOwnership(input.userId, input.projectId);
  const provider = await resolveProvider(input);
  const result = await requestOpenAiStructured({
    ...provider,
    prompt: renderPrompt({
      id: PROMPT_IDS.EPISODE_SPLIT,
      locale: input.locale,
      variables: { source_text: input.content },
    }),
    schema: episodeSplitSchema,
    validate: (data) => validateAiBoundaries(data.episodes, input.content),
    temperature: 0.2,
  });
  return {
    episodes: resolveAiEpisodeBoundaries(result.data.episodes, input.content),
    trace: result.trace,
  };
}

export function resolveAiEpisodeBoundaries(
  suggestions: Array<{
    number: number;
    title: string;
    summary: string;
    startMarker: string;
    endMarker: string;
  }>,
  source: string,
): EpisodeSplitDraft[] {
  const starts: number[] = [];
  let searchFrom = 0;
  for (const [index, episode] of suggestions.entries()) {
    const start = source.indexOf(episode.startMarker, searchFrom);
    if (start < 0)
      throw new EpisodeSplitError(`第 ${index + 1} 个 startMarker 无法定位`);
    starts.push(start);
    searchFrom = start + episode.startMarker.length;
  }
  const output = suggestions.map((episode, index) => {
    const startIndex = index === 0 ? 0 : starts[index];
    const endIndex = starts[index + 1] ?? source.length;
    const markerEnd = source.indexOf(episode.endMarker, starts[index]);
    if (markerEnd < starts[index] || markerEnd + episode.endMarker.length > endIndex)
      throw new EpisodeSplitError(`第 ${index + 1} 个 endMarker 不在本集范围内`);
    const content = source.slice(startIndex, endIndex);
    return {
      number: episode.number,
      title: episode.title,
      summary: episode.summary,
      content,
      wordCount: countWords(content),
      startIndex,
      endIndex,
    };
  });
  if (output.map((episode) => episode.content).join("") !== source)
    throw new EpisodeSplitError("AI 分集未完整覆盖原文");
  return output;
}

export async function persistEpisodeSplits(input: {
  userId: string;
  projectId: string;
  episodes: EpisodeSplitDraft[];
}) {
  await assertProjectOwnership(input.userId, input.projectId);
  const numbers = input.episodes.map((episode) => episode.number);
  if (new Set(numbers).size !== numbers.length)
    throw new EpisodeSplitError("分集编号不能重复");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.episode.findMany({
      where: { projectId: input.projectId, episodeNumber: { in: numbers } },
      select: {
        id: true,
        episodeNumber: true,
        novelText: true,
        storyboard: { select: { id: true } },
        _count: {
          select: {
            clips: true,
            voiceLines: true,
            workflowRuns: true,
          },
        },
      },
    });
    const existingByNumber = new Map(
      existing.map((episode) => [episode.episodeNumber, episode]),
    );
    const records = [];
    for (const episode of input.episodes) {
      const current = existingByNumber.get(episode.number);
      const hasDownstream = current
        ? Boolean(current.storyboard) ||
          Object.values(current._count).some((count) => count > 0)
        : false;
      if (current?.novelText !== episode.content && hasDownstream)
        throw new EpisodeSplitError(
          `第 ${episode.number} 集已有制作数据，不能用新的分集内容覆盖`,
          409,
        );
      records.push(
        await tx.episode.upsert({
          where: {
            projectId_episodeNumber: {
              projectId: input.projectId,
              episodeNumber: episode.number,
            },
          },
          create: {
            id: randomUUID(),
            projectId: input.projectId,
            episodeNumber: episode.number,
            name: episode.title,
            description: episode.summary || null,
            novelText: episode.content,
          },
          update: {
            name: episode.title,
            description: episode.summary || null,
            novelText: episode.content,
          },
        }),
      );
    }
    return records;
  });
}

function validateAiBoundaries(
  episodes: Array<{
    number: number;
    title: string;
    summary: string;
    startMarker: string;
    endMarker: string;
  }>,
  source: string,
) {
  const issues: Array<{ code: string; path: string; message: string }> = [];
  const numbers = new Set<number>();
  let previousNumber = 0;
  let searchFrom = 0;
  episodes.forEach((episode, index) => {
    if (numbers.has(episode.number))
      issues.push({
        code: "EPISODE_NUMBER_DUPLICATE",
        path: `episodes.${index}.number`,
        message: `Duplicate episode number ${episode.number}`,
      });
    numbers.add(episode.number);
    if (episode.number <= previousNumber)
      issues.push({
        code: "EPISODE_NUMBER_ORDER_INVALID",
        path: `episodes.${index}.number`,
        message: "Episode numbers must increase in source order",
      });
    previousNumber = episode.number;
    const start = source.indexOf(episode.startMarker, searchFrom);
    if (start < 0)
      issues.push({
        code: "EPISODE_START_MARKER_NOT_FOUND",
        path: `episodes.${index}.startMarker`,
        message: "startMarker must be an exact ordered source excerpt",
      });
    const end = source.indexOf(episode.endMarker, Math.max(searchFrom, start));
    if (end < 0)
      issues.push({
        code: "EPISODE_END_MARKER_NOT_FOUND",
        path: `episodes.${index}.endMarker`,
        message: "endMarker must be an exact source excerpt after startMarker",
      });
    if (start >= 0) searchFrom = start + episode.startMarker.length;
  });
  if (!issues.length)
    try {
      resolveAiEpisodeBoundaries(episodes, source);
    } catch (error) {
      issues.push({
        code: "EPISODE_BOUNDARY_INVALID",
        path: "episodes",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  return issues;
}

async function resolveProvider(input: {
  userId: string;
  channelId: string;
  model: string;
}) {
  const channel = await prisma.channel.findFirst({
    where: accessibleChannelWhere(input.userId, input.channelId),
  });
  if (!channel) throw new EpisodeSplitError("分析渠道不存在", 404);
  if (
    channel.protocol !== "openai-compatible" &&
    channel.protocol !== "volcengine-ark"
  )
    throw new EpisodeSplitError("AI 分集需要 OpenAI 兼容渠道");
  const configuredModel = await prisma.providerModel.findFirst({
    where: { channelId: input.channelId, modelId: input.model, selected: true },
  });
  if (!configuredModel) throw new EpisodeSplitError("分析模型未配置");
  const apiKeys = parseApiKeys(channel.encryptedApiKeys);
  if (!apiKeys.length) throw new EpisodeSplitError("分析渠道缺少 API Key");
  const runtimeSettings = await loadUserRuntimeSettings(input.userId);
  return {
    baseUrl: channel.baseUrl,
    apiKeys,
    model: input.model,
    ...structuredRequestOptions(runtimeSettings),
    structuredOutputMode: supportsStoredStructuredOutputs(
      configuredModel.capabilitiesJson,
    )
      ? ("json_schema" as const)
      : ("json_object" as const),
  };
}

async function assertProjectOwnership(userId: string, projectId: string) {
  const project = await prisma.project.count({ where: { id: projectId, userId } });
  if (!project) throw new EpisodeSplitError("项目不存在", 404);
}

function parseApiKeys(value: string) {
  try {
    const parsed: unknown = JSON.parse(decryptSecret(value));
    return Array.isArray(parsed)
      ? parsed.flatMap((item) =>
          typeof item === "string" && item.trim() ? [item.trim()] : [],
        )
      : [];
  } catch {
    return [];
  }
}

function chineseNumber(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  let total = 0;
  let current = 0;
  for (const character of value) {
    if (character === "十") {
      total += (current || 1) * 10;
      current = 0;
    } else if (character === "百") {
      total += (current || 1) * 100;
      current = 0;
    } else if (character === "千") {
      total += (current || 1) * 1_000;
      current = 0;
    } else if (character in CHINESE_DIGITS) {
      current = CHINESE_DIGITS[character];
    }
  }
  return total + current;
}

function countWords(value: string) {
  const cjk = value.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latin = value.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + latin;
}
