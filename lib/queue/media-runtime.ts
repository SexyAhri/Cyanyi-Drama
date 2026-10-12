import { linkCanvasGeneratedImage } from "@/lib/media/canvas-asset-links";
import { assertEpisodeTimelineCurrent } from "@/lib/production/timeline-source-state";
import { decryptSecret } from "@/lib/server/crypto";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import type { MediaAsset, MediaTaskKind } from "@/lib/media/task-contract";
import { storeGeneratedMediaAsset } from "@/lib/media/generated-media-storage";
import {
  resolveStoredMediaInput,
} from "@/lib/storage";
import {
  compactMediaTaskOutput,
  compactMediaTaskRequest,
  mediaAssetContentUrl,
} from "@/lib/media/public-media";
import {
  composeAudioTimeline,
  probeAudioUrlDuration,
} from "@/lib/providers/local/ffmpeg-audio";
import { planPanelDialogue } from "@/lib/media/dialogue-timeline";
import { sanitizeMediaProviderRequest } from "@/lib/media/provider-prompt-safety";
import { resolveStoredReferenceImages } from "@/lib/media/reference-inputs";
import { renderTimelineVideo } from "@/lib/providers/local/ffmpeg-render";
import { normalizeRenderSpecification } from "@/lib/providers/local/render-spec";
import {
  buildTimelineSubtitles,
  parseTimelineSequence,
} from "@/lib/production/timeline";
import { assertMediaTaskOutputBehavior } from "@/lib/quality/behavior-guards";
import {
  parseOpenAiCompatibleMediaTemplate,
  type OpenAiCompatibleMediaTemplate,
} from "@/lib/providers/openai-compatible-media-template";
import {
  generateProviderLipSync,
  generateProviderMedia,
  isMediaChannelProtocol,
} from "@/lib/providers/media/registry";
import type { MediaProviderRequest as TaskRequest } from "@/lib/providers/media/types";

