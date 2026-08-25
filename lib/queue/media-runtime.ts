import { decryptSecret } from "@/lib/server/crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/server/prisma";
import type { MediaAsset } from "@/lib/media/task-contract";
import { downloadAndStoreMedia, resolveStoredMediaUrl } from "@/lib/storage";
import { mergeAudioUrls } from "@/lib/providers/local/ffmpeg-audio";
import { renderTimelineVideo } from "@/lib/providers/local/ffmpeg-render";
import { buildVideoProviderContract } from "@/lib/providers/video-contract";
import {
  generateSpecializedLipSync,
  supportsSpecializedLipSync,
} from "@/lib/providers/lipsync";

type TaskRequest = {
  prompt?: string;
  ratio?: string;
  resolution?: string;
  format?: string;
  style?: string;
  duration?: string;
  videoMode?: string;
  referenceImages?: Array<{
    url: string;
    mimeType?: string;
    role?: "reference_image" | "first_frame" | "last_frame";
  }>;
  voice?: string;
  input?: string;
  responseFormat?: string;
};

type ProviderState = { status?: string; url?: string; thumbnailUrl?: string };

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
    );
  }
  const keys = output
    ? []
    : (JSON.parse(decryptSecret(channel.encryptedApiKeys)) as string[]);
  const apiKeys = [...new Set(keys.map((key) => key?.trim()).filter(Boolean))];
  if (!apiKeys.length && !output) throw new Error("MEDIA_TASK_API_KEY_MISSING");
  let lastError: unknown;
  for (const apiKey of apiKeys) {
    try {
      output =
        output ??
        (task.kind === "image"
          ? await generateImage(
              channel.baseUrl,
              channel.protocol,
              apiKey,
              task.model,
              request,
            )
          : task.kind === "video"
            ? await generateVideo(
                channel.baseUrl,
                channel.protocol,
                apiKey,
                task.model,
                request,
              )
            : task.kind === "audio"
              ? await generateAudio(
                  channel.baseUrl,
                  channel.protocol,
                  apiKey,
                  task.model,
                  request,
                )
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
              const storageKey = `projects/${task.projectId ?? "global"}/media/${asset.kind}/${asset.id}.${asset.kind === "video" ? "mp4" : asset.kind === "audio" ? "mp3" : "png"}`;
              let storedKey: string | null = null;
              try {
                storedKey = await downloadAndStoreMedia(
                  asset.url,
                  storageKey,
                  asset.mimeType,
                );
              } catch {
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
                metadataJson: JSON.stringify({
                  ...(asset.metadata ?? {}),
                  originalUrl: asset.url,
                }),
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

async function mergeEpisodeAudio(
  episodeId: string | null,
  projectId: string | null,
  userId: string,
) {
  if (!episodeId || !projectId) throw new Error("AUDIO_MERGE_EPISODE_REQUIRED");
  const lines = await prisma.voiceLine.findMany({
    where: { episodeId, episode: { projectId, project: { userId } } },
    orderBy: { lineIndex: "asc" },
    select: {
      lineIndex: true,
      audioAsset: { select: { url: true, storageKey: true } },
    },
  });
  if (!lines.length) throw new Error("AUDIO_MERGE_LINES_EMPTY");
  const urls: string[] = [];
  for (const line of lines) {
    const url =
      line.audioAsset?.url ||
      (line.audioAsset?.storageKey
        ? await resolveStoredMediaUrl(line.audioAsset.storageKey)
        : null);
    if (!url) throw new Error(`AUDIO_MERGE_INPUT_MISSING:${line.lineIndex}`);
    urls.push(url);
  }
  const url = await mergeAudioUrls(urls);
  return [
    {
      id: `audio-merged-${crypto.randomUUID()}`,
      kind: "audio" as const,
      url,
      mimeType: "audio/mpeg",
      metadata: { operation: "merge_episode_audio", lineCount: lines.length },
    },
  ];
}

async function resolveAssetUrl(
  asset: { url: string | null; storageKey: string | null } | null | undefined,
) {
  if (!asset) return null;
  if (asset.url) return asset.url;
  if (asset.storageKey) return resolveStoredMediaUrl(asset.storageKey);
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
      videoAsset: { select: { url: true, storageKey: true } },
      lipSyncAsset: { select: { url: true, storageKey: true } },
    },
  });
  if (!panel) throw new Error("LIP_SYNC_PANEL_NOT_FOUND");

  const videoUrl =
    (await resolveAssetUrl(panel.videoAsset)) ??
    (await resolveAssetUrl(panel.lipSyncAsset));
  if (!videoUrl) throw new Error("LIP_SYNC_VIDEO_MISSING");

  const audioAssetId =
    typeof (request as Record<string, unknown>).audioAssetId === "string"
      ? ((request as Record<string, unknown>).audioAssetId as string)
      : undefined;

  let audioUrl: string | null = null;
  if (audioAssetId) {
    const asset = await prisma.mediaAsset.findFirst({
      where: { id: audioAssetId },
      select: { url: true, storageKey: true },
    });
    audioUrl = await resolveAssetUrl(asset);
  } else if (episodeId) {
    const voiceLine = await prisma.voiceLine.findFirst({
      where: { matchedPanelId: resolvedPanelId, episodeId },
      select: { audioAsset: { select: { url: true, storageKey: true } } },
    });
    audioUrl = await resolveAssetUrl(voiceLine?.audioAsset);
  }
  if (!audioUrl) throw new Error("LIP_SYNC_AUDIO_MISSING");

  const keys = JSON.parse(decryptSecret(channel.encryptedApiKeys)) as string[];
  const apiKey = keys.find((key) => key?.trim())?.trim();
  if (!apiKey) throw new Error("MEDIA_TASK_API_KEY_MISSING");

  if (supportsSpecializedLipSync(channel.providerKey)) {
    const result = await generateSpecializedLipSync({
      providerKey: channel.providerKey,
      baseUrl: channel.baseUrl,
      apiKey,
      model,
      videoUrl,
      audioUrl,
    });
    return [
      {
        id: `lipsync-${model}-${Date.now()}`,
        kind: "video",
        url: result.url,
        metadata: {
          model,
          provider: channel.providerKey,
          operation: "lip_sync",
          providerTaskId: result.providerTaskId,
        },
      },
    ];
  }

  const baseUrl = channel.baseUrl.replace(/\/+$/, "");
  const isArk = channel.protocol === "volcengine-ark";
  const submitPath = isArk ? "contents/generations/tasks" : "videos/lip-sync";
  const statusPath = isArk
    ? (taskId: string) =>
        `contents/generations/tasks/${encodeURIComponent(taskId)}`
    : (taskId: string) => `videos/${encodeURIComponent(taskId)}`;

  const body = isArk
    ? {
        model,
        input: { video_url: videoUrl, audio_url: audioUrl },
        parameters: { action: "lip-sync" },
      }
    : { model, video_url: videoUrl, audio_url: audioUrl };

  const response = await fetch(`${baseUrl}/${submitPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(isArk ? { "X-DashScope-Async": "enable" } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(providerMessage(payload, response.status));

  const initial = extractVideoState(payload);
  if (initial.url) {
    return [
      {
        id: `lipsync-${model}-${Date.now()}`,
        kind: "video" as const,
        url: initial.url,
        thumbnailUrl: initial.thumbnailUrl,
        metadata: { model, operation: "lip_sync" },
      },
    ];
  }
  if (!initial.taskId) throw new Error("LIP_SYNC_TASK_ID_MISSING");

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const statusResponse = await fetch(
      `${baseUrl}/${statusPath(initial.taskId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
    const statusPayload = await readJson(statusResponse);
    if (!statusResponse.ok) {
      throw new Error(providerMessage(statusPayload, statusResponse.status));
    }
    const state = extractVideoState(statusPayload);
    if (state.url) {
      return [
        {
          id: `lipsync-${model}-${Date.now()}`,
          kind: "video" as const,
          url: state.url,
          thumbnailUrl: state.thumbnailUrl,
          metadata: {
            model,
            operation: "lip_sync",
            providerTaskId: initial.taskId,
          },
        },
      ];
    }
    if (/failed|error|canceled/i.test(state.status ?? ""))
      throw new Error(`LIP_SYNC_PROVIDER_FAILED:${state.status}`);
  }
  throw new Error("LIP_SYNC_POLL_TIMEOUT");
}

async function renderEpisodeTimeline(
  episodeId: string | null,
  projectId: string | null,
  userId: string,
): Promise<MediaAsset[]> {
  if (!episodeId || !projectId)
    throw new Error("TIMELINE_RENDER_EPISODE_REQUIRED");

  const storyboard = await prisma.storyboard.findFirst({
    where: { projectId, episodeId, project: { userId } },
    select: {
      panels: {
        orderBy: { panelIndex: "asc" },
        select: {
          id: true,
          panelIndex: true,
          videoAsset: { select: { url: true, storageKey: true } },
          lipSyncAsset: { select: { url: true, storageKey: true } },
        },
      },
    },
  });
  if (!storyboard) throw new Error("TIMELINE_RENDER_STORYBOARD_NOT_FOUND");

  const segments: { url: string; panelIndex: number }[] = [];
  for (const panel of storyboard.panels) {
    const url =
      (await resolveAssetUrl(panel.lipSyncAsset)) ??
      (await resolveAssetUrl(panel.videoAsset));
    if (url) segments.push({ url, panelIndex: panel.panelIndex });
  }
  if (!segments.length) throw new Error("TIMELINE_RENDER_NO_VIDEO_PANELS");

  const audioTrack = await prisma.episodeAudioTrack.findFirst({
    where: { episodeId, trackType: "merged" },
    select: { asset: { select: { url: true, storageKey: true } } },
  });
  const audioUrl = (await resolveAssetUrl(audioTrack?.asset)) ?? undefined;

  const dataUrl = await renderTimelineVideo({ segments, audioUrl });
  return [
    {
      id: `render-${episodeId}-${Date.now()}`,
      kind: "video" as const,
      url: dataUrl,
      mimeType: "video/mp4",
      metadata: {
        operation: "render_timeline",
        panelCount: segments.length,
        hasAudio: !!audioUrl,
      },
    },
  ];
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
  if (!task.projectId) return;
  if (task.targetType === "character_appearance") {
    const appearance = await prisma.characterAppearance.findFirst({
      where: {
        id: task.targetId,
        character: { projectId: task.projectId, project: { userId } },
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
        location: { projectId: task.projectId, project: { userId } },
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
  } else if (task.targetType === "storyboard_panel") {
    await prisma.storyboardPanel.updateMany({
      where: {
        id: task.targetId,
        storyboard: {
          projectId: task.projectId,
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
        episode: { projectId: task.projectId, project: { userId } },
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
          projectId: task.projectId,
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
        episode: { projectId: task.projectId, project: { userId } },
      },
      data: {
        outputAssetId: asset.id,
        renderStatus: "succeeded",
        updatedAt: new Date(),
      },
    });
  } else if (task.targetType === "episode_audio" && task.kind === "audio") {
    await prisma.episodeAudioTrack
      .create({
        data: {
          id: `${task.id}_track`,
          episodeId: task.episodeId ?? task.targetId,
          trackType: "merged",
          assetId: asset.id,
        },
      })
      .catch(() => undefined);
  } else {
    return;
  }
  await prisma.assetReference
    .create({
      data: {
        id: `${task.id}_reference`,
        projectId: task.projectId,
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

async function generateImage(
  baseUrl: string,
  protocol: string,
  apiKey: string,
  model: string,
  request: TaskRequest,
): Promise<MediaAsset[]> {
  const endpoint =
    protocol === "openai-compatible"
      ? process.env.OPENAI_COMPATIBLE_IMAGE_GENERATION_PATH ||
        "images/generations"
      : "images/generations";
  const referenceImages = await resolveReferenceImages(
    request.referenceImages,
    protocol === "volcengine-ark",
  );
  const size = resolveImageSize(request.ratio, request.resolution);
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: request.prompt ?? "",
      ...(size ? { size } : {}),
      ...(protocol === "volcengine-ark"
        ? {
            aspect_ratio: request.ratio,
            watermark: false,
            sequential_image_generation: "disabled",
          }
        : {}),
      ...(referenceImages.length ? { image: referenceImages } : {}),
      response_format: "url",
    }),
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(providerMessage(payload, response.status));
  const urls = extractUrls(payload);
  if (!urls.length) throw new Error(`IMAGE_RESULT_MISSING:${protocol}`);
  return urls.map((url, index) => ({
    id: `${model}-${Date.now()}-${index}`,
    kind: "image",
    url,
    metadata: { model },
  }));
}

async function generateVideo(
  baseUrl: string,
  protocol: string,
  apiKey: string,
  model: string,
  request: TaskRequest,
): Promise<MediaAsset[]> {
  const isArk = protocol === "volcengine-ark";
  const referenceImages = await resolveVideoReferenceImages(
    request.referenceImages,
    isArk,
  );
  const { createPath, statusPath, body } = buildVideoProviderContract({
    protocol,
    model,
    request,
    references: referenceImages,
    createPath:
      protocol === "openai-compatible"
        ? process.env.OPENAI_COMPATIBLE_VIDEO_CREATE_PATH
        : undefined,
    statusPath:
      protocol === "openai-compatible"
        ? process.env.OPENAI_COMPATIBLE_VIDEO_STATUS_PATH
        : undefined,
  });
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/${createPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(providerMessage(payload, response.status));
  const initial = extractVideoState(payload);
  if (initial.url)
    return [
      {
        id: `${model}-${Date.now()}`,
        kind: "video",
        url: initial.url,
        thumbnailUrl: initial.thumbnailUrl,
        metadata: { model, protocol },
      },
    ];
  if (!initial.taskId) throw new Error("VIDEO_TASK_ID_MISSING");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const statusResponse = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/${statusPath(initial.taskId)}`,
      {
        method:
          protocol === "openai-compatible"
            ? process.env.OPENAI_COMPATIBLE_VIDEO_STATUS_METHOD || "GET"
            : "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );
    const statusPayload = await readJson(statusResponse);
    if (!statusResponse.ok) {
      throw new Error(providerMessage(statusPayload, statusResponse.status));
    }
    const state = extractVideoState(statusPayload);
    if (state.url)
      return [
        {
          id: `${model}-${Date.now()}`,
          kind: "video",
          url: state.url,
          thumbnailUrl: state.thumbnailUrl,
          metadata: { model, protocol, providerTaskId: initial.taskId },
        },
      ];
    if (/failed|error|canceled/i.test(state.status ?? ""))
      throw new Error(`VIDEO_PROVIDER_FAILED:${state.status}`);
  }
  throw new Error("VIDEO_POLL_TIMEOUT");
}

async function generateAudio(
  baseUrl: string,
  protocol: string,
  apiKey: string,
  model: string,
  request: TaskRequest,
): Promise<MediaAsset[]> {
  if (protocol !== "openai-compatible" && protocol !== "volcengine-ark") {
    throw new Error(`AUDIO_PROTOCOL_NOT_SUPPORTED:${protocol}`);
  }
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: request.input ?? request.prompt ?? "",
      voice: request.voice ?? "alloy",
      response_format: request.responseFormat ?? "mp3",
    }),
  });
  const contentType = response.headers.get("content-type") ?? "audio/mpeg";
  if (!response.ok) {
    const payload = await readJson(response);
    throw new Error(providerMessage(payload, response.status));
  }
  if (contentType.includes("json")) {
    const payload = await readJson(response);
    const url = extractAudioUrl(payload);
    if (!url) throw new Error("AUDIO_RESULT_MISSING");
    return [
      {
        id: `${model}-${Date.now()}`,
        kind: "audio",
        url,
        mimeType: "audio/mpeg",
        metadata: { model, protocol },
      },
    ];
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const dataUrl = `data:${contentType};base64,${bytes.toString("base64")}`;
  return [
    {
      id: `${model}-${Date.now()}`,
      kind: "audio",
      url: dataUrl,
      mimeType: contentType,
      metadata: { model, protocol },
    },
  ];
}

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

function providerMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    const error = value.error;
    if (typeof error === "string") return error;
    if (
      error &&
      typeof error === "object" &&
      typeof (error as Record<string, unknown>).message === "string"
    )
      return (error as Record<string, unknown>).message as string;
    if (typeof value.message === "string") return value.message;
  }
  return `Provider request failed (${status}).`;
}

function extractUrls(payload: unknown) {
  const urls: string[] = [];
  const data =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).data
      : undefined;
  if (Array.isArray(data))
    for (const item of data)
      if (item && typeof item === "object") {
        const value = item as Record<string, unknown>;
        if (typeof value.url === "string") urls.push(value.url);
      }
  return urls;
}

function extractVideoState(
  payload: unknown,
): ProviderState & { taskId?: string } {
  const value =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const data =
    value.data && typeof value.data === "object"
      ? (value.data as Record<string, unknown>)
      : value;
  const content =
    data.content && typeof data.content === "object"
      ? (data.content as Record<string, unknown>)
      : undefined;
  return {
    taskId:
      typeof data.id === "string"
        ? data.id
        : typeof data.task_id === "string"
          ? data.task_id
          : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
    url:
      typeof data.url === "string"
        ? data.url
        : typeof data.video_url === "string"
          ? data.video_url
          : typeof content?.video_url === "string"
            ? content.video_url
            : typeof content?.url === "string"
              ? content.url
              : undefined,
    thumbnailUrl:
      typeof data.thumbnail_url === "string"
        ? data.thumbnail_url
        : typeof content?.cover_url === "string"
          ? content.cover_url
          : undefined,
  };
}

function extractAudioUrl(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const value = payload as Record<string, unknown>;
  for (const key of ["url", "audio_url", "audioUrl"]) {
    if (typeof value[key] === "string") return value[key];
  }
  return undefined;
}

async function resolveReferenceImages(
  references: TaskRequest["referenceImages"],
  asDataUrls: boolean,
) {
  if (!references?.length) return [] as string[];
  if (!asDataUrls) return references.map((reference) => reference.url);
  return Promise.all(
    references.slice(0, 9).map(async (reference) => {
      if (reference.url.startsWith("data:")) return reference.url;
      const response = await fetch(reference.url, { cache: "no-store" });
      if (!response.ok)
        throw new Error(`REFERENCE_IMAGE_FETCH_FAILED:${response.status}`);
      const contentType =
        response.headers.get("content-type") ||
        reference.mimeType ||
        "image/png";
      const bytes = Buffer.from(await response.arrayBuffer());
      return `data:${contentType};base64,${bytes.toString("base64")}`;
    }),
  );
}

async function resolveVideoReferenceImages(
  references: TaskRequest["referenceImages"],
  asDataUrls: boolean,
) {
  if (!references?.length)
    return [] as Array<{
      url: string;
      mimeType?: string;
      role?: "reference_image" | "first_frame" | "last_frame";
    }>;
  return Promise.all(
    references.slice(0, 9).map(async (reference) => ({
      ...reference,
      url: asDataUrls
        ? (await resolveReferenceImages([reference], true))[0]
        : reference.url,
    })),
  );
}

function resolveImageSize(ratio?: string, resolution?: string) {
  if (ratio && /^\d+x\d+$/i.test(ratio)) return ratio;
  const normalizedRatio = ratio?.trim() || "1:1";
  const [widthRatio, heightRatio] = normalizedRatio.split(":").map(Number);
  if (
    !Number.isFinite(widthRatio) ||
    !Number.isFinite(heightRatio) ||
    widthRatio <= 0 ||
    heightRatio <= 0
  )
    return undefined;
  const maxDimension = /4k/i.test(resolution ?? "")
    ? 4096
    : /2k/i.test(resolution ?? "")
      ? 2048
      : 1024;
  const scale = maxDimension / Math.max(widthRatio, heightRatio);
  return `${Math.max(1, Math.round(widthRatio * scale))}x${Math.max(1, Math.round(heightRatio * scale))}`;
}
