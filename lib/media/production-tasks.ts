import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/server/prisma";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { createMediaTask } from "./task-contract";
import { createDatabaseMediaTaskStore } from "./task-store";
import { enqueuePersistedMediaTask } from "./task-submit";
import { BillingError } from "@/lib/billing/service";
import { isMediaChannelProtocol } from "@/lib/providers/media/registry";

export class ProductionTaskError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function createProductionTask(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  kind: "audio" | "image" | "lipsync" | "video";
  targetType:
    | "episode_audio"
    | "lip_sync"
    | "editor_render"
    | "vfx_element"
    | "vfx_composite";
  targetId: string;
  channelId: string;
  model: string;
  request: Record<string, unknown>;
}) {
  const channel = await prisma.channel.findFirst({
    where: accessibleChannelWhere(input.userId, input.channelId),
    select: { id: true, protocol: true, providerKey: true },
  });
  if (
    !channel ||
    !isMediaChannelProtocol(channel.protocol)
  ) {
    throw new ProductionTaskError(
      "媒体任务需要有效且受支持的媒体渠道",
      400,
    );
  }
  const capability =
    input.targetType === "lip_sync"
      ? '"lipsync"'
      : input.kind === "image"
        ? '"image"'
        : input.kind === "video"
          ? '"video"'
          : '"audio"';
  const selectedModel = await prisma.providerModel.count({
    where: {
      channelId: input.channelId,
      modelId: input.model,
      selected: true,
      OR: [
        { modelType: input.kind },
        ...(input.targetType === "lip_sync" ? [{ modelType: "lipsync" }] : []),
        { capabilitiesJson: { contains: capability } },
      ],
    },
  });
  if (!selectedModel)
    throw new ProductionTaskError("模型未在该渠道中配置或未选中", 400);
  const ownsEpisode = await prisma.episode.count({
    where: {
      id: input.episodeId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
  });
  if (!ownsEpisode) throw new ProductionTaskError("项目或剧集不存在", 404);
  const task = createMediaTask({
    id: `media_task_${randomUUID()}`,
    projectId: input.projectId,
    episodeId: input.episodeId,
    channelId: input.channelId,
    targetType: input.targetType,
    targetId: input.targetId,
    kind: input.kind,
    provider: channel.providerKey,
    protocol: channel.protocol,
    model: input.model,
    request: input.request,
  });
  const store = createDatabaseMediaTaskStore(input.userId);
  await store.create(task);
  try {
    return await enqueuePersistedMediaTask(input.userId, task);
  } catch (error) {
    if (error instanceof BillingError)
      throw new ProductionTaskError(error.message, error.status);
    throw error;
  }
}
