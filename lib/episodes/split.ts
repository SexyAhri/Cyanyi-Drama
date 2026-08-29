import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { PROMPT_IDS, renderPrompt, type PromptLocale } from "@/lib/prompts";
import { episodeSplitSchema } from "@/lib/prompts/schemas";
import type { ManuscriptRecord } from "@/lib/projects/types";
import { prisma } from "@/lib/server/prisma";

import { EpisodeSplitError } from "./errors";
import { resolveEpisodeTextProvider } from "./provider";

export { EpisodeSplitError } from "./errors";

export const MAX_MANUSCRIPT_CHARS = 50_000_000;
export const MAX_AI_SPLIT_CHARS = 500_000;

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
    const startIndex = match.index;
    const endIndex = best[index + 1]?.index ?? content.length;
    const episodeContent = content.slice(startIndex, endIndex);
    const titleSuffix = match.text
      .replace(/^第.+?[集章幕][：:\s]*/i, "")
      .replace(/^(?:Episode|Chapter)\s*\d+[：:\s]*/i, "")
      .trim();
    return {
      number: match.episodeNumber,
      title: titleSuffix || `第 ${match.episodeNumber} 集`,
      summary: extractEpisodeExcerpt(episodeContent),
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
  if (input.content.length > MAX_AI_SPLIT_CHARS)
    throw new EpisodeSplitError(
      `AI 分集单次最多处理 ${MAX_AI_SPLIT_CHARS.toLocaleString()} 字符；超长原著请使用章节标记分集，AI 只处理确认后的单集`,
    );
  await assertProjectOwnership(input.userId, input.projectId);
  const provider = await resolveEpisodeTextProvider(input);
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
  manuscriptId?: string;
}) {
  await assertProjectOwnership(input.userId, input.projectId);
  const manuscript = input.manuscriptId
    ? await prisma.manuscript.findFirst({
        where: { id: input.manuscriptId, projectId: input.projectId },
      })
    : null;
  if (input.manuscriptId && !manuscript)
    throw new EpisodeSplitError("导入的原著不存在", 404);
  const episodes = manuscript
    ? resolveManuscriptSlices(input.episodes, manuscript.sourceText)
    : input.episodes.map((episode) => ({
        ...episode,
        summary: episode.summary || extractEpisodeExcerpt(episode.content),
      }));
  const numbers = episodes.map((episode) => episode.number);
  if (new Set(numbers).size !== numbers.length)
    throw new EpisodeSplitError("分集编号不能重复");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.episode.findMany({
      where: { projectId: input.projectId, episodeNumber: { in: numbers } },
      select: {
        id: true,
        episodeNumber: true,
        novelText: true,
        activeSourceId: true,
        activeSourceKind: true,
        storyboard: { select: { id: true } },
        editorProject: { select: { id: true } },
        sourceVersions: {
          where: { kind: "original" },
          select: {
            id: true,
            manuscriptId: true,
            version: true,
            title: true,
            summary: true,
            sourceHash: true,
            sourceStartIndex: true,
            sourceEndIndex: true,
          },
          orderBy: { version: "desc" },
        },
        _count: {
          select: {
            mediaTasks: true,
            clips: true,
            shots: true,
            voiceLines: true,
            audioTracks: true,
            assetReferences: true,
            workflowRuns: true,
            productionDeliverables: true,
          },
        },
      },
    });
    const existingByNumber = new Map(
      existing.map((episode) => [episode.episodeNumber, episode]),
    );
    const newEpisodes: Prisma.EpisodeCreateManyInput[] = [];
    const newSources: Prisma.EpisodeSourceVersionCreateManyInput[] = [];
    const episodeUpdates: EpisodeBulkUpdate[] = [];
    for (const episode of episodes) {
      const current = existingByNumber.get(episode.number);
      const hasDownstream = current
        ? Boolean(current.storyboard) ||
          Boolean(current.editorProject) ||
          Object.values(current._count).some((count) => count > 0)
        : false;
      if (current?.novelText !== episode.content && hasDownstream)
        throw new EpisodeSplitError(
          `第 ${episode.number} 集已有制作数据，不能用新的分集内容覆盖`,
          409,
        );
      const sourceHash = textHash(episode.content);
      if (!current) {
        const episodeId = randomUUID();
        const sourceId = randomUUID();
        newEpisodes.push({
          id: episodeId,
          projectId: input.projectId,
          episodeNumber: episode.number,
          name: episode.title,
          description: episode.summary || null,
          novelText: episode.content,
          activeSourceId: sourceId,
          activeSourceKind: "original",
        });
        newSources.push({
          id: sourceId,
          episodeId,
          manuscriptId: manuscript?.id,
          kind: "original",
          version: 1,
          title: episode.title,
          summary: episode.summary || null,
          content: episode.content,
          sourceHash,
          sourceStartIndex: episode.startIndex,
          sourceEndIndex: episode.endIndex,
        });
        continue;
      }

      let sourceId = current.sourceVersions.find(
        (source) =>
          source.sourceHash === sourceHash &&
          source.manuscriptId === (manuscript?.id ?? null) &&
          source.title === episode.title &&
          source.summary === (episode.summary || null) &&
          source.sourceStartIndex === episode.startIndex &&
          source.sourceEndIndex === episode.endIndex,
      )?.id;
      if (!sourceId) {
        sourceId = randomUUID();
        newSources.push({
          id: sourceId,
          episodeId: current.id,
          manuscriptId: manuscript?.id,
          kind: "original",
          version: (current.sourceVersions[0]?.version ?? 0) + 1,
          title: episode.title,
          summary: episode.summary || null,
          content: episode.content,
          sourceHash,
          sourceStartIndex: episode.startIndex,
          sourceEndIndex: episode.endIndex,
        });
      }
      episodeUpdates.push({
        id: current.id,
        name: episode.title,
        description: episode.summary || null,
        novelText: episode.content,
        activeSourceId: sourceId,
      });
    }

    if (newEpisodes.length)
      await tx.episode.createMany({ data: newEpisodes });
    if (newSources.length)
      await tx.episodeSourceVersion.createMany({ data: newSources });
    if (episodeUpdates.length)
      await updateEpisodesInBulk(tx, episodeUpdates);

    const records = await tx.episode.findMany({
      where: { projectId: input.projectId, episodeNumber: { in: numbers } },
    });
    const recordsByNumber = new Map(
      records.map((episode) => [episode.episodeNumber, episode]),
    );
    return episodes.flatMap((episode) => {
      const record = recordsByNumber.get(episode.number);
      return record ? [record] : [];
    });
  });
}

