import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { assertEpisodeHasNoDownstream } from "@/lib/episodes/adaptation";
import { prisma } from "@/lib/server/prisma";
import type { EpisodeRecord, ProjectRecord } from "./types";

const projectInclude = {
  config: true,
  _count: {
    select: {
      episodes: true,
      mediaTasks: { where: { status: "failed" } },
    },
  },
  workflowRuns: {
    orderBy: { updatedAt: "desc" as const },
    take: 1,
    select: {
      episodeId: true,
      status: true,
      updatedAt: true,
      workflowType: true,
    },
  },
} as const;

export async function listProjects(
  userId: string,
  options: { page: number; pageSize: number; search?: string },
) {
  const search = options.search?.trim();
  const where = {
    userId,
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            { description: { contains: search } },
          ],
        }
      : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      include: projectInclude,
      orderBy: { updatedAt: "desc" },
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
    }),
  ]);
  return { projects: rows.map(toProject), total };
}

export async function getProject(
  userId: string,
  projectId: string,
  options?: { touch?: boolean },
) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    include: projectInclude,
  });
  if (!project) return null;
  if (options?.touch !== false)
    await prisma.project.update({
      where: { id: projectId },
      data: { lastAccessedAt: new Date() },
    });
  return toProject(project);
}

export async function createProject(
  userId: string,
  input: { name: string; description: string | null },
) {
  const project = await prisma.project.create({
    data: {
      id: randomUUID(),
      userId,
      name: input.name,
      description: input.description,
      config: { create: { id: randomUUID() } },
    },
    include: projectInclude,
  });
  return toProject(project);
}

export async function updateProject(
  userId: string,
  projectId: string,
  input: { name?: string; description?: string | null },
) {
  const existing = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!existing) return null;
  const project = await prisma.project.update({
    where: { id: projectId },
    data: input,
    include: projectInclude,
  });
  return toProject(project);
}

export async function deleteProject(userId: string, projectId: string) {
  const result = await prisma.project.deleteMany({
    where: { id: projectId, userId },
  });
  return result.count > 0;
}

export async function listEpisodes(userId: string, projectId: string) {
  if (!(await prisma.project.count({ where: { id: projectId, userId } })))
    return null;
  const episodes = await prisma.episode.findMany({
    where: { projectId },
    orderBy: { episodeNumber: "asc" },
  });
  return episodes.map(toEpisode);
}

export async function createEpisode(
  userId: string,
  projectId: string,
  input: { name: string; description: string | null; novelText: string | null },
) {
  if (!(await prisma.project.count({ where: { id: projectId, userId } })))
    return null;
  const last = await prisma.episode.findFirst({
    where: { projectId },
    orderBy: { episodeNumber: "desc" },
    select: { episodeNumber: true },
  });
  const sourceId = input.novelText ? randomUUID() : null;
  const episode = await prisma.episode.create({
    data: {
      id: randomUUID(),
      projectId,
      episodeNumber: (last?.episodeNumber ?? 0) + 1,
      ...input,
      activeSourceId: sourceId,
      activeSourceKind: "original",
      ...(sourceId && input.novelText
        ? {
            sourceVersions: {
              create: {
                id: sourceId,
                kind: "original",
                version: 1,
                title: input.name,
                summary: input.description,
                content: input.novelText,
                sourceHash: textHash(input.novelText),
              },
            },
          }
        : {}),
    },
  });
  return toEpisode(episode);
}

export async function updateEpisode(
  userId: string,
  projectId: string,
  episodeId: string,
  input: {
    name?: string;
    description?: string | null;
    novelText?: string | null;
  },
) {
  const existing = await prisma.episode.findFirst({
    where: { id: episodeId, projectId, project: { userId } },
  });
  if (!existing) return null;
  const nextText =
    input.novelText === undefined
      ? undefined
      : input.novelText?.trim() || null;
  if (nextText === undefined || nextText === existing.novelText)
    return toEpisode(
      await prisma.episode.update({ where: { id: episodeId }, data: input }),
    );
  await assertEpisodeHasNoDownstream({ userId, projectId, episodeId });

  if (!nextText)
    return toEpisode(
      await prisma.episode.update({
        where: { id: episodeId },
        data: {
          ...input,
          novelText: null,
          activeSourceId: null,
          activeSourceKind: "original",
        },
      }),
    );

  return prisma.$transaction(async (tx) => {
    const kind = existing.activeSourceKind === "adapted" ? "adapted" : "original";
    const latest = await tx.episodeSourceVersion.findFirst({
      where: { episodeId, kind },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const sourceId = randomUUID();
    await tx.episodeSourceVersion.create({
      data: {
        id: sourceId,
        episodeId,
        kind,
        version: (latest?.version ?? 0) + 1,
        title: input.name ?? existing.name,
        summary:
          input.description === undefined
            ? existing.description
            : input.description,
        content: nextText,
        adaptationMode: kind === "adapted" ? "manual" : null,
        sourceHash: textHash(nextText),
      },
    });
    return toEpisode(
      await tx.episode.update({
        where: { id: episodeId },
        data: {
          ...input,
          novelText: nextText,
          activeSourceId: sourceId,
          activeSourceKind: kind,
        },
      }),
    );
  });
}

export async function deleteEpisode(
  userId: string,
  projectId: string,
  episodeId: string,
) {
  const result = await prisma.episode.deleteMany({
    where: { id: episodeId, projectId, project: { userId } },
  });
  return result.count > 0;
}

type ProjectWithRelations = Prisma.ProjectGetPayload<{
  include: typeof projectInclude;
}>;

function toProject(row: ProjectWithRelations): ProjectRecord {
  const config = row.config;
  const latestWorkflow = row.workflowRuns[0] ?? null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    episodeCount: row._count.episodes,
    failedTaskCount: row._count.mediaTasks,
    latestWorkflow: latestWorkflow
      ? {
          episodeId: latestWorkflow.episodeId,
          status: latestWorkflow.status,
          updatedAt: latestWorkflow.updatedAt.toISOString(),
          workflowType: latestWorkflow.workflowType,
        }
      : null,
    config: {
      analysisModel: config?.analysisModel ?? null,
      characterModel: config?.characterModel ?? null,
      locationModel: config?.locationModel ?? null,
      storyboardModel: config?.storyboardModel ?? null,
      editModel: config?.editModel ?? null,
      videoModel: config?.videoModel ?? null,
      audioModel: config?.audioModel ?? null,
      videoRatio: config?.videoRatio ?? "9:16",
      videoResolution: config?.videoResolution ?? "720p",
      artStyle: config?.artStyle ?? "american-comic",
      ttsRate: config?.ttsRate ?? "+50%",
      workflowMode: config?.workflowMode ?? "novel-promotion",
      globalAssetText: config?.globalAssetText ?? null,
      capabilityOverrides: parseJsonObject(config?.capabilityOverridesJson),
    },
  };
}

function toEpisode(row: {
  id: string;
  projectId: string;
  episodeNumber: number;
  name: string;
  description: string | null;
  novelText: string | null;
  activeSourceId: string | null;
  activeSourceKind: string;
  createdAt: Date;
  updatedAt: Date;
}): EpisodeRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    episodeNumber: row.episodeNumber,
    name: row.name,
    description: row.description,
    novelText: row.novelText,
    activeSourceId: row.activeSourceId,
    activeSourceKind:
      row.activeSourceKind === "adapted" ? "adapted" : "original",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function textHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parseJsonObject(
  value: string | null | undefined,
): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
