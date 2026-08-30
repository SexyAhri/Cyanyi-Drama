import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/server/prisma";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
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
    where: accessibleChannelWhere(input.userId, input.channelId),
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
      delivery: true,
      voiceProfilePrompt: true,
      emotionPrompt: true,
      emotionStrength: true,
      optimizeInstructions: true,
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
  const instructions = buildVoiceInstructions({
    speaker: line.speaker,
    delivery: line.delivery,
    voiceProfilePrompt: line.voiceProfilePrompt,
    performancePrompt: line.emotionPrompt,
    emotionStrength: line.emotionStrength,
  });
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
      instructions,
      optimizeInstructions: line.optimizeInstructions,
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

const MAX_SPEAKER_CHARACTERS = 24;
const MAX_VOICE_PROFILE_CHARACTERS = 64;
const MAX_PERFORMANCE_CHARACTERS = 96;
const MAX_INSTRUCTION_CHARACTERS = 240;

function compactInstructionText(value: string, maxCharacters: number) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const characters = Array.from(normalized);
  if (characters.length <= maxCharacters) return normalized;

  const candidate = characters.slice(0, maxCharacters).join("");
  const punctuationIndex = Math.max(
    candidate.lastIndexOf("。"),
    candidate.lastIndexOf("！"),
    candidate.lastIndexOf("？"),
    candidate.lastIndexOf("；"),
    candidate.lastIndexOf("，"),
    candidate.lastIndexOf("."),
    candidate.lastIndexOf("!"),
    candidate.lastIndexOf("?"),
    candidate.lastIndexOf(";"),
    candidate.lastIndexOf(","),
  );
  if (punctuationIndex >= Math.floor(maxCharacters * 0.6))
    return candidate.slice(0, punctuationIndex + 1).trim();
  return `${characters.slice(0, maxCharacters - 1).join("")}…`;
}

export function buildVoiceInstructions(input: {
  speaker: string;
  delivery: string;
  voiceProfilePrompt?: string | null;
  performancePrompt?: string | null;
  emotionStrength?: number | null;
}) {
  const delivery =
    input.delivery === "inner_monologue"
      ? "内心独白"
      : input.delivery === "voiceover"
        ? "画外音"
        : "对白";
  const strength =
    typeof input.emotionStrength === "number" &&
    Number.isFinite(input.emotionStrength)
      ? Math.min(1, Math.max(0, input.emotionStrength))
      : 0.5;
  const speaker = compactInstructionText(
    input.speaker.trim() || "未命名角色",
    MAX_SPEAKER_CHARACTERS,
  );
  const voiceProfile = compactInstructionText(
    input.voiceProfilePrompt?.trim() ||
      "自然可信，声线与咬字跨句稳定，避免机械朗读",
    MAX_VOICE_PROFILE_CHARACTERS,
  );
  const performance = compactInstructionText(
    input.performancePrompt?.trim() ||
      "按台词语义自然表达，停连、重音与呼吸符合语境",
    MAX_PERFORMANCE_CHARACTERS,
  );
  const instruction = [
    `角色：${speaker}；类型：${delivery}。`,
    `声线：${voiceProfile}`,
    `表演：${performance}`,
    `强度：${strength.toFixed(2)}。`,
    "仅输出干净人声；无音乐、环境音、音效或额外台词。",
  ].join("\n");
  return Array.from(instruction).slice(0, MAX_INSTRUCTION_CHARACTERS).join("");
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