type EpisodeBulkUpdate = {
  id: string;
  name: string;
  description: string | null;
  novelText: string;
  activeSourceId: string;
};

async function updateEpisodesInBulk(
  tx: Prisma.TransactionClient,
  updates: EpisodeBulkUpdate[],
) {
  const values = updates.map(
    (episode) => Prisma.sql`(
      ${episode.id},
      ${episode.name},
      ${episode.description},
      ${episode.novelText},
      ${episode.activeSourceId}
    )`,
  );
  await tx.$executeRaw(Prisma.sql`
    UPDATE "episodes" AS episode
    SET
      "name" = data."name",
      "description" = data."description",
      "novel_text" = data."novel_text",
      "active_source_id" = data."active_source_id",
      "active_source_kind" = 'original',
      "updated_at" = CURRENT_TIMESTAMP
    FROM (VALUES ${Prisma.join(values)}) AS data(
      "id",
      "name",
      "description",
      "novel_text",
      "active_source_id"
    )
    WHERE episode."id" = data."id"
  `);
}

export async function saveManuscript(input: {
  userId: string;
  projectId: string;
  content: string;
  title: string;
  author?: string;
  synopsis?: string;
  sourceFileName?: string;
}) {
  await assertProjectOwnership(input.userId, input.projectId);
  const sourceHash = textHash(input.content);
  const manuscript = await prisma.manuscript.upsert({
    where: {
      projectId_sourceHash: { projectId: input.projectId, sourceHash },
    },
    create: {
      id: randomUUID(),
      projectId: input.projectId,
      title: input.title.trim() || "未命名小说",
      author: input.author?.trim() || null,
      synopsis: input.synopsis?.trim() || null,
      sourceFileName: input.sourceFileName?.trim() || null,
      sourceText: input.content,
      sourceHash,
      charCount: input.content.length,
    },
    update: {
      title: input.title.trim() || "未命名小说",
      author: input.author?.trim() || null,
      synopsis: input.synopsis?.trim() || null,
      sourceFileName: input.sourceFileName?.trim() || null,
    },
  });
  return toManuscriptRecord(manuscript);
}

