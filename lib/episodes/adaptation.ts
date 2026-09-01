import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { requestOpenAiText } from "@/lib/llm/openai-structured";
import { PROMPT_IDS, renderPrompt, type PromptLocale } from "@/lib/prompts";
import type { EpisodeSourceVersionRecord } from "@/lib/projects/types";
import { prisma } from "@/lib/server/prisma";

import { EpisodeSourceError } from "./errors";
import { DEFAULT_EPISODE_TARGET_SECONDS } from "./production-plan";
import { resolveEpisodeTextProvider } from "./provider";

export type EpisodeAdaptationMode =
  | "faithful"
  | "polish"
  | "drama"
  | "custom";

export type EpisodeAdaptationProgress =
  | { type: "reset" }
  | { type: "delta"; delta: string }
  | { type: "phase"; phase: "generating" | "saving" };

const MAX_ADAPTATION_SOURCE_CHARS = 500_000;

export async function listEpisodeSources(input: {
  userId: string;
  projectId: string;
  episodeId: string;
}) {
  const episode = await ensureEpisodeSourceVersions(input);
  const sources = await prisma.episodeSourceVersion.findMany({
    where: { episodeId: input.episodeId },
    orderBy: [{ kind: "asc" }, { version: "desc" }],
  });
  const manuscriptId = sources.find((source) => source.manuscriptId)?.manuscriptId;
  const manuscript = manuscriptId
    ? await prisma.manuscript.findUnique({ where: { id: manuscriptId } })
    : null;
  return {
    activeSourceId: episode.activeSourceId,
    activeSourceKind: sourceKind(episode.activeSourceKind),
    sources: sources.map(toSourceRecord),
    manuscript: manuscript ? toManuscriptRecord(manuscript) : null,
  };
}

