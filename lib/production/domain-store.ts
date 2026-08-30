import { randomUUID } from "node:crypto";

import {
  mergeCanonicalSummary,
  sanitizeCanonicalSummary,
} from "@/lib/assets/canonical-summary";
import {
  buildSequentialTimeline,
  buildTimelineSubtitles,
} from "@/lib/production/timeline";
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
  status?: string;
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
    visualProfile: parseObject(row.visualProfileJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function upsertProductionProps(
  userId: string,
  projectId: string,
  input: ProductionPropInput[],
  options: { summaryMode?: "replace" | "merge" } = {},
) {
  if (!(await ownsProject(userId, projectId))) return null;
  const result = [];
  for (const item of input) {
    const name = item.name.trim();
    if (!name) continue;
    const existing =
      options.summaryMode === "merge"
        ? await prisma.novelProp.findUnique({
            where: { projectId_name: { projectId, name } },
            select: { summary: true, metadataJson: true },
          })
        : null;
    const summary =
      options.summaryMode === "merge"
        ? mergeCanonicalSummary(existing?.summary, item.summary)
        : sanitizeCanonicalSummary(item.summary);
    const metadataJson =
      item.metadata === undefined && options.summaryMode === "merge"
        ? existing?.metadataJson ?? null
        : stringifyObject(item.metadata);
    const row = await prisma.novelProp.upsert({
      where: { projectId_name: { projectId, name } },
      create: {
        id: randomUUID(),
        projectId,
        name,
        summary,
        metadataJson,
      },
      update: {
        summary,
        metadataJson,
      },
    });
    result.push({
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      summary: row.summary,
      metadata: parseObject(row.metadataJson),
      visualProfile: parseObject(row.visualProfileJson),
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
  const ordered = [...input].sort((a, b) => a.clipIndex - b.clipIndex);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.storyClip.findMany({
      where: { episodeId },
      select: {
        id: true,
        clipIndex: true,
        content: true,
        screenplay: true,
      },
    });
    const existingByIndex = new Map(
      existing.map((clip) => [clip.clipIndex, clip]),
    );
    await tx.storyShot.deleteMany({ where: { episodeId } });
    if (!ordered.length) {
      await tx.storyClip.deleteMany({ where: { episodeId } });
      return;
    }
    await tx.storyClip.deleteMany({
      where: {
        episodeId,
        clipIndex: { notIn: ordered.map((clip) => clip.clipIndex) },
      },
    });
    for (const clip of ordered) {
      if (!clip.content.trim())
        throw new Error(`PRODUCTION_CLIP_CONTENT_REQUIRED:${clip.clipIndex}`);
      const previous = existingByIndex.get(clip.clipIndex);
      const explicitScreenplay = clip.screenplay !== undefined;
      const screenplay = explicitScreenplay
        ? clip.screenplay?.trim() || null
        : previous?.content === clip.content
          ? previous.screenplay
          : null;
      const shots = (clip.shots ?? []).map((shot) => ({
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
      }));
      const values = {
        projectId,
        episodeId,
        clipIndex: clip.clipIndex,
        summary: clip.summary.trim(),
        content: clip.content,
        startText: clip.startText?.length ? clip.startText : null,
        endText: clip.endText?.length ? clip.endText : null,
        screenplay,
        charactersJson: stringifyArray(clip.characters),
        locationsJson: stringifyArray(clip.locations),
        propsJson: stringifyArray(clip.props),
        shotCount: clip.shotCount ?? clip.shots?.length ?? null,
        status:
          clip.status?.trim() ||
          (screenplay ? "screenplay_ready" : "split_ready"),
      };
      await tx.storyClip.upsert({
        where: { episodeId_clipIndex: { episodeId, clipIndex: clip.clipIndex } },
        create: {
          id: previous?.id ?? randomUUID(),
          ...values,
          shots: shots.length ? { create: shots } : undefined,
        },
        update: {
          ...values,
          shots: shots.length ? { create: shots } : undefined,
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
  const [props, clips, voiceLines, audioTracks, editorProject] =
    await Promise.all([
    listProductionProps(userId, projectId),
    listProductionClips(userId, projectId, episodeId),
    listVoiceLines(userId, projectId, episodeId),
    listEpisodeAudioTracks(userId, projectId, episodeId),
    getEditorProject(userId, projectId, episodeId),
  ]);
  if (!props || !clips) return null;
  return { props, clips, voiceLines, audioTracks, editorProject };
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
    voiceProfilePrompt?: string | null;
    emotionPrompt?: string | null;
    emotionStrength?: number | null;
    optimizeInstructions?: boolean;
    delivery?: "dialogue" | "inner_monologue" | "voiceover";
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
          voiceProfilePrompt: line.voiceProfilePrompt?.trim() || null,
          emotionPrompt: line.emotionPrompt?.trim() || null,
          emotionStrength: finiteNumber(line.emotionStrength),
          optimizeInstructions: line.optimizeInstructions ?? true,
          delivery: line.delivery ?? "dialogue",
          matchedPanelId: line.matchedPanelId || null,
        })),
      });
    }
  });
  return listVoiceLines(userId, projectId, episodeId);
}

