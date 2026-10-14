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
import { planConfiguredSpeechTiming } from "@/lib/media/configured-speech-timing";
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
  resumeProviderMedia,
} from "@/lib/providers/media/registry";
import type { MediaProviderRequest as TaskRequest, GenerateProviderMediaInput } from "@/lib/providers/media/types";
import type { MediaTaskExecutionPhase } from "@/lib/media/task-contract";
import { configurationSnapshotSchema } from "@/lib/production-configuration/contract";
import { mediaConfigurationChanges } from "@/lib/production-configuration/invalidation";
import { configuredSpeechForLine, requestSoundPolicy } from "@/lib/production-configuration/sound-execution";
import { fixMediaTaskConfiguration, persistMediaTaskProviderOutput, recordMediaTaskExecutionPhase } from "@/lib/media/task-store";
import { storyboardSourceFingerprint, storyboardSourceRevisionMatches } from "@/lib/media/storyboard-source-revision";
import { captureMediaTargetSourceRevision } from "@/lib/media/target-source-revision";
import { mediaTaskRecoveryMode, restoreCheckpointedMediaOutput } from "./media-task-recovery";
import { createMediaPhaseDeadline } from "./media-phase-timeout";
import { withProviderCapacity } from "./provider-capacity";
import { settleMediaTaskProviderOutput } from "@/lib/billing/service";