export async function updateManuscriptMetadata(input: {
  userId: string;
  projectId: string;
  manuscriptId: string;
  title: string;
  author?: string;
  synopsis?: string;
}) {
  const current = await prisma.manuscript.findFirst({
    where: {
      id: input.manuscriptId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
  });
  if (!current) throw new EpisodeSplitError("导入的原著不存在", 404);
  return toManuscriptRecord(
    await prisma.manuscript.update({
      where: { id: current.id },
      data: {
        title: input.title.trim() || current.title,
        author: input.author?.trim() || null,
        synopsis: input.synopsis?.trim() || null,
      },
    }),
  );
}

export function extractEpisodeExcerpt(content: string, maxLength = 240) {
  const paragraphs = content
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^(?:第[零〇一二两三四五六七八九十百千万\d]+[卷章节幕集]|Episode\s*\d+|Chapter\s*\d+)/iu.test(
          line,
        ) &&
        !/^(?:书名|小说名|作品名|作者|字数|简介)\s*[：:]/u.test(line) &&
        !isDecorativeLine(line),
    );
  const paragraph = paragraphs.find((line) => line.length >= 20) ?? paragraphs[0] ?? "";
  const normalized = paragraph.replace(/\s+/gu, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength).trimEnd()}…`
    : normalized;
}

function isDecorativeLine(line: string) {
  return line.length >= 3 && !/[\p{L}\p{N}]/u.test(line);
}

function resolveManuscriptSlices(episodes: EpisodeSplitDraft[], source: string) {
  const sorted = [...episodes].sort((left, right) => left.startIndex - right.startIndex);
  let expectedStart = sorted[0]?.startIndex ?? 0;
  for (const [index, episode] of sorted.entries()) {
    if (
      episode.startIndex !== expectedStart ||
      episode.endIndex <= episode.startIndex ||
      episode.endIndex > source.length
    )
      throw new EpisodeSplitError(`第 ${index + 1} 个分集边界不连续或已失效`);
    expectedStart = episode.endIndex;
  }
  if (expectedStart !== source.length)
    throw new EpisodeSplitError("分集边界没有覆盖到原著结尾");
  return sorted.map((episode) => {
    const content = source.slice(episode.startIndex, episode.endIndex);
    return {
      ...episode,
      content,
      wordCount: countWords(content),
      summary: episode.summary.trim() || extractEpisodeExcerpt(content),
    };
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

async function assertProjectOwnership(userId: string, projectId: string) {
  const project = await prisma.project.count({ where: { id: projectId, userId } });
  if (!project) throw new EpisodeSplitError("项目不存在", 404);
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

function textHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function toManuscriptRecord(row: {
  id: string;
  projectId: string;
  title: string;
  author: string | null;
  synopsis: string | null;
  sourceFileName: string | null;
  charCount: number;
  createdAt: Date;
  updatedAt: Date;
}): ManuscriptRecord {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