export async function adaptEpisodeSource(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  channelId: string;
  model: string;
  mode: EpisodeAdaptationMode;
  instructions?: string;
  locale?: PromptLocale;
  onProgress?: (progress: EpisodeAdaptationProgress) => void;
}) {
  const episode = await ensureEpisodeSourceVersions(input);
  const original = await prisma.episodeSourceVersion.findFirst({
    where: { episodeId: input.episodeId, kind: "original" },
    include: { manuscript: true },
    orderBy: { version: "desc" },
  });
  if (!original)
    throw new EpisodeSourceError("本集没有可供改编的原文", 409);
  if (original.content.length > MAX_ADAPTATION_SOURCE_CHARS)
    throw new EpisodeSourceError(
      `单集原文超过 ${MAX_ADAPTATION_SOURCE_CHARS.toLocaleString()} 字符，请先重新调整分集边界`,
    );

  const provider = await resolveEpisodeTextProvider(input);
  const targetDurationSeconds =
    episode.project.config?.episodeTargetDurationSeconds ??
    DEFAULT_EPISODE_TARGET_SECONDS;
  const continuityContext = await loadEpisodeContinuityContext({
    projectId: input.projectId,
    episodeNumber: episode.episodeNumber,
  });
  const result = await requestOpenAiText({
    ...provider,
    prompt: renderPrompt({
      id: PROMPT_IDS.EPISODE_ADAPTATION,
      locale: input.locale,
      variables: {
        source_text: original.content,
        target_duration_seconds: String(targetDurationSeconds),
        manuscript_context: JSON.stringify({
          title: original.manuscript?.title ?? "",
          author: original.manuscript?.author ?? "",
          synopsis: original.manuscript?.synopsis ?? "",
        }),
        project_context: JSON.stringify({
          name: episode.project.name,
          description: episode.project.description ?? "",
        }),
        episode_continuity_context: JSON.stringify(continuityContext),
        adaptation_mode: input.mode,
        custom_instructions: input.instructions?.trim() ?? "",
      },
    }),
    temperature: 0.2,
    onOutputStart: () => {
      input.onProgress?.({
        type: "phase",
        phase: "generating",
      });
      input.onProgress?.({ type: "reset" });
    },
    onTextDelta: (delta) => {
      if (delta) input.onProgress?.({ type: "delta", delta });
    },
  });

  input.onProgress?.({ type: "phase", phase: "saving" });
  const adaptation = parseAdaptationText(result.text);

  const latest = await prisma.episodeSourceVersion.findFirst({
    where: { episodeId: input.episodeId, kind: "adapted" },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const source = await prisma.episodeSourceVersion.create({
    data: {
      id: randomUUID(),
      episodeId: input.episodeId,
      manuscriptId: original.manuscriptId,
      kind: "adapted",
      version: (latest?.version ?? 0) + 1,
      title: adaptation.title,
      summary: adaptation.summary,
      content: adaptation.content,
      adaptationMode: input.mode,
      instructions: input.instructions?.trim() || null,
      changeSummary: toJson([]),
      promptTrace: toJson({
        ...result.trace,
        rawOutput: result.outputText,
      }),
      productionPlan: Prisma.JsonNull,
      productionPlanVersion: null,
      channelId: input.channelId,
      model: input.model,
      sourceHash: textHash(adaptation.content),
      sourceStartIndex: original.sourceStartIndex,
      sourceEndIndex: original.sourceEndIndex,
    },
  });
  return toSourceRecord(source);
}

export async function activateEpisodeSource(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  sourceId: string;
}) {
  const episode = await findOwnedEpisodeWithDownstream(input);
  if (!episode) throw new EpisodeSourceError("剧集不存在", 404);
  const source = await prisma.episodeSourceVersion.findFirst({
    where: { id: input.sourceId, episodeId: input.episodeId },
  });
  if (!source) throw new EpisodeSourceError("稿件版本不存在", 404);
  if (episode.activeSourceId === source.id) return toSourceRecord(source);

  const downstream = downstreamLabels(episode);
  if (downstream.length)
    throw new EpisodeSourceError(
      "本集已有下游制作数据，不能直接切换生产稿",
      409,
      { downstream },
    );

  await prisma.episode.update({
    where: { id: input.episodeId },
    data: {
      activeSourceId: source.id,
      activeSourceKind: sourceKind(source.kind),
      novelText: source.content,
      name: source.title?.trim() || episode.name,
      description: source.summary?.trim() || null,
    },
  });
  return toSourceRecord(source);
}

export async function assertEpisodeHasNoDownstream(input: {
  userId: string;
  projectId: string;
  episodeId: string;
}) {
  const episode = await findOwnedEpisodeWithDownstream(input);
  if (!episode) throw new EpisodeSourceError("剧集不存在", 404);
  const downstream = downstreamLabels(episode);
  if (downstream.length)
    throw new EpisodeSourceError(
      "本集已有下游制作数据，不能修改当前生产稿",
      409,
      { downstream },
    );
}

export function parseAdaptationText(value: string) {
  const normalized = value.trim();
  const titleMatch = normalized.match(
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:标题|title)\s*[：:]\s*(.+?)\s*(?:\n|$)/iu,
  );
  const summaryMatch = normalized.match(
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:梗概|简介|summary|synopsis)\s*[：:]\s*([\s\S]*?)(?=\n\s*(?:#{1,6}\s*)?(?:正文|改编正文|script|adapted\s*text)\s*[：:]|$)/iu,
  );
  const contentMatch = normalized.match(
    /(?:^|\n)\s*(?:#{1,6}\s*)?(?:正文|改编正文|script|adapted\s*text)\s*[：:]\s*([\s\S]+)$/iu,
  );
  const content = contentMatch?.[1].trim() || normalized;
  return {
    title: cleanSingleLine(titleMatch?.[1]) || null,
    summary: summaryMatch?.[1].trim() || null,
    content,
  };
}

function cleanSingleLine(value: string | undefined) {
  return value?.replace(/^\*+|\*+$/gu, "").trim().slice(0, 160) || "";
}

export type EpisodeContinuityContext = {
  previousEpisode: EpisodeBoundaryContext | null;
  currentEpisode: { episodeNumber: number };
  nextEpisode: EpisodeBoundaryContext | null;
  policy: string;
};

type EpisodeBoundaryContext = {
  episodeNumber: number;
  name: string;
  summary: string | null;
  boundaryText: string;
};

export function buildEpisodeContinuityContext(input: {
  episodeNumber: number;
  previous?: {
    episodeNumber: number;
    name: string;
    description: string | null;
    novelText: string | null;
  } | null;
  next?: {
    episodeNumber: number;
    name: string;
    description: string | null;
    novelText: string | null;
  } | null;
}): EpisodeContinuityContext {
  return {
    previousEpisode: input.previous
      ? {
          episodeNumber: input.previous.episodeNumber,
          name: input.previous.name,
          summary: input.previous.description,
          boundaryText: episodeBoundaryText(input.previous.novelText, "end"),
        }
      : null,
    currentEpisode: { episodeNumber: input.episodeNumber },
    nextEpisode: input.next
      ? {
          episodeNumber: input.next.episodeNumber,
          name: input.next.name,
          summary: input.next.description,
          boundaryText: episodeBoundaryText(input.next.novelText, "start"),
        }
      : null,
    policy:
      "Previous ending is continuity context, not content to repeat. Next opening is a hard boundary: do not consume, reveal, resolve, or move any next-episode event into the current adaptation.",
  };
}

async function loadEpisodeContinuityContext(input: {
  projectId: string;
  episodeNumber: number;
}) {
  const select = {
    episodeNumber: true,
    name: true,
    description: true,
    novelText: true,
  } as const;
  const [previous, next] = await Promise.all([
    prisma.episode.findFirst({
      where: {
        projectId: input.projectId,
        episodeNumber: { lt: input.episodeNumber },
      },
      orderBy: { episodeNumber: "desc" },
      select,
    }),
    prisma.episode.findFirst({
      where: {
        projectId: input.projectId,
        episodeNumber: { gt: input.episodeNumber },
      },
      orderBy: { episodeNumber: "asc" },
      select,
    }),
  ]);
  return buildEpisodeContinuityContext({
    episodeNumber: input.episodeNumber,
    previous,
    next,
  });
}

function episodeBoundaryText(
  value: string | null | undefined,
  edge: "start" | "end",
) {
  const text = value?.replace(/\s+/gu, " ").trim() ?? "";
  if (text.length <= 1_200) return text;
  return edge === "start"
    ? `${text.slice(0, 1_200)}...`
    : `...${text.slice(-1_200)}`;
}

async function ensureEpisodeSourceVersions(input: {
  userId: string;
  projectId: string;
  episodeId: string;
}) {
  const episode = await prisma.episode.findFirst({
    where: {
      id: input.episodeId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
    include: { project: { include: { config: true } } },
  });
  if (!episode) throw new EpisodeSourceError("剧集不存在", 404);
  const count = await prisma.episodeSourceVersion.count({
    where: { episodeId: input.episodeId },
  });
  if (count || !episode.novelText?.trim()) return episode;

  const sourceId = randomUUID();
  await prisma.$transaction([
    prisma.episodeSourceVersion.create({
      data: {
        id: sourceId,
        episodeId: episode.id,
        kind: "original",
        version: 1,
        title: episode.name,
        summary: episode.description,
        content: episode.novelText,
        sourceHash: textHash(episode.novelText),
      },
    }),
    prisma.episode.update({
      where: { id: episode.id },
      data: { activeSourceId: sourceId, activeSourceKind: "original" },
    }),
  ]);
  return { ...episode, activeSourceId: sourceId, activeSourceKind: "original" };
}

async function findOwnedEpisodeWithDownstream(input: {
  userId: string;
  projectId: string;
  episodeId: string;
}) {
  return prisma.episode.findFirst({
    where: {
      id: input.episodeId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
    select: {
      id: true,
      name: true,
      activeSourceId: true,
      storyboard: { select: { id: true } },
      editorProject: { select: { id: true } },
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
}

function downstreamLabels(episode: NonNullable<Awaited<ReturnType<typeof findOwnedEpisodeWithDownstream>>>) {
  const labels: string[] = [];
  if (episode._count.clips) labels.push("剧本片段");
  if (episode.storyboard || episode._count.shots) labels.push("分镜");
  if (episode._count.voiceLines || episode._count.audioTracks) labels.push("声音");
  if (episode.editorProject || episode._count.productionDeliverables)
    labels.push("后期与交付");
  if (episode._count.mediaTasks || episode._count.assetReferences) labels.push("媒体任务");
  if (episode._count.workflowRuns) labels.push("工作流记录");
  return [...new Set(labels)];
}

function toSourceRecord(row: {
  id: string;
  episodeId: string;
  manuscriptId: string | null;
  kind: string;
  version: number;
  title: string | null;
  summary: string | null;
  content: string;
  adaptationMode: string | null;
  instructions: string | null;
  changeSummary: Prisma.JsonValue | null;
  promptTrace: Prisma.JsonValue | null;
  productionPlan: Prisma.JsonValue | null;
  productionPlanVersion: number | null;
  channelId: string | null;
  model: string | null;
  sourceHash: string;
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  createdAt: Date;
}): EpisodeSourceVersionRecord {
  return {
    ...row,
    kind: sourceKind(row.kind),
    changeSummary: Array.isArray(row.changeSummary)
      ? row.changeSummary.filter((item): item is string => typeof item === "string")
      : [],
    promptTrace:
      row.promptTrace && typeof row.promptTrace === "object" && !Array.isArray(row.promptTrace)
        ? (row.promptTrace as Record<string, unknown>)
        : null,
    productionPlan:
      row.productionPlan &&
      typeof row.productionPlan === "object" &&
      !Array.isArray(row.productionPlan)
        ? (row.productionPlan as Record<string, unknown>)
        : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function sourceKind(value: string): "original" | "adapted" {
  return value === "adapted" ? "adapted" : "original";
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
}) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function textHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
