import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import {
  mergeCanonicalSummary,
  sanitizeCanonicalSummary,
} from "@/lib/assets/canonical-summary";
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
  options: { summaryMode?: "replace" | "merge" } = {},
) {
  if (!(await ownsProject(userId, projectId))) return null;
  const result = [] as NovelLocationRecord[];
  for (const item of input) {
    const name = item.name.trim();
    if (!name) continue;
    const existing =
      options.summaryMode === "merge"
        ? await prisma.novelLocation.findUnique({
            where: { projectId_name: { projectId, name } },
            select: { summary: true },
          })
        : null;
    const summary =
      options.summaryMode === "merge"
        ? mergeCanonicalSummary(existing?.summary, item.summary)
        : sanitizeCanonicalSummary(item.summary);
    const row = await prisma.novelLocation.upsert({
      where: { projectId_name: { projectId, name } },
      create: {
        id: randomUUID(),
        projectId,
        name,
        summary,
      },
      update: { summary },
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
      id?: string;
      panelIndex: number;
      sceneNumber?: number | null;
      clipId?: string | null;
      clipPanelIndex?: number | null;
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
      speakingCharacter?: string | null;
      lipSyncText?: string | null;
      voiceoverText?: string | null;
      startState?: Record<string, unknown>;
      endState?: Record<string, unknown>;
      motionBeats?: Array<Record<string, unknown>>;
      worldContext?: Record<string, unknown>;
      vfxCues?: Array<Record<string, unknown>>;
      sfxCues?: Array<Record<string, unknown>>;
      actingNotes?: Record<string, unknown>;
      photographyRules?: string | null;
      firstLastFramePrompt?: string | null;
      linkedToNextPanel?: boolean;
      sourceEvidence?: string[];
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
    const clipIds = Array.from(
      new Set(
        input.panels.flatMap((panel) => panel.clipId ? [panel.clipId] : []),
      ),
    );
    if (
      input.panels.some(
        (panel) =>
          (panel.clipId == null) !== (panel.clipPanelIndex == null) ||
          (panel.clipPanelIndex !== undefined &&
            panel.clipPanelIndex !== null &&
            (!Number.isInteger(panel.clipPanelIndex) || panel.clipPanelIndex < 0)),
      )
    )
      throw new Error("STORYBOARD_PANEL_CLIP_IDENTITY_INVALID");
    if (
      clipIds.length &&
      await tx.storyClip.count({
        where: { id: { in: clipIds }, episodeId, projectId },
      }) !== clipIds.length
    )
      throw new Error("STORYBOARD_PANEL_CLIP_NOT_FOUND");
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
    const existingPanels = await tx.storyboardPanel.findMany({
      where: { storyboardId: storyboard.id },
      select: {
        id: true,
        clipId: true,
        clipPanelIndex: true,
        panelIndex: true,
      },
    });
    const existingByIdentity = new Map(
      existingPanels.map((panel) => [panelIdentity(panel), panel]),
    );
    const existingById = new Map(
      existingPanels.map((panel) => [panel.id, panel]),
    );
    if (existingPanels.length) {
      const largestIndex = existingPanels.reduce(
        (largest, panel) => Math.max(largest, panel.panelIndex),
        0,
      );
      await tx.storyboardPanel.updateMany({
        where: { storyboardId: storyboard.id },
        data: { panelIndex: { increment: largestIndex + input.panels.length + 1 } },
      });
    }
    const retainedIds: string[] = [];
    for (const [index, panel] of input.panels.entries()) {
      const identity = panelIdentity({
        clipId: panel.clipId ?? null,
        clipPanelIndex: panel.clipPanelIndex ?? null,
        panelIndex: panel.panelIndex ?? index,
      });
      const id =
        (panel.id ? existingById.get(panel.id)?.id : undefined) ??
        (!panel.id ? existingByIdentity.get(identity)?.id : undefined) ??
        randomUUID();
      retainedIds.push(id);
      const data = {
        clipId: panel.clipId ?? null,
        clipPanelIndex: panel.clipPanelIndex ?? null,
        panelIndex: panel.panelIndex ?? index,
        sceneNumber:
          typeof panel.sceneNumber === "number" ? panel.sceneNumber : null,
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
        speakingCharacter: panel.speakingCharacter?.trim() || null,
        lipSyncText: panel.lipSyncText?.trim() || null,
        voiceoverText: panel.voiceoverText?.trim() || null,
        startStateJson: stringifyObject(panel.startState),
        endStateJson: stringifyObject(panel.endState),
        motionBeatsJson: stringifyObjectArray(panel.motionBeats),
        worldContextJson: stringifyObject(panel.worldContext),
        vfxCuesJson: stringifyObjectArray(panel.vfxCues),
        sfxCuesJson: stringifyObjectArray(panel.sfxCues),
        actingNotesJson: stringifyObject(panel.actingNotes),
        photographyRules: panel.photographyRules?.trim() || null,
        firstLastFramePrompt: panel.firstLastFramePrompt?.trim() || null,
        linkedToNextPanel: panel.linkedToNextPanel ?? false,
        sourceEvidenceJson: stringifyArray(panel.sourceEvidence),
      };
      await tx.storyboardPanel.upsert({
        where: { id },
        create: { id, storyboardId: storyboard.id, ...data },
        update: data,
      });
    }
    await tx.storyboardPanel.deleteMany({
      where: {
        storyboardId: storyboard.id,
        ...(retainedIds.length ? { id: { notIn: retainedIds } } : {}),
      },
    });
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
function stringifyObjectArray(value?: Array<Record<string, unknown>>) {
  return value?.length ? JSON.stringify(value) : null;
}
function finiteNumber(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function panelIdentity(panel: {
  clipId: string | null;
  clipPanelIndex: number | null;
  panelIndex: number;
}) {
  return panel.clipId !== null && panel.clipPanelIndex !== null
    ? `clip:${panel.clipId}:${panel.clipPanelIndex}`
    : `panel:${panel.panelIndex}`;
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
function parseObjectArray(value: string | null) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item),
        )
      : [];
  } catch {
    return [];
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
    visualProfile: parseObject(row.visualProfileJson),
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
    visualProfile: parseObject(row.visualProfileJson),
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
    clipId: row.clipId,
    clipPanelIndex: row.clipPanelIndex,
    panelIndex: row.panelIndex,
    sceneNumber: row.sceneNumber,
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
    speakingCharacter: row.speakingCharacter,
    lipSyncText: row.lipSyncText,
    voiceoverText: row.voiceoverText,
    startState: parseObject(row.startStateJson),
    endState: parseObject(row.endStateJson),
    motionBeats: parseObjectArray(row.motionBeatsJson),
    worldContext: parseObject(row.worldContextJson),
    vfxCues: parseObjectArray(row.vfxCuesJson),
    sfxCues: parseObjectArray(row.sfxCuesJson),
    actingNotes: parseObject(row.actingNotesJson),
    photographyRules: row.photographyRules,
    firstLastFramePrompt: row.firstLastFramePrompt,
    linkedToNextPanel: row.linkedToNextPanel,
    sourceEvidence: parseArray(row.sourceEvidenceJson),
    imageAssetId: row.imageAssetId,
    videoAssetId: row.videoAssetId,
    lipSyncAssetId: row.lipSyncAssetId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
