import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/server/prisma";
import { createMediaTask } from "./task-contract";
import { createDatabaseMediaTaskStore } from "./task-store";
import { enqueuePersistedMediaTask } from "./task-submit";
import { BillingError } from "@/lib/billing/service";
import { isMediaChannelProtocol } from "@/lib/providers/media/registry";
import { resolveStoredMediaUrl } from "@/lib/storage";

export class VoiceTaskError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function createVoiceLineAudioTask(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  lineId: string;
  channelId: string;
  model: string;
  voice?: string;
}) {
  const channel = await prisma.channel.findFirst({
    where: { id: input.channelId, userId: input.userId },
    select: { id: true, protocol: true, providerKey: true },
  });
  if (
    !channel ||
    !isMediaChannelProtocol(channel.protocol)
  ) {
    throw new VoiceTaskError(
      "语音生成需要有效且受支持的媒体渠道",
      400,
    );
  }
  const selectedModel = await prisma.providerModel.count({
    where: {
      channelId: input.channelId,
      modelId: input.model,
      selected: true,
      OR: [
        { modelType: "audio" },
        { capabilitiesJson: { contains: '"audio"' } },
      ],
    },
  });
  if (!selectedModel)
    throw new VoiceTaskError("语音模型未在该渠道中配置或未选中", 400);
  const line = await prisma.voiceLine.findFirst({
    where: {
      id: input.lineId,
      episodeId: input.episodeId,
      episode: {
        projectId: input.projectId,
        project: { userId: input.userId },
      },
    },
    select: {
      id: true,
      content: true,
      speaker: true,
      emotionPrompt: true,
      emotionStrength: true,
      voicePreset: {
        select: {
          userId: true,
          projectId: true,
          providerVoiceId: true,
          sampleAsset: {
            select: { url: true, storageKey: true, mimeType: true },
          },
        },
      },
    },
  });
  if (!line) throw new VoiceTaskError("语音行不存在", 404);
  if (!line.content.trim()) throw new VoiceTaskError("语音行内容不能为空", 400);
  const voice = resolveVoiceTaskVoice({
    explicitVoice: input.voice,
    lineSpeaker: line.speaker,
    preset: line.voicePreset,
    projectId: input.projectId,
    userId: input.userId,
  });
  const sampleAsset =
    line.voicePreset?.userId === input.userId &&
    (line.voicePreset.projectId === null ||
      line.voicePreset.projectId === input.projectId)
      ? line.voicePreset.sampleAsset
      : null;
  const sampleUrl = sampleAsset?.storageKey
    ? await resolveStoredMediaUrl(sampleAsset.storageKey)
    : sampleAsset?.url;
  const task = createMediaTask({
    id: `media_task_${randomUUID()}`,
    projectId: input.projectId,
    episodeId: input.episodeId,
    channelId: input.channelId,
    targetType: "voice_line",
    targetId: line.id,
    kind: "audio",
    provider: channel.providerKey,
    protocol: channel.protocol,
    model: input.model,
    request: {
      input: line.content,
      prompt: line.content,
      voice,
      responseFormat: "mp3",
      emotionPrompt: line.emotionPrompt ?? undefined,
      emotionStrength: line.emotionStrength ?? undefined,
      ...(sampleUrl
        ? {
            referenceAudios: [
              { url: sampleUrl, mimeType: sampleAsset?.mimeType ?? undefined },
            ],
          }
        : {}),
    },
  });
  const store = createDatabaseMediaTaskStore(input.userId);
  await store.create(task);
  let queued;
  try {
    queued = await enqueuePersistedMediaTask(input.userId, task);
  } catch (error) {
    if (error instanceof BillingError)
      throw new VoiceTaskError(error.message, error.status);
    throw error;
  }
  return { task: queued, line: { id: line.id } };
}

export function resolveVoiceTaskVoice(input: {
  explicitVoice?: string;
  lineSpeaker: string;
  preset?: {
    userId: string;
    projectId: string | null;
    providerVoiceId: string | null;
  } | null;
  projectId: string;
  userId: string;
}) {
  const presetVoice =
    input.preset?.userId === input.userId &&
    (input.preset.projectId === null ||
      input.preset.projectId === input.projectId)
      ? input.preset.providerVoiceId?.trim()
      : undefined;
  return input.explicitVoice?.trim() || presetVoice || undefined;
}
