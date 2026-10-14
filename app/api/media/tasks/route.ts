import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import { createMediaTask, type MediaTaskKind } from "@/lib/media/task-contract";
import { enqueuePersistedMediaTask } from "@/lib/media/task-submit";
import { BillingError } from "@/lib/billing/service";
import { prisma } from "@/lib/server/prisma";
import { isMediaChannelProtocol } from "@/lib/providers/media/registry";
import { productionRequestOptionsSchema, resolveProductionRequestConfiguration, productionRequestErrorStatus } from "@/lib/production-configuration/execution";
import { soundPolicyAudioMode } from "@/lib/production-configuration/contract";
import { lockVideoAudioPerformance } from "@/lib/media/director-prompt-locks";
import { resolveVideoProductionCapabilities, videoProductionIssues, normalizeVideoProductionParameters } from "@/lib/media/video-production-capabilities";
import { resolveVideoVoiceReferences } from "@/lib/media/video-voice-references";

const taskKinds = new Set<MediaTaskKind>([
  "image",
  "video",
  "audio",
  "lipsync",
]);

export async function POST(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const body = (await request.json()) as Record<string, unknown>;
  const kind =
    typeof body.kind === "string" && taskKinds.has(body.kind as MediaTaskKind)
      ? (body.kind as MediaTaskKind)
      : null;
  const channelId =
    typeof body.channelId === "string" ? body.channelId.trim() : "";
  if (
    !kind ||
    !channelId ||
    typeof body.model !== "string" ||
    !body.model.trim()
  ) {
    return attachSessionCookie(
      Response.json(
        { message: "kind、channelId 和 model 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  }

  const channel = await prisma.channel.findFirst({
    where: accessibleChannelWhere(user.id, channelId),
    select: { protocol: true, providerKey: true },
  });
  if (
    !channel ||
    !isMediaChannelProtocol(channel.protocol)
  )
    return attachSessionCookie(
      Response.json({ message: "媒体渠道不存在或协议不受支持" }, { status: 400 }),
      sessionId,
    );
  const model = body.model.trim();
  const configuredModel = await prisma.providerModel.count({
    where: {
      channelId,
      modelId: model,
      selected: true,
      OR: [
        { modelType: kind },
        { capabilitiesJson: { contains: `"${kind}"` } },
      ],
    },
  });
  if (!configuredModel)
    return attachSessionCookie(
      Response.json({ message: "模型未在该渠道中配置或未选中" }, { status: 400 }),
      sessionId,
    );

  const idempotencyKey =
    typeof body.idempotencyKey === "string"
      ? body.idempotencyKey.trim()
      : undefined;
  const store = createDatabaseMediaTaskStore(user.id);
  if (idempotencyKey) {
    const existing = await store.findByIdempotencyKey(idempotencyKey);
    if (existing)
      return attachSessionCookie(
        Response.json({ task: existing, reused: true }),
        sessionId,
      );
  }

  const requestPayload =
    body.request && typeof body.request === "object"
      ? (body.request as Record<string, unknown>)
      : {};
  if (kind === "lipsync" && requestPayload.operation !== "lip_sync")
    return attachSessionCookie(
      Response.json({ message: "lipsync 任务必须使用 lip_sync operation" }, { status: 400 }),
      sessionId,
    );
  let projectId = typeof body.projectId === "string" ? body.projectId : undefined;
  const episodeId = typeof body.episodeId === "string" ? body.episodeId : undefined;
  if (
    projectId &&
    !(await prisma.project.count({ where: { id: projectId, userId: user.id } }))
  )
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  if (
    episodeId &&
    !(await prisma.episode.count({
      where: { id: episodeId, ...(projectId ? { projectId } : {}), project: { userId: user.id } },
    }))
  )
    return attachSessionCookie(
      Response.json({ message: "剧集不存在" }, { status: 404 }),
      sessionId,
    );

  let productionConfiguration;
  try {
    if (episodeId && !projectId) {
      const episode = await prisma.episode.findFirst({ where: { id: episodeId, project: { userId: user.id } }, select: { projectId: true } });
      projectId = episode?.projectId;
    }
    productionRequestOptionsSchema.parse(body);
    productionConfiguration = await resolveProductionRequestConfiguration(user.id, { projectId, episodeId,
      ...(body.targetType === "storyboard_panel" && typeof body.targetId === "string" ? { panelId: body.targetId } : {}),
    });
    delete requestPayload.panelSoundConfigurations;
    if (kind === "video") {
      const configured = await prisma.providerModel.findFirst({ where: { channelId, modelId: model, selected: true }, select: { capabilitiesJson: true } });
      const capabilities = resolveVideoProductionCapabilities({ model, protocol: channel.protocol, capabilities: JSON.parse(configured?.capabilitiesJson || "{}") });
      const blockers = videoProductionIssues(capabilities, productionConfiguration.sound).filter(issue => issue.blocking);
      if (blockers.length) return attachSessionCookie(Response.json({ message: blockers.map(issue => issue.message).join("；") }, { status: 400 }), sessionId);
      const referenceAudios = await resolveVideoVoiceReferences(user.id, productionConfiguration.sound, capabilities);
      const parameters = normalizeVideoProductionParameters({ model, protocol: channel.protocol, capabilities, ratio: typeof requestPayload.ratio === "string" ? requestPayload.ratio : "16:9", resolution: typeof requestPayload.resolution === "string" ? requestPayload.resolution : "1080p", durationSeconds: typeof requestPayload.duration === "string" ? Number.parseFloat(requestPayload.duration) : 5, mode: typeof requestPayload.videoMode === "string" ? requestPayload.videoMode : "reference", referenceAudioCount: referenceAudios.length });
      Object.assign(requestPayload, { ratio: parameters.ratio, resolution: parameters.resolution, duration: parameters.duration, prompt: lockVideoAudioPerformance(String(requestPayload.prompt ?? ""), { soundPolicy: productionConfiguration.sound }), audioMode: soundPolicyAudioMode(productionConfiguration.sound), referenceAudios, productionCapabilities: capabilities });
    }
  } catch (error) {
    return attachSessionCookie(Response.json({ message: error instanceof Error ? error.message : "配置无效" }, { status: productionRequestErrorStatus(error) ?? 500 }), sessionId);
  }
  const task = createMediaTask({
    id: `media_task_${crypto.randomUUID()}`,
    idempotencyKey,
    kind,
    provider: channel.providerKey,
    protocol: channel.protocol,
    model,
    projectId,
    episodeId,
    batchId: typeof body.batchId === "string" ? body.batchId : undefined,
    channelId,
    targetType:
      typeof body.targetType === "string" ? body.targetType : undefined,
    targetId: typeof body.targetId === "string" ? body.targetId : undefined,
    request: { ...requestPayload, productionConfiguration },
    maxRetries: typeof body.maxRetries === "number" ? body.maxRetries : 0,
  });
  await store.create(task);
  try {
    const queued = await enqueuePersistedMediaTask(user.id, task);
    return attachSessionCookie(
      Response.json({ task: queued }, { status: 202 }),
      sessionId,
    );
  } catch (error) {
    const billingError = error instanceof BillingError;
    return attachSessionCookie(
      Response.json(
        { message: error instanceof Error ? error.message : "任务入队失败" },
        { status: billingError ? error.status : 503 },
      ),
      sessionId,
    );
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { user, sessionId } = await ensureAnonymousUser();
  const mediaTaskStore = createDatabaseMediaTaskStore(user.id);
  const status = url.searchParams.get("status") as
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "canceled"
    | null;
  const limitValue = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitValue)
    ? Math.min(Math.max(Math.floor(limitValue), 1), 100)
    : 50;

  return attachSessionCookie(
    Response.json({
      tasks: await mediaTaskStore.list({
        limit,
        ...(status ? { status } : {}),
        ...(url.searchParams.get("projectId")
          ? { projectId: url.searchParams.get("projectId")! }
          : {}),
        ...(url.searchParams.get("episodeId")
          ? { episodeId: url.searchParams.get("episodeId")! }
          : {}),
        ...(url.searchParams.get("batchId")
          ? { batchId: url.searchParams.get("batchId")! }
          : {}),
      }),
    }),
    sessionId,
  );
}
