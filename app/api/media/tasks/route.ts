import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import { createMediaTask, type MediaTaskKind } from "@/lib/media/task-contract";
import { enqueuePersistedMediaTask } from "@/lib/media/task-submit";
import { BillingError } from "@/lib/billing/service";
import { prisma } from "@/lib/server/prisma";

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
    where: { id: channelId, userId: user.id },
    select: { protocol: true, providerKey: true },
  });
  if (
    !channel ||
    !["openai-compatible", "volcengine-ark"].includes(channel.protocol)
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
  const projectId = typeof body.projectId === "string" ? body.projectId : undefined;
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

  const task = createMediaTask({
    id: `media_task_${crypto.randomUUID()}`,
    idempotencyKey,
    kind,
    provider: channel.providerKey,
    protocol: channel.protocol as "openai-compatible" | "volcengine-ark",
    model,
    projectId,
    episodeId,
    batchId: typeof body.batchId === "string" ? body.batchId : undefined,
    channelId,
    targetType:
      typeof body.targetType === "string" ? body.targetType : undefined,
    targetId: typeof body.targetId === "string" ? body.targetId : undefined,
    request: requestPayload,
    maxRetries: typeof body.maxRetries === "number" ? body.maxRetries : 2,
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