export async function updateVoiceLine(
  userId: string,
  projectId: string,
  episodeId: string,
  lineId: string,
  input: {
    content?: string;
    voiceProfilePrompt?: string | null;
    emotionPrompt?: string | null;
    emotionStrength?: number | null;
    optimizeInstructions?: boolean;
    delivery?: "dialogue" | "inner_monologue" | "voiceover";
    matchedPanelId?: string | null;
    speaker?: string;
    voicePresetId?: string | null;
  },
) {
  const line = await prisma.voiceLine.findFirst({
    where: {
      id: lineId,
      episodeId,
      episode: { projectId, project: { userId } },
    },
    select: { id: true },
  });
  if (!line) return null;

  if (input.voicePresetId) {
    const preset = await prisma.voicePreset.count({
      where: {
        id: input.voicePresetId,
        userId,
        OR: [{ projectId }, { projectId: null }],
      },
    });
    if (!preset) return null;
  }
  if (input.matchedPanelId) {
    const panel = await prisma.storyboardPanel.count({
      where: {
        id: input.matchedPanelId,
        storyboard: { projectId, episodeId, project: { userId } },
      },
    });
    if (!panel) return null;
  }

  const speaker = input.speaker?.trim();
  const content = input.content?.trim();
  if (input.speaker !== undefined && !speaker) {
    throw new Error("VOICE_LINE_SPEAKER_REQUIRED");
  }
  if (input.content !== undefined && !content) {
    throw new Error("VOICE_LINE_CONTENT_REQUIRED");
  }

  const updated = await prisma.voiceLine.update({
    where: { id: line.id },
    data: {
      ...(input.speaker !== undefined ? { speaker } : {}),
      ...(input.content !== undefined ? { content } : {}),
      ...(input.voicePresetId !== undefined
        ? { voicePresetId: input.voicePresetId || null }
        : {}),
      ...(input.voiceProfilePrompt !== undefined
        ? { voiceProfilePrompt: input.voiceProfilePrompt?.trim() || null }
        : {}),
      ...(input.emotionPrompt !== undefined
        ? { emotionPrompt: input.emotionPrompt?.trim() || null }
        : {}),
      ...(input.emotionStrength !== undefined
        ? { emotionStrength: finiteNumber(input.emotionStrength) }
        : {}),
      ...(input.optimizeInstructions !== undefined
        ? { optimizeInstructions: input.optimizeInstructions }
        : {}),
      ...(input.delivery !== undefined ? { delivery: input.delivery } : {}),
      ...(input.matchedPanelId !== undefined
        ? { matchedPanelId: input.matchedPanelId || null }
        : {}),
    },
  });
  return toVoiceLine(updated);
}

export async function listEpisodeAudioTracks(
  userId: string,
  projectId: string,
  episodeId: string,
) {
  const rows = await prisma.episodeAudioTrack.findMany({
    where: { episodeId, episode: { projectId, project: { userId } } },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    episodeId: row.episodeId,
    trackType: row.trackType,
    assetId: row.assetId,
    startSeconds: row.startSeconds,
    endSeconds: row.endSeconds,
    volume: row.volume,
    metadata: parseObject(row.metadataJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
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
      renderStatus: "draft",
      renderTaskId: null,
      outputAssetId: null,
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
  const [storyboard, clips] = await Promise.all([
    prisma.storyboard.findFirst({
      where: { projectId, episodeId, project: { userId } },
      select: {
        panels: {
          orderBy: { panelIndex: "asc" },
          select: {
            id: true,
            clipId: true,
            panelIndex: true,
            durationSeconds: true,
            imageAssetId: true,
            videoAssetId: true,
            lipSyncAssetId: true,
          },
        },
      },
    }),
    prisma.storyClip.findMany({
      where: { projectId, episodeId, project: { userId } },
      include: { shots: { orderBy: { shotIndex: "asc" } } },
      orderBy: { clipIndex: "asc" },
    }),
  ]);
  const panelTracks = storyboard?.panels.map((panel) => ({
    id: panel.id,
    clipId: panel.clipId,
    shotIndex: panel.panelIndex,
    duration: panel.durationSeconds,
    imageAssetId: panel.imageAssetId,
    videoAssetId: panel.videoAssetId,
    lipSyncAssetId: panel.lipSyncAssetId,
  }));
  const legacyTracks = clips.flatMap((clip) =>
    clip.shots.map((shot) => ({
      id: shot.id,
      clipId: clip.id,
      shotIndex: shot.shotIndex,
      duration: shot.durationSeconds,
      imageAssetId: shot.imageAssetId,
      videoAssetId: shot.videoAssetId,
      lipSyncAssetId: null,
    })),
  );
  const timeline = buildSequentialTimeline(
    panelTracks?.length ? panelTracks : legacyTracks,
  );
  if (!timeline.tracks.length) return null;
  const voiceLines = await prisma.voiceLine.findMany({
    where: { episodeId, episode: { projectId, project: { userId } } },
    orderBy: { lineIndex: "asc" },
  });
  const subtitles = buildTimelineSubtitles(voiceLines, timeline.tracks);
  return saveEditorProject(
    userId,
    projectId,
    episodeId,
    timeline,
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
  voiceProfilePrompt: string | null;
  emotionPrompt: string | null;
  emotionStrength: number | null;
  optimizeInstructions: boolean;
  delivery: string;
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
    voiceProfilePrompt: row.voiceProfilePrompt,
    emotionPrompt: row.emotionPrompt,
    emotionStrength: row.emotionStrength,
    optimizeInstructions: row.optimizeInstructions,
    delivery: row.delivery,
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