export async function processQueuedMediaTask(taskId: string, userId: string) {
  const task = await prisma.mediaTask.findFirst({
    where: { id: taskId, userId },
  });
  if (!task) throw new Error("MEDIA_TASK_NOT_FOUND");
  if (!task.channelId) throw new Error("MEDIA_TASK_CHANNEL_REQUIRED");
  if (task.cancelRequestedAt || task.status === "canceled") return false;

  const channel = await prisma.channel.findFirst({
    where: accessibleChannelWhere(userId, task.channelId),
  });
  if (!channel) throw new Error("MEDIA_TASK_CHANNEL_NOT_FOUND");
  const payload = task.payload as { request?: TaskRequest };
  const request = payload.request ?? {};
  const resolvedRequest = await resolveStoredReferenceImages(request, userId);
  const providerRequest = { ...resolvedRequest };
  delete (providerRequest as Record<string, unknown>).canvasAssetTargets;
  const outboundRequest = sanitizeMediaProviderRequest(
    providerRequest,
    task.kind === "video" ? "video" : task.kind === "audio" ? "audio" : "image",
  ).request;
  const operation =
    typeof (request as Record<string, unknown>).operation === "string"
      ? (request as Record<string, unknown>).operation
      : undefined;
  let output: MediaAsset[] | undefined;
  if (operation === "merge_episode_audio") {
    output = await mergeEpisodeAudio(task.episodeId, task.projectId, userId);
  }
  if (operation === "lip_sync") {
    output = await performLipSync(
      task.episodeId,
      task.projectId,
      task.targetId,
      task.model,
      channel,
      request,
      userId,
    );
  }
  if (operation === "render_timeline") {
    output = await renderEpisodeTimeline(
      task.episodeId,
      task.projectId,
      userId,
      request,
    );
  }
  const mediaTemplate =
    !output &&
    channel.protocol === "openai-compatible" &&
    (task.kind === "image" || task.kind === "video")
      ? await findMediaTemplate(task.channelId, task.model, task.kind)
      : undefined;
  const keys = output
    ? []
    : (JSON.parse(decryptSecret(channel.encryptedApiKeys)) as string[]);
  const apiKeys = [...new Set(keys.map((key) => key?.trim()).filter(Boolean))].slice(
    0,
    1,
  );
  if (!apiKeys.length && !output) throw new Error("MEDIA_TASK_API_KEY_MISSING");
  const mediaProtocol = isMediaChannelProtocol(channel.protocol)
    ? channel.protocol
    : null;
  if (!output && !mediaProtocol)
    throw new Error(`MEDIA_PROTOCOL_NOT_SUPPORTED:${channel.protocol}`);
  let lastError: unknown;
  for (const apiKey of apiKeys) {
    try {
      output =
        output ??
        (task.kind === "image" || task.kind === "video" || task.kind === "audio"
          ? await generateProviderMedia({
              protocol: mediaProtocol!,
              providerKey: channel.providerKey,
              baseUrl: channel.baseUrl,
              apiKey,
              model: task.model,
              mediaTaskId: task.id,
              kind: task.kind,
              request: outboundRequest,
              mediaTemplate,
            })
          : (() => {
              throw new Error(
                `MEDIA_WORKER_HANDLER_NOT_IMPLEMENTED:${task.kind}`,
              );
            })());
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!output) {
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? "MEDIA_PROVIDER_FAILED"));
  }
  const stripProviderAudio = shouldStripProviderVideoAudio({
    kind: task.kind,
    targetType: task.targetType,
    request,
  });
  if (stripProviderAudio)
    output = output.map((asset) =>
      asset.kind === "video"
        ? {
            ...asset,
            metadata: {
              ...(asset.metadata ?? {}),
              storedProviderAudio: "removed",
            },
          }
        : asset,
    );
  assertMediaTaskOutputBehavior({
    taskKind: task.kind as MediaTaskKind,
    output,
  });

  const latestTask = await prisma.mediaTask.findFirst({
    where: { id: task.id, userId, status: "running" },
  });
  if (!latestTask || latestTask.cancelRequestedAt) return false;

  const storedAssets = await Promise.all(
    output.map(async (asset) => {
      const storageKey = `projects/${task.projectId ?? "global"}/media/${asset.kind}/${asset.id}.${mediaAssetExtension(asset)}`;
      let storedKey: string | null = null;
      try {
        storedKey = await storeGeneratedMediaAsset({
          asset,
          storageKey,
          stripVideoAudio: stripProviderAudio,
        });
      } catch (error) {
        if (stripProviderAudio || isSourceMediaDownloadFailure(error))
          throw error;
      }
      return {
        id: asset.id,
        kind: asset.kind,
        storageKey: storedKey,
        url: storedKey ? mediaAssetContentUrl(asset.id) : asset.url,
        mimeType: asset.mimeType,
        metadataJson: JSON.stringify(mediaAssetMetadata(asset)),
      };
    }),
  );
  await prisma.mediaTask.update({
    where: { id: task.id },
    data: {
      status: "succeeded",
      progress: 100,
      progressMessage: null,
      payload: JSON.parse(
        JSON.stringify({
          request: compactMediaTaskRequest(request),
          output: compactMediaTaskOutput(output),
        }),
      ),
      error: Prisma.DbNull,
      completedAt: new Date(),
      updatedAt: new Date(),
      assets: {
        createMany: {
          data: storedAssets,
        },
      },
    },
  });
  await linkGeneratedAsset(task, userId, output[0], request);
  if (task.targetType === "canvas_node" && task.kind === "image" && task.projectId) {
    for (const asset of output.slice(1))
      await linkCanvasGeneratedImage(task, userId, task.projectId, asset, request);
  }
  await prisma.mediaTaskEvent.create({
    data: {
      taskId: task.id,
      type: "succeeded",
      status: "succeeded",
      progress: 100,
    },
  });
  return true;
}

export function isSourceMediaDownloadFailure(error: unknown) {
  return (
    error instanceof Error &&
    (/^MEDIA_DOWNLOAD_FAILED:\d{3}/.test(error.message) ||
      /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|socket hang up/i.test(
        error.message,
      ))
  );
}

