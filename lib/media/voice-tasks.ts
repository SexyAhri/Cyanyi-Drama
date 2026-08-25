import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/server/prisma";
import { createMediaTask } from "./task-contract";
import { createDatabaseMediaTaskStore } from "./task-store";
import { enqueuePersistedMediaTask } from "./task-submit";

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
    select: { id: true, protocol: true },
  });
  if (
    !channel ||
    !["openai-compatible", "volcengine-ark"].includes(channel.protocol)
  ) {
    throw new VoiceTaskError(
      "语音生成需要有效的 OpenAI 兼容或火山方舟渠道",
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
    select: { id: true, content: true, speaker: true },
  });
  if (!line) throw new VoiceTaskError("语音行不存在", 404);
  if (!line.content.trim()) throw new VoiceTaskError("语音行内容不能为空", 400);
  const task = createMediaTask({
    id: `media_task_${randomUUID()}`,
    projectId: input.projectId,
    episodeId: input.episodeId,
    channelId: input.channelId,
    targetType: "voice_line",
    targetId: line.id,
    kind: "audio",
    provider:
      channel.protocol === "volcengine-ark"
        ? "volcengine-ark"
        : "openai-compatible",
    protocol: channel.protocol as "openai-compatible" | "volcengine-ark",
    model: input.model,
    request: {
      input: line.content,
      prompt: line.content,
      voice: input.voice || line.speaker,
      responseFormat: "mp3",
    },
  });
  const store = createDatabaseMediaTaskStore(input.userId);
  await store.create(task);
  const queued = await enqueuePersistedMediaTask(input.userId, task);
  return { task: queued, line: { id: line.id } };
}