export async function processQueuedMediaTask(
  taskId: string,
  userId: string,
  cancellationSignal?: AbortSignal,
) {
  const task = await prisma.mediaTask.findFirst({
    where: { id: taskId, userId },
  });
  if (!task) throw new Error("MEDIA_TASK_NOT_FOUND");
  if (task.status !== "running") return false;
  if (!task.channelId) throw new Error("MEDIA_TASK_CHANNEL_REQUIRED");
  if (task.cancelRequestedAt) return false;

  const channel = await prisma.channel.findFirst({
    where: accessibleChannelWhere(userId, task.channelId),
  });
  if (!channel) throw new Error("MEDIA_TASK_CHANNEL_NOT_FOUND");
  const payload = task.payload as { request?: TaskRequest };
  const request = await fixMediaTaskConfiguration(task, payload.request ?? {}, userId) as TaskRequest;
  const deadline = createMediaPhaseDeadline(process.env, cancellationSignal);
  deadline.setPhase((task.executionPhase ?? "connecting") as MediaTaskExecutionPhase);
  const reportPhase = async (phase: MediaTaskExecutionPhase, providerTaskId?: string) => {
    deadline.setPhase(phase);
    return recordMediaTaskExecutionPhase({ userId, taskId: task.id, phase, providerTaskId });
  };
  const initialPhase = (task.executionPhase ?? "queued") as MediaTaskExecutionPhase;
  await reportPhase(["queued", "waiting_quota"].includes(initialPhase) ? "connecting" : initialPhase);
  let output: MediaAsset[] | undefined = restoreCheckpointedMediaOutput(
    (task.payload as { providerOutput?: unknown } | null)?.providerOutput,
    task.kind as MediaTaskKind,
  ) ?? undefined;
  const resolvedRequest = output ? request : await deadline.run(resolveStoredReferenceImages(request, userId));
  const providerRequest = { ...resolvedRequest };
  delete (providerRequest as Record<string, unknown>).canvasAssetTargets;
  delete (providerRequest as Record<string, unknown>).sourceRevision;
  const outboundRequest = sanitizeMediaProviderRequest(
    providerRequest,
    task.kind === "video" ? "video" : task.kind === "audio" ? "audio" : "image",
  ).request;
  const operation =
    typeof (request as Record<string, unknown>).operation === "string"
      ? (request as Record<string, unknown>).operation
      : undefined;
  if (!output && operation === "merge_episode_audio") {
    output = await mergeEpisodeAudio(task.episodeId, task.projectId, userId, request);
  }
  if (!output && operation === "lip_sync") {
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
  if (!output && operation === "render_timeline") {
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
      if (!output) {
        if (task.kind !== "image" && task.kind !== "video" && task.kind !== "audio")
          throw new Error(`MEDIA_WORKER_HANDLER_NOT_IMPLEMENTED:${task.kind}`);
        const mediaInput: GenerateProviderMediaInput = {
          protocol: mediaProtocol!,
          providerKey: channel.providerKey,
          baseUrl: channel.baseUrl,
          apiKey,
          model: task.model,
          mediaTaskId: task.id,
          kind: task.kind,
          request: outboundRequest,
          mediaTemplate,
          signal: deadline.signal,
          onExecutionPhase: async (phase) => { await reportPhase(phase); },
          onProviderTaskId: async (providerTaskId) => { await reportPhase("submitted", providerTaskId); },
        };
        const phase = (task.executionPhase ?? "queued") as MediaTaskExecutionPhase;
        const recoveryMode = mediaTaskRecoveryMode({
          hasProviderOutput: Boolean(output),
          providerTaskId: task.providerTaskId,
          executionPhase: phase,
          protocol: channel.protocol,
        });
        output = await withProviderCapacity({
          channelId: task.channelId,
          model: task.model,
          providerKey: channel.providerKey,
          protocol: channel.protocol,
          countRequest: recoveryMode !== "resume_provider",
          signal: deadline.signal,
          onWaiting: async () => { await reportPhase("waiting_quota"); },
        }, async (capacitySignal) => {
          if (recoveryMode === "resume_provider") {
            await reportPhase(phase === "waiting_quota" || phase === "queued" ? "submitted" : phase);
            return deadline.run(resumeProviderMedia({ ...mediaInput, signal: capacitySignal }, task.providerTaskId!));
          }
          await reportPhase("connecting");
          await reportPhase("request_sent");
          return deadline.run(generateProviderMedia({ ...mediaInput, signal: capacitySignal }));
        });
      }
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
  // Model output is billable even if later validation, downloading or saving fails.
  await persistMediaTaskProviderOutput({ userId, taskId: task.id, output });
  await settleMediaTaskProviderOutput(userId, task.id, output);
  const stripProviderAudio = shouldStripProviderVideoAudio({
    kind: task.kind,
    targetType: task.targetType,
    request,
  });
  const snapshot = configurationSnapshotSchema.safeParse(request.productionConfiguration);
  const validateVideo = task.kind === "video" && ["storyboard_panel", "canvas_node"].includes(task.targetType ?? "") && snapshot.success;
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
  if (!latestTask || latestTask.cancelRequestedAt) { deadline.close(); return false; }

  deadline.setPhase("downloading");
  await deadline.run(persistMediaTaskProviderOutput({ userId, taskId: task.id, output }));

  const storedAssets = await Promise.all(
    output.map(async (asset) => {
      const storageKey = `projects/${task.projectId ?? "global"}/media/${asset.kind}/${asset.id}.${mediaAssetExtension(asset)}`;
      let storedKey: string | null = null;
      let storagePhase: "downloading" | "saving" | undefined;
      try {
        storedKey = await deadline.run(storeGeneratedMediaAsset({
          asset,
          storageKey,
          stripVideoAudio: stripProviderAudio,
          signal: deadline.signal,
          onExecutionPhase: async phase => {
            storagePhase = phase;
            await reportPhase(phase);
          },
          ...(validateVideo ? { videoValidation: {
            requireAudio: request.audioMode === "full" || request.audioMode === "ambient_only",
            expectedDurationSeconds: typeof request.duration === "string" ? Number.parseFloat(request.duration) : undefined,
          } } : {}),
        }));
      } catch (error) {
        if (validateVideo || stripProviderAudio || isSourceMediaDownloadFailure(error) ||
            storagePhase === "saving" ||
            (error instanceof Error && error.message.startsWith("MEDIA_PHASE_TIMEOUT:")) ||
            (error instanceof Error && error.message.startsWith("MEDIA_TASK_")))
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
  const configurationChanges = await mediaConfigurationChanges(prisma, userId, task, request);
  const sourceRevision = request.sourceRevision as { targetType?: string; targetId?: string; panelId?: string; revisionVersion?: number; fingerprint?: string } | undefined;
  const sourceRevisionTargetType = sourceRevision?.targetType ?? (sourceRevision?.panelId ? "storyboard_panel" : undefined);
  const sourceRevisionTargetId = sourceRevision?.targetId ?? sourceRevision?.panelId;
  const expectedSourceFingerprint = sourceRevision?.fingerprint;
  let currentSourceFingerprint: string | undefined;
  let newerExecutionExists = false;
  if (sourceRevisionTargetType && sourceRevisionTargetId && expectedSourceFingerprint) {
    if (sourceRevision?.targetType) {
      currentSourceFingerprint = (await captureMediaTargetSourceRevision({
        userId,
        projectId: task.projectId,
        episodeId: task.episodeId,
        targetType: sourceRevisionTargetType,
        targetId: sourceRevisionTargetId,
        revisionVersion: sourceRevision.revisionVersion ?? 1,
        request,
      }))?.fingerprint;
    } else if (sourceRevisionTargetType === "storyboard_panel") {
      // Compatibility for tasks created before the richer source snapshot was stored.
      const panel = await prisma.storyboardPanel.findFirst({ where: { id: sourceRevisionTargetId, storyboard: { project: { userId } } }, select: {
        clipId: true, description: true, videoPrompt: true, voiceoverText: true, lipSyncText: true,
        clip: { select: { content: true, screenplay: true } },
        voiceLines: { orderBy: { lineIndex: "asc" }, select: { speaker: true, content: true, delivery: true } },
      } });
      if (panel) currentSourceFingerprint = storyboardSourceFingerprint({
        clipId: panel.clipId, clipContent: panel.clip?.content ?? null, screenplay: panel.clip?.screenplay ?? null,
        description: panel.description, videoPrompt: panel.videoPrompt, voiceoverText: panel.voiceoverText,
        lipSyncText: panel.lipSyncText, voiceLines: panel.voiceLines,
      });
    }
  }
  if (task.targetType && task.targetId) {
    newerExecutionExists = Boolean(await prisma.mediaTask.findFirst({
      where: {
        userId,
        id: { not: task.id },
        targetType: task.targetType,
        targetId: task.targetId,
        kind: task.kind,
        createdAt: { gt: task.createdAt },
        status: { in: ["queued", "running", "succeeded"] },
      },
      select: { id: true },
    }));
  }
  const freshness = storyboardSourceRevisionMatches({
    expected: expectedSourceFingerprint,
    current: currentSourceFingerprint,
    publishedConfigurationChanged: configurationChanges.length > 0,
    newerExecutionExists,
  });
  const sourceChanged = Boolean(expectedSourceFingerprint && currentSourceFingerprint !== expectedSourceFingerprint);
  const staleFields = [...configurationChanges, ...(sourceChanged ? freshness.fields.filter(field => field.startsWith("source.")) : []), ...(newerExecutionExists ? ["newer_execution"] : [])];
  if (staleFields.length) {
    const reason = sourceChanged ? "storyboard_source_changed" : newerExecutionExists ? "superseded_by_newer_execution" : "published_configuration_changed";
    for (const asset of output) asset.metadata = { ...asset.metadata, productionConfigurationStale: { fields: staleFields, reason, updatedAt: new Date().toISOString() } };
    for (const stored of storedAssets) stored.metadataJson = JSON.stringify(mediaAssetMetadata(output.find(asset => asset.id === stored.id)!));
  }
  const completedAt = new Date();
  const finalized = await prisma.$transaction(async (tx) => {
    const claimed = await tx.mediaTask.updateMany({
      where: { id: task.id, userId, status: "running", cancelRequestedAt: null },
      data: {
        status: "succeeded",
        executionPhase: "succeeded",
        progress: 100,
        progressMessage: null,
        payload: JSON.parse(
          JSON.stringify({
            request: compactMediaTaskRequest(request),
            output: compactMediaTaskOutput(output),
          }),
        ),
        error: Prisma.DbNull,
        completedAt,
        updatedAt: completedAt,
      },
    });
    if (!claimed.count) return false;
    await tx.mediaAsset.createMany({
      data: storedAssets.map((asset) => ({ ...asset, taskId: task.id })),
    });
    await tx.mediaTaskEvent.create({
      data: {
        taskId: task.id,
        type: "succeeded",
        status: "succeeded",
        progress: 100,
        executionPhase: "succeeded",
      },
    });
    return true;
  });
  if (!finalized) { deadline.close(); return false; }
  if (!staleFields.length) await linkGeneratedAsset(task, userId, output[0], request);
  if (!staleFields.length && task.targetType === "canvas_node" && task.kind === "image" && task.projectId) {
    for (const asset of output.slice(1))
      await linkCanvasGeneratedImage(task, userId, task.projectId, asset, request);
  }
  deadline.close();
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

export function shouldDeferGeneratedAssetSelection(request: Record<string, unknown>) {
  return request.canvasDeferredSelection === true || request.deferredSelection === true;
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
  request: TaskRequest,
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
            content: true,
            speaker: true,
            delivery: true,
            durationSeconds: true,
            audioAsset: {
              select: { url: true, storageKey: true, mimeType: true, task: { select: { payload: true } } },
            },
          },
        },
      },
    }),
    prisma.voiceLine.findMany({
      where: { episodeId, episode: { projectId, project: { userId } } },
      orderBy: { lineIndex: "asc" },
      select: { id: true, lineIndex: true, matchedPanelId: true, speaker: true, content: true, delivery: true },
    }),
  ]);
  if (!panels.length) throw new Error("AUDIO_MERGE_PANELS_EMPTY");
  assertVoiceLinePanelCoverage({
    panelIds: panels.map((panel) => panel.id),
    lines: voiceLines.filter(line => requestSoundPolicy(request, line.matchedPanelId ?? undefined).mode === "post" && configuredSpeechForLine(requestSoundPolicy(request, line.matchedPanelId ?? undefined), line)),
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
    const policy = requestSoundPolicy(request, panel.id);
    if (policy.mode !== "post") { timelineCursor += panel.durationSeconds ?? 1; continue; }
    const resolvedLines: Array<{
      id: string;
      durationSeconds: number;
      url: string;
      startSeconds?: number;
      endSeconds?: number;
    }> = [];
    for (const line of panel.voiceLines) {
      const speech = configuredSpeechForLine(policy, line);
      if (!speech) continue;
      const audioRequest = (line.audioAsset?.task.payload as { request?: Record<string, unknown> } | undefined)?.request;
      if (audioRequest && audioRequest.input !== speech.content) throw new Error(`AUDIO_MERGE_SPEECH_CHANGED:${line.lineIndex}: 请先按当前台词重新配音`);
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
      resolvedLines.push({ id: line.id, durationSeconds, url, ...("startSeconds" in speech ? { startSeconds: speech.startSeconds } : {}), ...("endSeconds" in speech ? { endSeconds: speech.endSeconds } : {}) });
      if (line.durationSeconds === null)
        await prisma.voiceLine.update({
          where: { id: line.id },
          data: { durationSeconds },
        });
    }
    const plan = planConfiguredSpeechTiming(resolvedLines, panel.durationSeconds ?? 1);
    resolvedLines.forEach((line, index) => {
      clips.push({
        url: line.url,
        startSeconds: timelineCursor + plan.timings[index].startSeconds,
        durationSeconds: plan.timings[index].durationSeconds,
        playbackRate: plan.timings[index].playbackRate,
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
  const soundPolicy = requestSoundPolicy(request);

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
          delivery: true,
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
  const effectiveVoiceLines = voiceLines.flatMap(line => {
    const speech = configuredSpeechForLine(requestSoundPolicy(request, line.matchedPanelId ?? undefined), line, true);
    return speech ? [{ ...line, speaker: speech.speaker, content: speech.content, delivery: speech.delivery, ...("startSeconds" in speech ? { startSeconds: speech.startSeconds } : {}), ...("endSeconds" in speech ? { endSeconds: speech.endSeconds } : {}) }] : [];
  });
  const subtitleLines = effectiveVoiceLines.filter(line => requestSoundPolicy(request, line.matchedPanelId ?? undefined).subtitles === "post");
  const postVoiceLines = effectiveVoiceLines.filter(line => requestSoundPolicy(request, line.matchedPanelId ?? undefined).mode === "post");
  const nativeVoiceLines = effectiveVoiceLines.filter(line => requestSoundPolicy(request, line.matchedPanelId ?? undefined).mode === "native");
  if (subtitleLines.length) assertTimelineSubtitleCoverage({
    timelinePanelIds: sequence.map((track) => track.panelId ?? track.id),
    lines: subtitleLines,
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

  const renderAudioTracks = episodeAudioTracks.filter(track => soundPolicy.mode !== "silent" && (
    track.trackType === "music" ? soundPolicy.music === "post" || soundPolicy.mode === "post" && soundPolicy.music === "designed"
      : track.trackType === "ambience" ? soundPolicy.mode === "post" && soundPolicy.ambience
        : track.trackType === "sfx" ? soundPolicy.mode === "post" && soundPolicy.effects : postVoiceLines.length > 0
  )).map((track) => {
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
    postVoiceLines.length,
    dialogueSource?.storageKey ?? dialogueSource?.url,
    false,
  );

  assertTimelineDialogueAudioCoverage(nativeVoiceLines.length, undefined, nativeVoiceLines.every(line => resolvedTracks.some(({ panel, source, isImage, track }) => panel.id === line.matchedPanelId && source && !isImage && track.volume !== 0)));
  const subtitles = buildTimelineSubtitles(subtitleLines, sequence);
  const selectedAudioTracks = renderAudioTracks;

  const specification = normalizeRenderSpecification(
    request as Record<string, unknown>,
  );
  const rendered = await renderTimelineVideo({
    segments: segments.map((segment, index) => ({ ...segment,
      volume: requestSoundPolicy(request, resolvedTracks[index].panel.id).mode === "native" ? segment.volume : 0,
      requiresAudio: nativeVoiceLines.some((line) => line.matchedPanelId === resolvedTracks[index].panel.id),
    })),
    audioTracks: selectedAudioTracks,
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
        hasAudio: rendered.hasAudio,
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
    ["storyboard_panel", "canvas_node"].includes(input.targetType ?? "") &&
    input.request.audioMode === "none"
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
  hasSourceDialogue = false,
) {
  if (voiceLineCount > 0 && !audioUrl && !hasSourceDialogue)
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
    if (shouldDeferGeneratedAssetSelection(request as Record<string, unknown>)) return;
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
