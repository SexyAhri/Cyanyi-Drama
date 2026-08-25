import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/server/prisma";
import type {
  CharacterAppearanceRecord,
  LocationImageRecord,
  NovelCharacterRecord,
  NovelLocationRecord,
  StoryboardPanelRecord,
  StoryboardRecord,
} from "./domain-types";

const characterInclude = {
  appearances: { orderBy: { appearanceIndex: "asc" as const } },
} as const;
const locationInclude = {
  images: { orderBy: { imageIndex: "asc" as const } },
} as const;
const storyboardInclude = {
  panels: { orderBy: { panelIndex: "asc" as const } },
} as const;

export async function listNovelCharacters(userId: string, projectId: string) {
  if (!(await ownsProject(userId, projectId))) return null;
  const rows = await prisma.novelCharacter.findMany({
    where: { projectId },
    include: characterInclude,
    orderBy: { name: "asc" },
  });
  return rows.map(toCharacter);
}

export async function upsertNovelCharacters(
  userId: string,
  projectId: string,
  input: Array<{
    name: string;
    aliases?: string[];
    profile?: Record<string, unknown>;
    introduction?: string | null;
  }>,
) {
  if (!(await ownsProject(userId, projectId))) return null;
  const result = [] as NovelCharacterRecord[];
  for (const item of input) {
    const name = item.name.trim();
    if (!name) continue;
    const row = await prisma.novelCharacter.upsert({
      where: { projectId_name: { projectId, name } },
      create: {
        id: randomUUID(),
        projectId,
        name,
        aliases: stringifyArray(item.aliases),
        profileJson: stringifyObject(item.profile),
        introduction: item.introduction?.trim() || null,
        appearances: undefined,
      },
      update: {
        aliases: stringifyArray(item.aliases),
        profileJson: stringifyObject(item.profile),
        introduction: item.introduction?.trim() || null,
      },
      include: characterInclude,
    });
    result.push(toCharacter(row));
  }
  return result;
}

export async function listNovelLocations(userId: string, projectId: string) {
  if (!(await ownsProject(userId, projectId))) return null;
  const rows = await prisma.novelLocation.findMany({
    where: { projectId },
    include: locationInclude,
    orderBy: { name: "asc" },
  });
  return rows.map(toLocation);
}

export async function upsertNovelLocations(
  userId: string,
  projectId: string,
  input: Array<{ name: string; summary?: string | null }>,
) {
  if (!(await ownsProject(userId, projectId))) return null;
  const result = [] as NovelLocationRecord[];
  for (const item of input) {
    const name = item.name.trim();
    if (!name) continue;
    const row = await prisma.novelLocation.upsert({
      where: { projectId_name: { projectId, name } },
      create: {
        id: randomUUID(),
        projectId,
        name,
        summary: item.summary?.trim() || null,
      },
      update: { summary: item.summary?.trim() || null },
      include: locationInclude,
    });
    result.push(toLocation(row));
  }
  return result;
}

export async function getStoryboard(
  userId: string,
  projectId: string,
  episodeId: string,
) {
  const row = await prisma.storyboard.findFirst({
    where: { projectId, episodeId, project: { userId } },
    include: storyboardInclude,
  });
  return row ? toStoryboard(row) : null;
}

