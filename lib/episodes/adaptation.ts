import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { requestOpenAiStructured } from "@/lib/llm/openai-structured";
import { PROMPT_IDS, renderPrompt, type PromptLocale } from "@/lib/prompts";
import { episodeAdaptationSchema } from "@/lib/prompts/schemas";
import { buildSourceEvents } from "@/lib/prompts/validators";
import type { EpisodeSourceVersionRecord } from "@/lib/projects/types";
import { prisma } from "@/lib/server/prisma";

import { EpisodeSourceError } from "./errors";
import {
  buildAdaptationSourceUnits,
  DEFAULT_EPISODE_TARGET_SECONDS,
  EPISODE_PRODUCTION_PLAN_VERSION,
  finalizeEpisodeProductionPlan,
  MAX_ADAPTATION_SOURCE_UNITS,
  validateEpisodeAdaptationOutput,
} from "./production-plan";
import { resolveEpisodeTextProvider } from "./provider";

export type EpisodeAdaptationMode =
  | "faithful"
  | "polish"
  | "drama"
  | "custom";

export type EpisodeAdaptationProgress =
  | { type: "reset" }
  | { type: "delta"; delta: string }
  | { type: "phase"; phase: "generating" | "validating" | "correcting" };

const MAX_ADAPTATION_SOURCE_CHARS = 500_000;
export const MAX_ADAPTATION_EVENT_ANCHORS = 120;

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
  const sourceUnits = buildAdaptationSourceUnits(original.content);
  if (sourceUnits.length > MAX_ADAPTATION_SOURCE_UNITS)
    throw new EpisodeSourceError(
      `本集包含 ${sourceUnits.length} 个需要逐项核对的原文单元，超过单次改编可可靠处理的 ${MAX_ADAPTATION_SOURCE_UNITS} 个；请确认章节边界`,
      409,
    );
  const targetDurationSeconds =
    episode.project.config?.episodeTargetDurationSeconds ??
    DEFAULT_EPISODE_TARGET_SECONDS;
  const continuityContext = await loadEpisodeContinuityContext({
    projectId: input.projectId,
    episodeNumber: episode.episodeNumber,
  });
  let preview = createJsonStringFieldStream("adaptedText");
  let outputStarts = 0;
  const result = await requestOpenAiStructured({
    ...provider,
    prompt: renderPrompt({
      id: PROMPT_IDS.EPISODE_ADAPTATION,
      locale: input.locale,
      variables: {
        source_units_json: JSON.stringify(sourceUnits),
        runtime_contract_json: JSON.stringify({
          targetDurationSeconds,
          hardMaxDurationSeconds: 90,
          preferredDurationRangeSeconds: [70, 90],
          preferredShotCountRange: [16, 22],
          narrationMaximumLines: 2,
          narrationMaximumChineseCharacters: 60,
        }),
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
    schema: episodeAdaptationSchema,
    validate: (data) => [
      ...(data.status === "ready"
        ? validateAdaptationSummary(data.summary, original.content)
        : []),
      ...validateEpisodeAdaptationOutput({
        output: data,
        sourceUnits,
        targetDurationSeconds,
      }),
    ],
    temperature: 0.2,
    onOutputStart: () => {
      outputStarts += 1;
      preview = createJsonStringFieldStream("adaptedText");
      input.onProgress?.({
        type: "phase",
        phase: outputStarts === 1 ? "generating" : "correcting",
      });
      input.onProgress?.({ type: "reset" });
    },
    onTextDelta: (delta) => {
      const contentDelta = preview.push(delta);
      if (contentDelta)
        input.onProgress?.({ type: "delta", delta: contentDelta });
    },
  });

  input.onProgress?.({ type: "phase", phase: "validating" });
  if (result.data.status === "split_recommended")
    throw new EpisodeSourceError(
      "本章在 90 秒内无法同时保留全部关键事件，建议确认拆集边界",
      409,
      {
        code: "EPISODE_SPLIT_RECOMMENDED",
        reason: result.data.reason,
        suggestedBoundarySourceUnitId:
          result.data.suggestedBoundarySourceUnitId,
        firstPartHook: result.data.firstPartHook,
        secondPartOpening: result.data.secondPartOpening,
      },
    );
  const productionPlan = finalizeEpisodeProductionPlan(
    result.data.productionPlan,
    original.content,
  );

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
      title: result.data.title,
      summary: result.data.summary,
      content: result.data.adaptedText,
      adaptationMode: input.mode,
      instructions: input.instructions?.trim() || null,
      changeSummary: toJson(result.data.changeSummary),
      promptTrace: toJson(result.trace),
      productionPlan: toJson(productionPlan),
      productionPlanVersion: EPISODE_PRODUCTION_PLAN_VERSION,
      channelId: input.channelId,
      model: input.model,
      sourceHash: textHash(result.data.adaptedText),
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

export function validateSourceEvidence(evidence: string[], source: string) {
  return evidence.flatMap((quote, index) =>
    source.includes(quote)
      ? []
      : [
          {
            code: "SOURCE_EVIDENCE_NOT_FOUND",
            path: `sourceEvidence.${index}`,
            message: "sourceEvidence must be copied verbatim from source_text",
          },
        ],
  );
}

export function buildSourceEvidenceCandidates(source: string) {
  return buildDistributedEvidenceCandidates(source, 8, 40);
}

function buildDistributedEvidenceCandidates(
  source: string,
  maximumCount: number,
  maximumLength: number,
) {
  const segments = (source.match(/[^。！？!?\r\n]+[。！？!?]?/gu) ?? [])
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 10);
  if (!segments.length) {
    const fallback = source.trim().slice(0, maximumLength);
    return fallback ? [fallback] : [];
  }
  const candidates: string[] = [];
  const count = Math.min(maximumCount, segments.length);
  for (let index = 0; index < count; index += 1) {
    const segmentIndex = Math.round(
      (index * (segments.length - 1)) / Math.max(1, count - 1),
    );
    const quote = segments[segmentIndex].slice(0, maximumLength);
    if (!candidates.includes(quote)) candidates.push(quote);
  }
  return candidates;
}

export type AdaptationEventAnchor = {
  eventId: string;
  evidence: string;
};

export function buildAdaptationEventAnchors(
  source: string,
): AdaptationEventAnchor[] {
  return buildSourceEvents(source)
    .flatMap((event) => splitAdaptationEventEvidence(event.evidence))
    .map((evidence, index) => ({
      eventId: `A${String(index + 1).padStart(3, "0")}`,
      evidence,
    }));
}

function splitAdaptationEventEvidence(value: string, maximumLength = 800) {
  if (value.length <= maximumLength) return [value];
  const parts: string[] = [];
  for (let start = 0; start < value.length; start += maximumLength) {
    const part = value.slice(start, start + maximumLength).trim();
    if (part) parts.push(part);
  }
  return parts;
}

export function validateAdaptationEventCoverage(
  coverage: Array<{
    eventId: string;
    sourceEvidence: string;
    adaptedEvidence: string;
  }>,
  anchors: readonly AdaptationEventAnchor[],
  adaptedText: string,
) {
  const issues: Array<{
    code: string;
    path: string;
    message: string;
  }> = [];
  const expected = new Map(anchors.map((anchor) => [anchor.eventId, anchor]));
  const seen = new Set<string>();
  coverage.forEach((item, index) => {
    const anchor = expected.get(item.eventId);
    if (!anchor)
      issues.push({
        code: "ADAPTATION_EVENT_UNKNOWN",
        path: `eventCoverage.${index}.eventId`,
        message: `Unknown adaptation event anchor ${item.eventId}`,
      });
    else if (item.sourceEvidence !== anchor.evidence)
      issues.push({
        code: "ADAPTATION_EVENT_SOURCE_CHANGED",
        path: `eventCoverage.${index}.sourceEvidence`,
        message: `Source evidence for ${item.eventId} must remain verbatim`,
      });
    if (seen.has(item.eventId))
      issues.push({
        code: "ADAPTATION_EVENT_DUPLICATE",
        path: `eventCoverage.${index}.eventId`,
        message: `Adaptation event anchor ${item.eventId} appears more than once`,
      });
    seen.add(item.eventId);
    if (!adaptedText.includes(item.adaptedEvidence))
      issues.push({
        code: "ADAPTATION_EVENT_OUTPUT_NOT_FOUND",
        path: `eventCoverage.${index}.adaptedEvidence`,
        message: `Adapted evidence for ${item.eventId} must be copied verbatim from adaptedText`,
      });
  });
  anchors.forEach((anchor) => {
    if (!seen.has(anchor.eventId))
      issues.push({
        code: "ADAPTATION_EVENT_MISSING",
        path: "eventCoverage",
        message: `Adaptation event anchor ${anchor.eventId} is not accounted for`,
      });
  });
  return issues;
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

export function validateAdaptationSummary(summary: string, source: string) {
  const normalized = summary.replace(/\s+/gu, "").trim();
  const sourceLength = source.replace(/\s+/gu, "").length;
  const minimumLength = Math.min(
    sourceLength,
    180,
    Math.max(30, Math.ceil(sourceLength * 0.03)),
  );
  return normalized.length >= minimumLength
    ? []
    : [
        {
          code: "EPISODE_SUMMARY_TOO_SHALLOW",
          path: "summary",
          message:
            "summary must be regenerated from the complete source and cover setup, conflict, turning point, and ending state",
        },
      ];
}

export function extractPartialJsonStringField(raw: string, field: string) {
  const valueStart = findJsonStringFieldValue(raw, field);
  if (valueStart === null) return null;
  return readJsonString(raw, valueStart).value;
}

export function createJsonStringFieldStream(field: string) {
  let prefix = "";
  let started = false;
  let completed = false;
  let escaped = false;
  let unicode: string | null = null;
  const marker = new RegExp(`"${escapeRegExp(field)}"\\s*:\\s*"`, "u");

  return {
    push(chunk: string) {
      if (completed || !chunk) return "";
      let input = chunk;
      if (!started) {
        prefix += chunk;
        const match = marker.exec(prefix);
        if (!match) return "";
        started = true;
        input = prefix.slice((match.index ?? 0) + match[0].length);
        prefix = "";
      }

      let output = "";
      for (const current of input) {
        if (unicode !== null) {
          if (!/[0-9a-f]/iu.test(current)) {
            completed = true;
            break;
          }
          unicode += current;
          if (unicode.length === 4) {
            output += String.fromCharCode(Number.parseInt(unicode, 16));
            unicode = null;
            escaped = false;
          }
          continue;
        }
        if (escaped) {
          if (current === "u") {
            unicode = "";
            continue;
          }
          output += decodeJsonEscape(current);
          escaped = false;
          continue;
        }
        if (current === "\\") {
          escaped = true;
          continue;
        }
        if (current === '"') {
          completed = true;
          break;
        }
        output += current;
      }
      return output;
    },
  };
}

function decodeJsonEscape(value: string) {
  return value === "n"
    ? "\n"
    : value === "r"
      ? "\r"
      : value === "t"
        ? "\t"
        : value === "b"
          ? "\b"
          : value === "f"
            ? "\f"
            : value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function findJsonStringFieldValue(raw: string, field: string) {
  let index = 0;
  while (index < raw.length) {
    if (raw[index] !== '"') {
      index += 1;
      continue;
    }
    const token = readJsonString(raw, index + 1);
    if (!token.complete) return null;
    let cursor = token.end + 1;
    while (/\s/u.test(raw[cursor] ?? "")) cursor += 1;
    if (token.value === field && raw[cursor] === ":") {
      cursor += 1;
      while (/\s/u.test(raw[cursor] ?? "")) cursor += 1;
      return raw[cursor] === '"' ? cursor + 1 : null;
    }
    index = token.end + 1;
  }
  return null;
}

function readJsonString(raw: string, start: number) {
  let value = "";
  for (let index = start; index < raw.length; index += 1) {
    const current = raw[index];
    if (current === '"') return { value, end: index, complete: true };
    if (current !== "\\") {
      value += current;
      continue;
    }
    const escaped = raw[index + 1];
    if (!escaped) return { value, end: raw.length, complete: false };
    if (escaped === "u") {
      const hex = raw.slice(index + 2, index + 6);
      if (!/^[0-9a-f]{4}$/iu.test(hex))
        return { value, end: raw.length, complete: false };
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }
    value +=
      escaped === "n"
        ? "\n"
        : escaped === "r"
          ? "\r"
          : escaped === "t"
            ? "\t"
            : escaped === "b"
              ? "\b"
              : escaped === "f"
                ? "\f"
                : escaped;
    index += 1;
  }
  return { value, end: raw.length, complete: false };
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
