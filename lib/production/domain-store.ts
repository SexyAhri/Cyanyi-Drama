import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/server/prisma";

export type ProductionPropInput = {
  name: string;
  summary?: string | null;
  metadata?: Record<string, unknown>;
};

export type ProductionShotInput = {
  shotIndex: number;
  sequence?: string | null;
  description?: string | null;
  locationName?: string | null;
  characters?: string[];
  props?: string[];
  cameraMove?: string | null;
  imagePrompt?: string | null;
  videoPrompt?: string | null;
  srtStart?: number | null;
  srtEnd?: number | null;
  durationSeconds?: number | null;
};

export type ProductionClipInput = {
  clipIndex: number;
  summary: string;
  content: string;
  startText?: string | null;
  endText?: string | null;
  screenplay?: string | null;
  characters?: string[];
  locations?: string[];
  props?: string[];
  shotCount?: number | null;
  shots?: ProductionShotInput[];
};

export async function listProductionProps(userId: string, projectId: string) {
  if (!(await ownsProject(userId, projectId))) return null;
  const rows = await prisma.novelProp.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    summary: row.summary,
    metadata: parseObject(row.metadataJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function upsertProductionProps(
  userId: string,
  projectId: string,
  input: ProductionPropInput[],
) {
  if (!(await ownsProject(userId, projectId))) return null;
  const result = [];
  for (const item of input) {
    const name = item.name.trim();
    if (!name) continue;
    const row = await prisma.novelProp.upsert({
      where: { projectId_name: { projectId, name } },
      create: {
        id: randomUUID(),
        projectId,
        name,
        summary: item.summary?.trim() || null,
        metadataJson: stringifyObject(item.metadata),
      },
      update: {
        summary: item.summary?.trim() || null,
        metadataJson: stringifyObject(item.metadata),
      },
    });
    result.push({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      summary: row.summary,
      metadata: parseObject(row.metadataJson),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  return result;
}

export async function saveProductionClips(
  userId: string,
  projectId: string,
  episodeId: string,
  input: ProductionClipInput[],
) {
  const ownsEpisode = await prisma.episode.count({
    where: { id: episodeId, projectId, project: { userId } },
  });
  if (!ownsEpisode) return null;
  await prisma.$transaction(async (tx) => {
    await tx.storyShot.deleteMany({ where: { episodeId } });
    await tx.storyClip.deleteMany({ where: { episodeId } });
    for (const clip of input.sort((a, b) => a.clipIndex - b.clipIndex)) {
      const clipId = randomUUID();
      await tx.storyClip.create({
        data: {
          id: clipId,
          projectId,
          episodeId,
          clipIndex: clip.clipIndex,
          summary: clip.summary.trim(),
          content: clip.content.trim(),
          startText: clip.startText?.trim() || null,
          endText: clip.endText?.trim() || null,
          screenplay: clip.screenplay?.trim() || null,
          charactersJson: stringifyArray(clip.characters),
          locationsJson: stringifyArray(clip.locations),
          propsJson: stringifyArray(clip.props),
          shotCount: clip.shotCount ?? clip.shots?.length ?? null,
          shots: clip.shots?.length
            ? {
                create: clip.shots.map((shot) => ({
                  id: randomUUID(),
                  projectId,
                  episodeId,
                  shotIndex: shot.shotIndex,
                  sequence: shot.sequence?.trim() || null,
                  description: shot.description?.trim() || null,
                  locationName: shot.locationName?.trim() || null,
                  charactersJson: stringifyArray(shot.characters),
                  propsJson: stringifyArray(shot.props),
                  cameraMove: shot.cameraMove?.trim() || null,
                  imagePrompt: shot.imagePrompt?.trim() || null,
                  videoPrompt: shot.videoPrompt?.trim() || null,
                  srtStart: finiteNumber(shot.srtStart),
                  srtEnd: finiteNumber(shot.srtEnd),
                  durationSeconds: finiteNumber(shot.durationSeconds),
                })),
              }
            : undefined,
        },
      });
    }
  });
  return listProductionClips(userId, projectId, episodeId);
}

export async function listProductionClips(
  userId: string,
  projectId: string,
  episodeId: string,
) {
  const rows = await prisma.storyClip.findMany({
    where: { projectId, episodeId, project: { userId } },
    include: { shots: { orderBy: { shotIndex: "asc" } } },
    orderBy: { clipIndex: "asc" },
  });
  return rows.map((clip) => ({
    id: clip.id,
    projectId: clip.projectId,
    episodeId: clip.episodeId,
    clipIndex: clip.clipIndex,
    summary: clip.summary,
    content: clip.content,
    startText: clip.startText,
    endText: clip.endText,
    screenplay: clip.screenplay,
    characters: parseArray(clip.charactersJson),
    locations: parseArray(clip.locationsJson),
    props: parseArray(clip.propsJson),
    shotCount: clip.shotCount,
    status: clip.status,
    shots: clip.shots.map((shot) => ({
      id: shot.id,
      shotIndex: shot.shotIndex,
      sequence: shot.sequence,
      description: shot.description,
      locationName: shot.locationName,
      characters: parseArray(shot.charactersJson),
      props: parseArray(shot.propsJson),
      cameraMove: shot.cameraMove,
      imagePrompt: shot.imagePrompt,
      videoPrompt: shot.videoPrompt,
      imageAssetId: shot.imageAssetId,
      videoAssetId: shot.videoAssetId,
      srtStart: shot.srtStart,
      srtEnd: shot.srtEnd,
      durationSeconds: shot.durationSeconds,
    })),
    createdAt: clip.createdAt.toISOString(),
    updatedAt: clip.updatedAt.toISOString(),
  }));
}

export async function getProductionProjectData(
  userId: string,
  projectId: string,
  episodeId: string,
) {
  const [props, clips, voiceLines, editorProject] = await Promise.all([
    listProductionProps(userId, projectId),
    listProductionClips(userId, projectId, episodeId),
    listVoiceLines(userId, projectId, episodeId),
    getEditorProject(userId, projectId, episodeId),
  ]);
  if (!props || !clips) return null;
  return { props, clips, voiceLines, editorProject };
}

export async function listVoiceLines(
  userId: string,
  projectId: string,
  episodeId: string,
) {
  const rows = await prisma.voiceLine.findMany({
    where: { episodeId, episode: { projectId, project: { userId } } },
    orderBy: { lineIndex: "asc" },
  });
  return rows.map(toVoiceLine);
}

export async function saveVoiceLines(
  userId: string,
  projectId: string,
  episodeId: string,
  input: Array<{
    lineIndex: number;
    speaker: string;
    content: string;
    voicePresetId?: string | null;
    emotionPrompt?: string | null;
    emotionStrength?: number | null;
    matchedPanelId?: string | null;
  }>,
) {
  const ownsEpisode = await prisma.episode.count({
    where: { id: episodeId, projectId, project: { userId } },
  });
  if (!ownsEpisode) return null;
  await prisma.$transaction(async (tx) => {
    await tx.voiceLine.deleteMany({ where: { episodeId } });
    if (input.length) {
      await tx.voiceLine.createMany({
        data: input.map((line) => ({
          id: randomUUID(),
          episodeId,
          lineIndex: line.lineIndex,
          speaker: line.speaker.trim(),
          content: line.content.trim(),
          voicePresetId: line.voicePresetId || null,
          emotionPrompt: line.emotionPrompt?.trim() || null,
          emotionStrength: finiteNumber(line.emotionStrength),
          matchedPanelId: line.matchedPanelId || null,
        })),
      });
    }
  });
  return listVoiceLines(userId, projectId, episodeId);
}

export async function getEditorProject(
  userId: string,
  projectId: string,
  episodeId: string,
) {
  const row = await prisma.editorProject.findFirst({
    where: { episodeId, episode: { projectId, project: { userId } } },
  });
  if (!row) return null;
  return {
    id: row.id,
    episodeId: row.episodeId,
    timeline: parseObject(row.timelineJson),
    subtitles: parseValue(row.subtitleJson),
    renderStatus: row.renderStatus,
    renderTaskId: row.renderTaskId,
    outputAssetId: row.outputAssetId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function saveEditorProject(
  userId: string,
  projectId: string,
  episodeId: string,
  timeline: Record<string, unknown>,
  subtitles?: unknown,
) {
  const ownsEpisode = await prisma.episode.count({
    where: { id: episodeId, projectId, project: { userId } },
  });
  if (!ownsEpisode) return null;
  const row = await prisma.editorProject.upsert({
    where: { episodeId },
    create: {
      id: randomUUID(),
      episodeId,
      timelineJson: JSON.stringify(timeline),
      subtitleJson: subtitles === undefined ? null : JSON.stringify(subtitles),
    },
    update: {
      timelineJson: JSON.stringify(timeline),
      subtitleJson:
        subtitles === undefined ? undefined : JSON.stringify(subtitles),
    },
  });
  return {
    id: row.id,
    episodeId: row.episodeId,
    timeline: parseObject(row.timelineJson),
    subtitles: parseValue(row.subtitleJson),
    renderStatus: row.renderStatus,
    renderTaskId: row.renderTaskId,
    outputAssetId: row.outputAssetId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function buildEditorTimeline(
  userId: string,
  projectId: string,
  episodeId: string,
) {
  const clips = await prisma.storyClip.findMany({
    where: { projectId, episodeId, project: { userId } },
    include: { shots: { orderBy: { shotIndex: "asc" } } },
    orderBy: { clipIndex: "asc" },
  });
  if (!clips.length) return null;
  let cursor = 0;
  const tracks = clips.flatMap((clip) =>
    clip.shots.map((shot) => {
      const duration = shot.durationSeconds && shot.durationSeconds > 0 ? shot.durationSeconds : 5;
      const item = {
        id: shot.id,
        clipId: clip.id,
        shotIndex: shot.shotIndex,
        start: cursor,
        end: cursor + duration,
        duration,
        imageAssetId: shot.imageAssetId,
        videoAssetId: shot.videoAssetId,
        type: shot.videoAssetId ? "video" : "image",
      };
      cursor += duration;
      return item;
    }),
  );
  const voiceLines = await prisma.voiceLine.findMany({
    where: { episodeId, episode: { projectId, project: { userId } } },
    orderBy: { lineIndex: "asc" },
  });
  const subtitles = voiceLines.map((line, index) => ({
    id: line.id,
    index,
    start: line.matchedPanelId
      ? tracks.find((track) => track.id === line.matchedPanelId)?.start ?? 0
      : 0,
    end: line.matchedPanelId
      ? tracks.find((track) => track.id === line.matchedPanelId)?.end ?? 0
      : 0,
    speaker: line.speaker,
    text: line.content,
  }));
  return saveEditorProject(
    userId,
    projectId,
    episodeId,
    { version: 1, duration: cursor, tracks },
    subtitles,
  );
}

function toVoiceLine(row: {
  id: string;
  episodeId: string;
  lineIndex: number;
  speaker: string;
  content: string;
  voicePresetId: string | null;
  audioAssetId: string | null;
  emotionPrompt: string | null;
  emotionStrength: number | null;
  matchedPanelId: string | null;
  durationSeconds: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    episodeId: row.episodeId,
    lineIndex: row.lineIndex,
    speaker: row.speaker,
    content: row.content,
    voicePresetId: row.voicePresetId,
    audioAssetId: row.audioAssetId,
    emotionPrompt: row.emotionPrompt,
    emotionStrength: row.emotionStrength,
    matchedPanelId: row.matchedPanelId,
    durationSeconds: row.durationSeconds,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
  const parsed = parseValue(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function parseObject(value: string | null) {
  const parsed = parseValue(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function parseValue(value: string | null) {
  try {
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}
