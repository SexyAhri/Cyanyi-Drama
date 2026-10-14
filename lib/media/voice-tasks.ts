import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@/lib/server/prisma";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { createMediaTask } from "./task-contract";
import { createDatabaseMediaTaskStore } from "./task-store";
import { enqueuePersistedMediaTask } from "./task-submit";
import { BillingError } from "@/lib/billing/service";
import { isMediaChannelProtocol } from "@/lib/providers/media/registry";
import { resolveProductionRequestConfiguration } from "@/lib/production-configuration/execution";
import { currentProductionConfiguration } from "@/lib/production-configuration/context";
import { configuredSpeechForLine } from "@/lib/production-configuration/sound-execution";

export class VoiceTaskError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function prepareVoiceLineAudioTask(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  lineId: string;
  channelId: string;
  model: string;
  voice?: string;
  idempotencyKey?: string;
  executionVersion?: number;
  regeneratedFromTaskId?: string;
  expectedRequestHash?: string;
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
      matchedPanelId: true,
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
          language: true,
          description: true,
          sampleAsset: {
            select: { url: true, storageKey: true, mimeType: true, task: { select: { userId: true } } },
          },
        },
      },
    },
  });
  if (!line) throw new VoiceTaskError("语音行不存在", 404);
  const current = currentProductionConfiguration();
  const productionConfiguration = current?.userId === input.userId ? current.snapshot : await resolveProductionRequestConfiguration(input.userId, { projectId: input.projectId, episodeId: input.episodeId, panelId: line.matchedPanelId ?? undefined });
  const speech = configuredSpeechForLine(productionConfiguration.sound, line);
  if (!speech) throw new VoiceTaskError("当前发布配置已关闭该类型或移除该台词，请调整配置后重新生成", 400);
  if (!speech.content.trim()) throw new VoiceTaskError("语音行内容不能为空", 400);
  const profile = productionConfiguration.sound.voiceProfiles?.find(profile => profile.speaker === speech.speaker);
  const preset = profile?.voicePresetId ? await prisma.voicePreset.findFirst({ where: { id: profile.voicePresetId, userId: input.userId, OR: [{ projectId: null }, { projectId: input.projectId }] }, select: { userId: true, projectId: true, providerVoiceId: true, language: true, description: true, sampleAsset: { select: { url: true, storageKey: true, mimeType: true, task: { select: { userId: true } } } } } }) : line.voicePreset;
  if (profile?.voicePresetId && !preset) throw new VoiceTaskError("声音预设不存在或不属于此项目", 400);
  const voice = resolveVoiceTaskVoice({
    explicitVoice: input.voice,
    lineSpeaker: speech.speaker,
    preset,
    projectId: input.projectId,
    userId: input.userId,
  });
  const sampleAsset =
    preset?.userId === input.userId &&
    (preset.projectId === null ||
      preset.projectId === input.projectId)
      ? preset.sampleAsset
      : null;
  if (sampleAsset && sampleAsset.task.userId !== input.userId) throw new VoiceTaskError("参考声音素材无权访问", 400);
  const sampleUrl = sampleAsset?.storageKey
    ? `stored:${sampleAsset.storageKey}`
    : sampleAsset?.url;
  const instructions = buildVoiceInstructions({
    speaker: speech.speaker,
    delivery: speech.delivery,
    voiceProfilePrompt: [profile?.language || preset?.language, profile?.direction || preset?.description || line.voiceProfilePrompt, productionConfiguration.sound.voiceDirection].filter(Boolean).join("；"),
    performancePrompt: "direction" in speech ? speech.direction || line.emotionPrompt : line.emotionPrompt,
    emotionStrength: line.emotionStrength,
  });
  const task = createMediaTask({
    id: `media_task_${randomUUID()}`,
    idempotencyKey: input.idempotencyKey,
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
      input: speech.content,
      prompt: speech.content,
      productionConfiguration,
      ...(input.executionVersion ? { executionVersion: input.executionVersion, regeneratedFromTaskId: input.regeneratedFromTaskId } : {}),
      configuredSpeech: speech,
      language: profile?.language || preset?.language || undefined,
      voice,
      responseFormat: "mp3",
      instructions,
      optimizeInstructions: line.optimizeInstructions,
      emotionPrompt: line.emotionPrompt ?? undefined,
      emotionStrength: line.emotionStrength ?? undefined,
      ...(sampleUrl
        ? {
            referenceAudios: [
              { url: sampleUrl, storageKey: sampleAsset?.storageKey ?? undefined, mimeType: sampleAsset?.mimeType ?? undefined },
            ],
          }
        : {}),
    },
  });
  return { task, line: { id: line.id } };
}

export function voiceRequestFingerprint(request: Record<string, unknown>) {
  const stable = { ...request };
  delete stable.executionVersion; delete stable.regeneratedFromTaskId;
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export async function createVoiceLineAudioTask(input: Parameters<typeof prepareVoiceLineAudioTask>[0]) {
  const { task, line } = await prepareVoiceLineAudioTask(input);
  if (input.expectedRequestHash && input.expectedRequestHash !== voiceRequestFingerprint(task.request)) throw new VoiceTaskError("台词或声音配置已变化，请重新预览后提交", 409);
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