export function mediaAssetExtension(
  asset: Pick<MediaAsset, "kind" | "mimeType" | "url">,
) {
  const mimeType = asset.mimeType?.split(";")[0]?.trim().toLowerCase();
  const byMime: Record<string, string> = {
    "audio/flac": "flac",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/webm": "webm",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  if (mimeType && byMime[mimeType]) return byMime[mimeType];
  try {
    const extension = new URL(asset.url).pathname
      .match(/\.([a-z0-9]{2,5})$/i)?.[1]
      ?.toLowerCase();
    if (extension) return extension;
  } catch {
    // Data URLs and malformed provider URLs fall through to the kind default.
  }
  return asset.kind === "video" ? "mp4" : asset.kind === "audio" ? "mp3" : "png";
}

export function mediaAssetMetadata(
  asset: Pick<MediaAsset, "metadata" | "url">,
) {
  return {
    ...(asset.metadata ?? {}),
    ...(!asset.url.startsWith("data:") ? { originalUrl: asset.url } : {}),
  };
}

async function findMediaTemplate(
  channelId: string,
  model: string,
  kind: "image" | "video",
): Promise<OpenAiCompatibleMediaTemplate | undefined> {
  const configured = await prisma.providerModel.findFirst({
    where: { channelId, modelId: model, selected: true },
    select: { capabilitiesJson: true },
  });
  if (!configured) return undefined;
  try {
    const capabilities: unknown = JSON.parse(configured.capabilitiesJson);
    if (
      !capabilities ||
      typeof capabilities !== "object" ||
      Array.isArray(capabilities)
    )
      return undefined;
    const template = (capabilities as Record<string, unknown>).mediaTemplate;
    return template === undefined
      ? undefined
      : parseOpenAiCompatibleMediaTemplate(template, kind);
  } catch (error) {
    throw new Error(
      `OPENAI_COMPAT_MEDIA_TEMPLATE_INVALID:${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function mergeEpisodeAudio(
  episodeId: string | null,
  projectId: string | null,
  userId: string,
) {
  if (!episodeId || !projectId) throw new Error("AUDIO_MERGE_EPISODE_REQUIRED");
  const [panels, voiceLines] = await Promise.all([
    prisma.storyboardPanel.findMany({
      where: {
        storyboard: { episodeId, projectId, project: { userId } },
      },
      orderBy: { panelIndex: "asc" },
      select: {
        id: true,
        durationSeconds: true,
        voiceLines: {
          orderBy: { lineIndex: "asc" },
          select: {
            id: true,
            lineIndex: true,
            durationSeconds: true,
            audioAsset: {
              select: { url: true, storageKey: true, mimeType: true },
            },
          },
        },
      },
    }),
    prisma.voiceLine.findMany({
      where: { episodeId, episode: { projectId, project: { userId } } },
      orderBy: { lineIndex: "asc" },
      select: { id: true, lineIndex: true, matchedPanelId: true },
    }),
  ]);
  if (!panels.length) throw new Error("AUDIO_MERGE_PANELS_EMPTY");
  assertVoiceLinePanelCoverage({
    panelIds: panels.map((panel) => panel.id),
    lines: voiceLines,
  });
  const clips: Array<{
    url: string;
    startSeconds: number;
    durationSeconds: number;
    playbackRate?: number;
  }> = [];
  let timelineCursor = 0;
  let lineCount = 0;
  for (const panel of panels) {
    const resolvedLines: Array<{
      id: string;
      durationSeconds: number;
      url: string;
    }> = [];
    for (const line of panel.voiceLines) {
      const url =
        line.audioAsset?.storageKey
          ? await resolveStoredMediaInput(
              line.audioAsset.storageKey,
              line.audioAsset.mimeType,
            )
          : line.audioAsset?.url;
      if (!url) throw new Error(`AUDIO_MERGE_INPUT_MISSING:${line.lineIndex}`);
      const durationSeconds =
        line.durationSeconds ?? (await probeAudioUrlDuration(url));
      resolvedLines.push({ id: line.id, durationSeconds, url });
      if (line.durationSeconds === null)
        await prisma.voiceLine.update({
          where: { id: line.id },
          data: { durationSeconds },
        });
    }
    const plan = planPanelDialogue({
      lineDurations: resolvedLines.map((line) => line.durationSeconds),
      requestedDurationSeconds: panel.durationSeconds ?? 1,
    });
    resolvedLines.forEach((line, index) => {
      clips.push({
        url: line.url,
        startSeconds: timelineCursor + plan.timings[index].startSeconds,
        durationSeconds: plan.timings[index].durationSeconds,
        playbackRate: plan.playbackRate,
      });
    });
    if (panel.durationSeconds !== plan.durationSeconds)
      await prisma.storyboardPanel.update({
        where: { id: panel.id },
        data: { durationSeconds: plan.durationSeconds },
      });
    lineCount += resolvedLines.length;
    timelineCursor += plan.durationSeconds;
  }
  if (!clips.length) throw new Error("AUDIO_MERGE_LINES_EMPTY");
  const url = await composeAudioTimeline(clips, timelineCursor);
  return [
    {
      id: `audio-merged-${crypto.randomUUID()}`,
      kind: "audio" as const,
      url,
      mimeType: "audio/mpeg",
      metadata: {
        operation: "merge_episode_audio",
        lineCount,
        durationSeconds: timelineCursor,
        alignedToStoryboard: true,
      },
    },
  ];
}

async function resolveAssetUrl(
  asset:
    | { url: string | null; storageKey: string | null; mimeType?: string | null }
    | null
    | undefined,
) {
  if (!asset) return null;
  if (asset.storageKey)
    return resolveStoredMediaInput(asset.storageKey, asset.mimeType);
  if (asset.url) return asset.url;
  return null;
}

function storedAssetSource(
  asset:
    | {
        url: string | null;
        storageKey: string | null;
      }
    | null
    | undefined,
) {
  if (asset?.storageKey)
    return { storageKey: asset.storageKey };
  if (asset?.url) return { url: asset.url };
  return null;
}

async function performLipSync(
  episodeId: string | null,
  projectId: string | null,
  targetId: string | null,
  model: string,
  channel: {
    baseUrl: string;
    protocol: string;
    providerKey: string;
    encryptedApiKeys: string;
  },
  request: TaskRequest,
  userId: string,
): Promise<MediaAsset[]> {
  const panelId =
    typeof (request as Record<string, unknown>).panelId === "string"
      ? ((request as Record<string, unknown>).panelId as string)
      : undefined;
  const resolvedPanelId = panelId ?? targetId;
  if (!resolvedPanelId) throw new Error("LIP_SYNC_PANEL_ID_REQUIRED");
  if (!projectId) throw new Error("LIP_SYNC_PROJECT_REQUIRED");

  const panel = await prisma.storyboardPanel.findFirst({
    where: {
      id: resolvedPanelId,
      storyboard: { projectId, project: { userId } },
    },
    select: {
      id: true,
      speakingCharacter: true,
      lipSyncText: true,
      charactersJson: true,
      imageAsset: { select: { url: true, storageKey: true } },
      videoAsset: { select: { url: true, storageKey: true } },
      lipSyncAsset: { select: { url: true, storageKey: true } },
      videoSegments: { select: { videoAsset: { select: { url: true, storageKey: true } } } },
    },
  });
  if (!panel) throw new Error("LIP_SYNC_PANEL_NOT_FOUND");

  if (panel.videoSegments.length > 1) throw new Error("LIP_SYNC_SEGMENTED_VIDEO_UNSUPPORTED");
  const videoUrl =
    (await resolveAssetUrl(panel.videoSegments[0]?.videoAsset)) ??
    (await resolveAssetUrl(panel.videoAsset)) ??
    (await resolveAssetUrl(panel.lipSyncAsset));
  const imageUrl = await resolveAssetUrl(panel.imageAsset);

  const audioAssetId =
    typeof (request as Record<string, unknown>).audioAssetId === "string"
      ? ((request as Record<string, unknown>).audioAssetId as string)
      : undefined;

  const voiceLineId = stringField(request, "voiceLineId");
  if (!voiceLineId || !episodeId || !audioAssetId)
    throw new Error("LIP_SYNC_VOICE_LINE_REQUIRED");
  const voiceLine = await prisma.voiceLine.findFirst({
    where: {
      id: voiceLineId,
      episodeId,
      matchedPanelId: resolvedPanelId,
      audioAssetId,
      delivery: "dialogue",
      episode: { projectId, project: { userId } },
    },
    select: {
      speaker: true,
      content: true,
      durationSeconds: true,
      audioAsset: { select: { url: true, storageKey: true } },
    },
  });
  if (!voiceLine) throw new Error("LIP_SYNC_VOICE_LINE_MISMATCH");
  const characters = parseJsonValue(panel.charactersJson);
  if (panel.speakingCharacter !== voiceLine.speaker ||
      panel.lipSyncText?.trim() !== voiceLine.content.trim() ||
      !Array.isArray(characters) || !characters.includes(voiceLine.speaker))
    throw new Error("LIP_SYNC_SPEAKER_NOT_VISIBLE");
  const audioUrl = await resolveAssetUrl(voiceLine.audioAsset);
  const durationSeconds = voiceLine.durationSeconds ?? undefined;
  if (!audioUrl) throw new Error("LIP_SYNC_AUDIO_MISSING");

  const keys = JSON.parse(decryptSecret(channel.encryptedApiKeys)) as string[];
  const apiKey = keys.find((key) => key?.trim())?.trim();
  if (!apiKey) throw new Error("MEDIA_TASK_API_KEY_MISSING");
  if (!isMediaChannelProtocol(channel.protocol))
    throw new Error(`LIP_SYNC_PROTOCOL_NOT_SUPPORTED:${channel.protocol}`);
  return generateProviderLipSync({
    protocol: channel.protocol,
    providerKey: channel.providerKey,
    baseUrl: channel.baseUrl,
    apiKey,
    model,
    videoUrl: videoUrl ?? undefined,
    imageUrl: imageUrl ?? undefined,
    audioUrl,
    durationSeconds,
  });
}

async function renderEpisodeTimeline(
  episodeId: string | null,
  projectId: string | null,
  userId: string,
  request: TaskRequest,
): Promise<MediaAsset[]> {
  if (!episodeId || !projectId)
    throw new Error("TIMELINE_RENDER_EPISODE_REQUIRED");
  await assertEpisodeTimelineCurrent(userId, projectId, episodeId);

  const [storyboard, editorProject, voiceLines, episodeAudioTracks] =
    await Promise.all([
      prisma.storyboard.findFirst({
        where: { projectId, episodeId, project: { userId } },
        select: {
          panels: {
            orderBy: { panelIndex: "asc" },
            select: {
              id: true,
              panelIndex: true,
              imageAsset: { select: { url: true, storageKey: true } },
              videoAsset: { select: { url: true, storageKey: true } },
              lipSyncAsset: { select: { url: true, storageKey: true } },
              videoSegments: {
                select: {
                  id: true,
                  videoAsset: { select: { url: true, storageKey: true } },
                },
              },
            },
          },
        },
      }),
      prisma.editorProject.findFirst({
        where: {
          episodeId,
          episode: { projectId, project: { userId } },
        },
        select: { timelineJson: true },
      }),
      prisma.voiceLine.findMany({
        where: { episodeId, episode: { projectId, project: { userId } } },
        orderBy: { lineIndex: "asc" },
        select: {
          id: true,
          lineIndex: true,
          speaker: true,
          content: true,
          matchedPanelId: true,
          durationSeconds: true,
        },
      }),
      prisma.episodeAudioTrack.findMany({
        where: {
          episodeId,
          trackType: { in: ["merged", "ambience", "sfx", "music"] },
          episode: { projectId, project: { userId } },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          trackType: true,
          startSeconds: true,
          endSeconds: true,
          volume: true,
          metadataJson: true,
          asset: { select: { url: true, storageKey: true } },
        },
      }),
    ]);
  if (!storyboard) throw new Error("TIMELINE_RENDER_STORYBOARD_NOT_FOUND");
  const sequence = parseTimelineSequence(
    parseJsonValue(editorProject?.timelineJson),
  );
  const panels = new Map(storyboard.panels.map((panel) => [panel.id, panel]));
  const videoSegments = new Map(
    storyboard.panels.flatMap((panel) =>
      panel.videoSegments.map((segment) => [
        segment.id,
        { panel, videoAsset: segment.videoAsset },
      ] as const),
    ),
  );
  if (!sequence.length) throw new Error("TIMELINE_RENDER_TRACKS_INVALID");
  assertTimelineSubtitleCoverage({
    timelinePanelIds: sequence.map((track) => track.panelId ?? track.id),
    lines: voiceLines,
  });
  const resolvedTracks: Array<{
    track: (typeof sequence)[number];
    panel: (typeof storyboard.panels)[number];
    source: ReturnType<typeof storedAssetSource>;
    isImage: boolean;
  }> = [];
  for (const track of sequence) {
    const trackPanelId = track.panelId ?? track.id;
    const isSegmentTrack = track.id !== trackPanelId;
    const segment = videoSegments.get(track.id);
    if (
      isSegmentTrack &&
      (!segment || segment.panel.id !== trackPanelId)
    ) continue;
    const panel = segment?.panel ?? panels.get(trackPanelId);
    if (!panel) continue;
    const lipSyncSource =
      segment && panel.videoSegments.length > 1
        ? undefined
        : storedAssetSource(panel.lipSyncAsset);
    const videoSource = segment
      ? storedAssetSource(segment.videoAsset)
      : lipSyncSource
        ? undefined
        : storedAssetSource(panel.videoAsset);
    const imageSource =
      lipSyncSource || videoSource
        ? undefined
        : storedAssetSource(panel.imageAsset);
    const source = lipSyncSource ?? videoSource ?? imageSource ?? null;
    resolvedTracks.push({ track, panel, source, isImage: !!imageSource });
  }
  assertTimelineRenderCoverage({
    sequenceIds: sequence.map((track) => track.id),
    panelMedia: resolvedTracks.map(({ track, panel, source }) => ({
      id: track.id,
      panelIndex: panel.panelIndex,
      url: source?.storageKey ?? source?.url ?? null,
    })),
  });
  const segments = resolvedTracks.map(({ track, panel, source, isImage }) => ({
    ...source!,
    panelIndex: panel.panelIndex,
    kind: isImage ? ("image" as const) : ("video" as const),
    durationSeconds: track.duration,
    sourceStartSeconds: track.sourceStart,
    volume: track.volume,
    transition: track.transition,
    transitionDurationSeconds: track.transitionDuration,
  }));

  const renderAudioTracks = episodeAudioTracks.map((track) => {
    const source = storedAssetSource(track.asset);
    if (!source)
      throw new Error(`TIMELINE_RENDER_AUDIO_TRACK_MISSING:${track.id}`);
    const metadata = parseJsonValue(track.metadataJson);
    const loop =
      !!metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      (metadata as Record<string, unknown>).loop === true;
    return {
      ...source,
      kind:
        track.trackType === "merged"
          ? ("dialogue" as const)
          : (track.trackType as "ambience" | "sfx" | "music"),
      startSeconds: track.startSeconds ?? 0,
      endSeconds: track.endSeconds,
      volume: track.volume ?? 1,
      loop,
    };
  });
  const dialogueSource = renderAudioTracks.find(
    (track) => track.kind === "dialogue",
  );
  assertTimelineDialogueAudioCoverage(
    voiceLines.length,
    dialogueSource?.storageKey ?? dialogueSource?.url,
  );

  const subtitles = buildTimelineSubtitles(voiceLines, sequence);

  const specification = normalizeRenderSpecification(
    request as Record<string, unknown>,
  );
  const rendered = await renderTimelineVideo({
    segments,
    audioTracks: renderAudioTracks,
    subtitles,
    specification,
  });
  return [
    {
      id: `render-${episodeId}-${Date.now()}`,
      kind: "video" as const,
      url: rendered.dataUrl,
      mimeType: "video/mp4",
      metadata: {
        operation: "render_timeline",
        panelCount: segments.length,
        imagePanelCount: segments.filter((segment) => segment.kind === "image")
          .length,
        hasAudio: renderAudioTracks.length > 0,
        audioTrackCount: renderAudioTracks.length,
        subtitleCount: subtitles.length,
        specification: rendered.specification,
      },
    },
  ];
}

export function shouldStripProviderVideoAudio(input: {
  kind: string;
  targetType: string | null;
  request: TaskRequest;
}) {
  return (
    input.kind === "video" &&
    input.targetType === "storyboard_panel"
  );
}

export function assertTimelineRenderCoverage(input: {
  sequenceIds: readonly string[];
  panelMedia: readonly {
    id: string;
    panelIndex: number;
    url: string | null;
  }[];
}) {
  const mediaById = new Map(input.panelMedia.map((panel) => [panel.id, panel]));
  const missingTracks = input.sequenceIds.filter((id) => !mediaById.has(id));
  if (missingTracks.length)
    throw new Error(
      `TIMELINE_RENDER_TRACK_PANEL_MISSING:${missingTracks.join(",")}`,
    );
  const missingMedia = input.sequenceIds.flatMap((id) => {
    const panel = mediaById.get(id);
    return panel && !panel.url ? [panel.panelIndex] : [];
  });
  if (missingMedia.length)
    throw new Error(
      `TIMELINE_RENDER_PANEL_MEDIA_MISSING:${missingMedia.join(",")}`,
    );
}

export function assertTimelineSubtitleCoverage(input: {
  timelinePanelIds: readonly string[];
  lines: readonly {
    lineIndex: number;
    matchedPanelId: string | null;
  }[];
}) {
  const panelIds = new Set(input.timelinePanelIds);
  const missing = input.lines.flatMap((line) =>
    line.matchedPanelId && panelIds.has(line.matchedPanelId)
      ? []
      : [line.lineIndex],
  );
  if (missing.length)
    throw new Error(
      `TIMELINE_RENDER_SUBTITLE_PANEL_MISSING:${missing.join(",")}`,
    );
}

export function assertVoiceLinePanelCoverage(input: {
  panelIds: readonly string[];
  lines: readonly {
    id: string;
    lineIndex: number;
    matchedPanelId: string | null;
  }[];
}) {
  const panelIds = new Set(input.panelIds);
  const unmatched = input.lines.flatMap((line) =>
    line.matchedPanelId && panelIds.has(line.matchedPanelId)
      ? []
      : [line.lineIndex],
  );
  if (unmatched.length)
    throw new Error(`AUDIO_MERGE_LINE_PANEL_MISSING:${unmatched.join(",")}`);
}

export function assertTimelineDialogueAudioCoverage(
  voiceLineCount: number,
  audioUrl: string | undefined,
) {
  if (voiceLineCount > 0 && !audioUrl)
    throw new Error("TIMELINE_RENDER_DIALOGUE_AUDIO_MISSING");
}

function parseJsonValue(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function stringField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field.trim() : "";
}

function numberField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" && Number.isFinite(field)
    ? field
    : undefined;
}

async function linkGeneratedAsset(
  task: {
    id: string;
    projectId: string | null;
    episodeId: string | null;
    targetType: string | null;
    targetId: string | null;
    kind: string;
  },
  userId: string,
  asset: MediaAsset | undefined,
  request: TaskRequest,
) {
  if (!asset || !task.targetId || !task.targetType) return;
  if (task.targetType === "global_character_appearance") {
    await prisma.globalCharacterAppearance.updateMany({
      where: { id: task.targetId, character: { userId } },
      data: {
        imageAssetId: asset.id,
        imageUrl: asset.url,
        selectedIndex: 0,
        updatedAt: new Date(),
      },
    });
    return;
  }
  if (task.targetType === "global_location_image") {
    const image = await prisma.globalLocationImage.findFirst({
      where: { id: task.targetId, location: { userId } },
    });
    if (!image) return;
    await prisma.$transaction([
      prisma.globalLocationImage.updateMany({
        where: { locationId: image.locationId },
        data: { isSelected: false },
      }),
      prisma.globalLocationImage.update({
        where: { id: image.id },
        data: {
          imageAssetId: asset.id,
          imageUrl: asset.url,
          isSelected: true,
          updatedAt: new Date(),
        },
      }),
    ]);
    return;
  }
  const projectId = task.projectId;
  if (!projectId) return;
  if (task.targetType === "canvas_node" && task.kind === "image") {
    await linkCanvasGeneratedImage(task, userId, projectId, asset, request);
    return;
  }
  if (task.targetType === "character_appearance") {
    const appearance = await prisma.characterAppearance.findFirst({
      where: {
        id: task.targetId,
        character: { projectId, project: { userId } },
      },
      select: { id: true, characterId: true },
    });
    if (!appearance) return;
    await prisma.$transaction(async (tx) => {
      await tx.characterAppearance.updateMany({
        where: { characterId: appearance.characterId },
        data: { selected: false },
      });
      await tx.characterAppearance.update({
        where: { id: appearance.id },
        data: { imageAssetId: asset.id, selected: true, updatedAt: new Date() },
      });
    });
  } else if (task.targetType === "location_image") {
    const image = await prisma.locationImage.findFirst({
      where: {
        id: task.targetId,
        location: { projectId, project: { userId } },
      },
      select: { id: true, locationId: true },
    });
    if (!image) return;
    await prisma.$transaction(async (tx) => {
      await tx.locationImage.updateMany({
        where: { locationId: image.locationId },
        data: { selected: false },
      });
      await tx.locationImage.update({
        where: { id: image.id },
        data: { imageAssetId: asset.id, selected: true, updatedAt: new Date() },
      });
      await tx.novelLocation.update({
        where: { id: image.locationId },
        data: { selectedImageId: image.id },
      });
    });
  } else if (task.targetType === "prop") {
    const prop = await prisma.novelProp.findFirst({
      where: {
        id: task.targetId,
        projectId,
        project: { userId },
      },
      select: { id: true },
    });
    if (!prop) return;
    await prisma.$transaction(async (tx) => {
      await tx.assetReference.upsert({
        where: {
          mediaAssetId_entityType_entityId_role: {
            mediaAssetId: asset.id,
            entityType: "prop",
            entityId: prop.id,
            role: "generated_candidate",
          },
        },
        create: {
          id: `${asset.id}_prop_candidate`,
          projectId,
          episodeId: task.episodeId,
          mediaAssetId: asset.id,
          entityType: "prop",
          entityId: prop.id,
          role: "generated_candidate",
        },
        update: {},
      });
      const selected = await tx.assetReference.findFirst({
        where: {
          projectId,
          entityType: "prop",
          entityId: prop.id,
          role: "selected",
        },
        select: { id: true },
      });
      if (!selected)
        await tx.assetReference.upsert({
          where: {
            mediaAssetId_entityType_entityId_role: {
              mediaAssetId: asset.id,
              entityType: "prop",
              entityId: prop.id,
              role: "selected",
            },
          },
          create: {
            id: `${asset.id}_prop_selected`,
            projectId,
            episodeId: task.episodeId,
            mediaAssetId: asset.id,
            entityType: "prop",
            entityId: prop.id,
            role: "selected",
          },
          update: {},
        });
    });
  } else if (task.targetType === "storyboard_panel") {
    if ((request as Record<string, unknown>).canvasDeferredSelection === true || (request as Record<string, unknown>).deferredSelection === true) return;
    const segmentId = stringField(request, "videoSegmentId");
    const segmentIndex = numberField(request, "videoSegmentIndex");
    if (task.kind === "video" && segmentId) {
      const updated = await prisma.storyboardVideoSegment.updateMany({
        where: {
          id: segmentId,
          taskId: task.id,
          panelId: task.targetId,
          panel: {
            storyboard: {
              projectId,
              episodeId: task.episodeId ?? undefined,
              project: { userId },
            },
          },
        },
        data: { videoAssetId: asset.id, updatedAt: new Date() },
      });
      if (updated.count && segmentIndex === 0)
        await prisma.storyboardPanel.update({
          where: { id: task.targetId },
          data: { videoAssetId: asset.id, updatedAt: new Date() },
        });
      return;
    }
    await prisma.storyboardPanel.updateMany({
      where: {
        id: task.targetId,
        storyboard: {
          projectId,
          episodeId: task.episodeId ?? undefined,
          project: { userId },
        },
      },
      data:
        task.kind === "video"
          ? { videoAssetId: asset.id, updatedAt: new Date() }
          : { imageAssetId: asset.id, updatedAt: new Date() },
    });
  } else if (task.targetType === "voice_line" && task.kind === "audio") {
    const line = await prisma.voiceLine.findFirst({
      where: { id: task.targetId, episode: { projectId, project: { userId } } },
      select: { matchedPanelId: true },
    });
    if (!line) return;
    await prisma.$transaction([
      prisma.voiceLine.updateMany({
        where: { id: task.targetId, episode: { projectId, project: { userId } } },
        data: {
          audioAssetId: asset.id,
          status: "generated",
          updatedAt: new Date(),
        },
      }),
      ...(line.matchedPanelId
        ? [prisma.storyboardPanel.updateMany({
            where: { id: line.matchedPanelId, storyboard: { projectId, project: { userId } } },
            data: { lipSyncAssetId: null, updatedAt: new Date() },
          })]
        : []),
    ]);
  } else if (
    task.targetType === "lip_sync" &&
    (task.kind === "video" || task.kind === "lipsync")
  ) {
    await prisma.storyboardPanel.updateMany({
      where: {
        id: task.targetId,
        storyboard: {
          projectId,
          episodeId: task.episodeId ?? undefined,
          project: { userId },
        },
      },
      data: { lipSyncAssetId: asset.id, updatedAt: new Date() },
    });
  } else if (task.targetType === "editor_render" && task.kind === "video") {
    await prisma.editorProject.updateMany({
      where: {
        episodeId: task.episodeId ?? "",
        renderTaskId: task.id,
        episode: { projectId, project: { userId } },
      },
      data: {
        outputAssetId: asset.id,
        renderStatus: "succeeded",
        updatedAt: new Date(),
      },
    });
  } else if (task.targetType === "episode_audio" && task.kind === "audio") {
    await prisma.$transaction([
      prisma.episodeAudioTrack.deleteMany({
        where: {
          episodeId: task.episodeId ?? task.targetId,
          trackType: "merged",
        },
      }),
      prisma.episodeAudioTrack.create({
        data: {
          id: `${task.id}_track`,
          episodeId: task.episodeId ?? task.targetId,
          trackType: "merged",
          assetId: asset.id,
        },
      }),
    ]);
  } else {
    return;
  }
  await prisma.assetReference
    .create({
      data: {
        id: `${task.id}_reference`,
        projectId,
        episodeId: task.episodeId,
        mediaAssetId: asset.id,
        entityType: task.targetType,
        entityId: task.targetId,
        role:
          task.kind === "video"
            ? "generated_video"
            : task.kind === "audio"
              ? "generated_audio"
              : "generated",
      },
    })
    .catch(() => undefined);
}


export async function generateImage(
  baseUrl: string,
  protocol: string,
  apiKey: string,
  model: string,
  request: TaskRequest,
): Promise<MediaAsset[]> {
  if (!isMediaChannelProtocol(protocol))
    throw new Error(`MEDIA_PROTOCOL_NOT_SUPPORTED:${protocol}`);
  return generateProviderMedia({
    protocol,
    providerKey:
      protocol === "volcengine-ark"
        ? "volcengine-ark"
        : protocol === "autodl-comfyui"
          ? "autodl"
          : "custom",
    baseUrl,
    apiKey,
    model,
    kind: "image",
    request,
  });
}
