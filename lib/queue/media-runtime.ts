import { decryptSecret } from "@/lib/server/crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import type { MediaAsset, MediaTaskKind } from "@/lib/media/task-contract";
import {
  downloadAndStoreMedia,
  resolveStoredMediaInput,
  resolveStoredMediaUrl,
} from "@/lib/storage";
import {
  composeAudioTimeline,
  probeAudioUrlDuration,
} from "@/lib/providers/local/ffmpeg-audio";
import { planPanelDialogue } from "@/lib/media/dialogue-timeline";
import { sanitizeMediaProviderRequest } from "@/lib/media/provider-prompt-safety";
import { renderTimelineVideo } from "@/lib/providers/local/ffmpeg-render";
import { normalizeRenderSpecification } from "@/lib/providers/local/render-spec";
import { parseTimelineSequence } from "@/lib/production/timeline";
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
    where: { id: task.channelId, userId },
  });
  if (!channel) throw new Error("MEDIA_TASK_CHANNEL_NOT_FOUND");
  const payload = task.payload as { request?: TaskRequest };
  const request = payload.request ?? {};
  const outboundRequest = sanitizeMediaProviderRequest(
    request,
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
  const apiKeys = [...new Set(keys.map((key) => key?.trim()).filter(Boolean))];
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
  assertMediaTaskOutputBehavior({
    taskKind: task.kind as MediaTaskKind,
    output,
  });

  const latestTask = await prisma.mediaTask.findFirst({
    where: { id: task.id, userId, status: "running" },
  });
  if (!latestTask || latestTask.cancelRequestedAt) return false;

  await prisma.mediaTask.update({
    where: { id: task.id },
    data: {
      status: "succeeded",
      progress: 100,
      progressMessage: null,
      payload: JSON.parse(JSON.stringify({ request, output })),
      error: Prisma.DbNull,
      completedAt: new Date(),
      updatedAt: new Date(),
      assets: {
        createMany: {
          data: await Promise.all(
            output.map(async (asset) => {
              const storageKey = `projects/${task.projectId ?? "global"}/media/${asset.kind}/${asset.id}.${mediaAssetExtension(asset)}`;
              let storedKey: string | null = null;
              try {
                storedKey = await downloadAndStoreMedia(
                  asset.url,
                  storageKey,
                  asset.mimeType,
                );
              } catch (error) {
                if (isSourceMediaDownloadFailure(error)) throw error;
                storedKey = null;
              }
              return {
                id: asset.id,
                kind: asset.kind,
                storageKey: storedKey,
                url: storedKey
                  ? await resolveStoredMediaUrl(storedKey)
                  : asset.url,
                mimeType: asset.mimeType,
                metadataJson: JSON.stringify(mediaAssetMetadata(asset)),
              };
            }),
          ),
        },
      },
    },
  });
  await linkGeneratedAsset(task, userId, output[0]);
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
  const panels = await prisma.storyboardPanel.findMany({
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
  });
  if (!panels.length) throw new Error("AUDIO_MERGE_PANELS_EMPTY");
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
      imageAsset: { select: { url: true, storageKey: true } },
      videoAsset: { select: { url: true, storageKey: true } },
      lipSyncAsset: { select: { url: true, storageKey: true } },
    },
  });
  if (!panel) throw new Error("LIP_SYNC_PANEL_NOT_FOUND");

  const videoUrl =
    (await resolveAssetUrl(panel.videoAsset)) ??
    (await resolveAssetUrl(panel.lipSyncAsset));
  const imageUrl = await resolveAssetUrl(panel.imageAsset);

  const audioAssetId =
    typeof (request as Record<string, unknown>).audioAssetId === "string"
      ? ((request as Record<string, unknown>).audioAssetId as string)
      : undefined;

  let audioUrl: string | null = null;
  let durationSeconds: number | undefined;
  if (audioAssetId) {
    const asset = await prisma.mediaAsset.findFirst({
      where: { id: audioAssetId },
      select: { url: true, storageKey: true },
    });
    audioUrl = await resolveAssetUrl(asset);
  } else if (episodeId) {
    const voiceLine = await prisma.voiceLine.findFirst({
      where: { matchedPanelId: resolvedPanelId, episodeId },
      select: {
        durationSeconds: true,
        audioAsset: { select: { url: true, storageKey: true } },
      },
    });
    audioUrl = await resolveAssetUrl(voiceLine?.audioAsset);
    durationSeconds = voiceLine?.durationSeconds ?? undefined;
  }
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

  const [storyboard, editorProject] = await Promise.all([
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
  ]);
  if (!storyboard) throw new Error("TIMELINE_RENDER_STORYBOARD_NOT_FOUND");
  const sequence = parseTimelineSequence(
    parseJsonValue(editorProject?.timelineJson),
  );
  const panels = new Map(storyboard.panels.map((panel) => [panel.id, panel]));
  const renderTracks = sequence.flatMap((track) => {
    const panel = panels.get(track.id);
    return panel ? [{ ...track, panel }] : [];
  });
  if (!renderTracks.length) throw new Error("TIMELINE_RENDER_TRACKS_INVALID");

  const segments: Array<{
    url: string;
    panelIndex: number;
    kind: "image" | "video";
    durationSeconds?: number;
    sourceStartSeconds?: number;
    volume?: number;
    transition?: "cut" | "fade";
    transitionDurationSeconds?: number;
  }> = [];
  for (const track of renderTracks) {
    const { panel } = track;
    const lipSyncUrl = await resolveAssetUrl(panel.lipSyncAsset);
    const videoUrl = lipSyncUrl
      ? undefined
      : await resolveAssetUrl(panel.videoAsset);
    const imageUrl =
      lipSyncUrl || videoUrl
        ? undefined
        : await resolveAssetUrl(panel.imageAsset);
    const url = lipSyncUrl ?? videoUrl ?? imageUrl;
    if (url)
      segments.push({
        url,
        panelIndex: panel.panelIndex,
        kind: imageUrl ? "image" : "video",
        durationSeconds: track.duration,
        sourceStartSeconds: track.sourceStart,
        volume: track.volume,
        transition: track.transition,
        transitionDurationSeconds: track.transitionDuration,
      });
  }
  if (!segments.length) throw new Error("TIMELINE_RENDER_NO_MEDIA_PANELS");

  const audioTrack = await prisma.episodeAudioTrack.findFirst({
    where: { episodeId, trackType: "merged" },
    select: { asset: { select: { url: true, storageKey: true } } },
  });
  const audioUrl = (await resolveAssetUrl(audioTrack?.asset)) ?? undefined;

  const specification = normalizeRenderSpecification(
    request as Record<string, unknown>,
  );
  const rendered = await renderTimelineVideo({
    segments,
    audioUrl,
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
        hasAudio: !!audioUrl,
        specification: rendered.specification,
      },
    },
  ];
}

function parseJsonValue(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
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
    await prisma.voiceLine.updateMany({
      where: {
        id: task.targetId,
        episode: { projectId, project: { userId } },
      },
      data: {
        audioAssetId: asset.id,
        status: "generated",
        updatedAt: new Date(),
      },
    });
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