export async function saveStoryboard(
  userId: string,
  projectId: string,
  episodeId: string,
  input: {
    status?: string;
    sourceHash?: string | null;
    panels: Array<{
      panelIndex: number;
      shotType?: string | null;
      cameraMove?: string | null;
      description?: string | null;
      locationName?: string | null;
      characters?: string[];
      props?: string[];
      imagePrompt?: string | null;
      videoPrompt?: string | null;
      phase?: string;
      status?: string;
      srtStart?: number | null;
      srtEnd?: number | null;
      durationSeconds?: number | null;
      subtitleText?: string | null;
      actingNotes?: Record<string, unknown>;
      photographyRules?: string | null;
      firstLastFramePrompt?: string | null;
      linkedToNextPanel?: boolean;
    }>;
  },
) {
  if (
    !(await prisma.episode.count({
      where: { id: episodeId, projectId, project: { userId } },
    }))
  )
    return null;
  const row = await prisma.$transaction(async (tx) => {
    const storyboard = await tx.storyboard.upsert({
      where: { episodeId },
      create: {
        id: randomUUID(),
        projectId,
        episodeId,
        status: input.status ?? "draft",
        sourceHash: input.sourceHash ?? null,
      },
      update: {
        status: input.status ?? "draft",
        sourceHash: input.sourceHash ?? null,
        version: { increment: 1 },
      },
    });
    await tx.storyboardPanel.deleteMany({
      where: { storyboardId: storyboard.id },
    });
    if (input.panels.length) {
      await tx.storyboardPanel.createMany({
        data: input.panels.map((panel, index) => ({
          id: randomUUID(),
          storyboardId: storyboard.id,
          panelIndex: panel.panelIndex ?? index,
          shotType: panel.shotType?.trim() || null,
          cameraMove: panel.cameraMove?.trim() || null,
          description: panel.description?.trim() || null,
          locationName: panel.locationName?.trim() || null,
          charactersJson: stringifyArray(panel.characters),
          propsJson: stringifyArray(panel.props),
          imagePrompt: panel.imagePrompt?.trim() || null,
          videoPrompt: panel.videoPrompt?.trim() || null,
          phase: panel.phase?.trim() || "phase1",
          status: panel.status?.trim() || "draft",
          srtStart: finiteNumber(panel.srtStart),
          srtEnd: finiteNumber(panel.srtEnd),
          durationSeconds: finiteNumber(panel.durationSeconds),
          subtitleText: panel.subtitleText?.trim() || null,
          actingNotesJson: stringifyObject(panel.actingNotes),
          photographyRules: panel.photographyRules?.trim() || null,
          firstLastFramePrompt: panel.firstLastFramePrompt?.trim() || null,
          linkedToNextPanel: panel.linkedToNextPanel ?? false,
        })),
      });
    }
    return tx.storyboard.findUniqueOrThrow({
      where: { id: storyboard.id },
      include: storyboardInclude,
    });
  });
  return toStoryboard(row);
}

async function ownsProject(userId: string, projectId: string) {
  return (await prisma.project.count({ where: { id: projectId, userId } })) > 0;
}

function stringifyArray(value?: string[]) {
  return value?.length ? JSON.stringify(value) : null;
}
function stringifyObject(value?: Record<string, unknown>) {
  return value && Object.keys(value).length ? JSON.stringify(value) : null;
}
function finiteNumber(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function parseArray(value: string | null) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
function parseObject(value: string | null) {
  try {
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toCharacter(
  row: Prisma.NovelCharacterGetPayload<{ include: typeof characterInclude }>,
): NovelCharacterRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    aliases: parseArray(row.aliases),
    profile: parseObject(row.profileJson),
    introduction: row.introduction,
    confirmed: row.confirmed,
    appearances: row.appearances.map(toAppearance),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function toAppearance(
  row: Prisma.CharacterAppearanceGetPayload<Record<string, never>>,
): CharacterAppearanceRecord {
  return {
    id: row.id,
    characterId: row.characterId,
    appearanceIndex: row.appearanceIndex,
    description: row.description,
    imageAssetId: row.imageAssetId,
    selected: row.selected,
    metadata: parseObject(row.metadataJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function toLocation(
  row: Prisma.NovelLocationGetPayload<{ include: typeof locationInclude }>,
): NovelLocationRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    summary: row.summary,
    selectedImageId: row.selectedImageId,
    images: row.images.map(toLocationImage),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function toLocationImage(
  row: Prisma.LocationImageGetPayload<Record<string, never>>,
): LocationImageRecord {
  return {
    id: row.id,
    locationId: row.locationId,
    imageIndex: row.imageIndex,
    description: row.description,
    availableSlots: parseArray(row.availableSlots),
    imageAssetId: row.imageAssetId,
    selected: row.selected,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function toStoryboard(
  row: Prisma.StoryboardGetPayload<{ include: typeof storyboardInclude }>,
): StoryboardRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    episodeId: row.episodeId,
    status: row.status,
    version: row.version,
    sourceHash: row.sourceHash,
    panels: row.panels.map(toPanel),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function toPanel(
  row: Prisma.StoryboardPanelGetPayload<Record<string, never>>,
): StoryboardPanelRecord {
  return {
    id: row.id,
    storyboardId: row.storyboardId,
    panelIndex: row.panelIndex,
    shotType: row.shotType,
    cameraMove: row.cameraMove,
    description: row.description,
    locationName: row.locationName,
    characters: parseArray(row.charactersJson),
    props: parseArray(row.propsJson),
    imagePrompt: row.imagePrompt,
    videoPrompt: row.videoPrompt,
    phase: row.phase,
    status: row.status,
    srtStart: row.srtStart,
    srtEnd: row.srtEnd,
    durationSeconds: row.durationSeconds,
    subtitleText: row.subtitleText,
    actingNotes: parseObject(row.actingNotesJson),
    photographyRules: row.photographyRules,
    firstLastFramePrompt: row.firstLastFramePrompt,
    linkedToNextPanel: row.linkedToNextPanel,
    imageAssetId: row.imageAssetId,
    videoAssetId: row.videoAssetId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
