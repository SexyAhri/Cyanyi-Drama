import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import { createMediaTask, type MediaTaskKind } from "@/lib/media/task-contract";
import { enqueueMediaJob } from "@/lib/queue/media-queue";
import type { ChannelProtocol } from "@/lib/agent/provider-types";

const taskKinds = new Set<MediaTaskKind>([
  "image",
  "video",
  "audio",
  "lipsync",
  "voicedesign",
]);
const protocols = new Set<ChannelProtocol>([
  "openai-compatible",
  "anthropic",
  "google-gemini",
  "volcengine-ark",
]);

export async function POST(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const body = (await request.json()) as Record<string, unknown>;
  const kind =
    typeof body.kind === "string" && taskKinds.has(body.kind as MediaTaskKind)
      ? (body.kind as MediaTaskKind)
      : null;
  const protocol =
    typeof body.protocol === "string" &&
    protocols.has(body.protocol as ChannelProtocol)
      ? (body.protocol as ChannelProtocol)
      : null;
  if (
    !kind ||
    !protocol ||
    typeof body.model !== "string" ||
    typeof body.provider !== "string"
  ) {
    return attachSessionCookie(
      Response.json(
        { message: "kind, provider, protocol and model are required." },
        { status: 400 },
      ),
      sessionId,
    );
  }

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

  const task = createMediaTask({
    id: `media_task_${crypto.randomUUID()}`,
    idempotencyKey,
    kind,
    provider: body.provider,
    protocol,
    model: body.model,
    projectId: typeof body.projectId === "string" ? body.projectId : undefined,
    episodeId: typeof body.episodeId === "string" ? body.episodeId : undefined,
    batchId: typeof body.batchId === "string" ? body.batchId : undefined,
    channelId: typeof body.channelId === "string" ? body.channelId : undefined,
    targetType:
      typeof body.targetType === "string" ? body.targetType : undefined,
    targetId: typeof body.targetId === "string" ? body.targetId : undefined,
    request:
      body.request && typeof body.request === "object"
        ? (body.request as Record<string, unknown>)
        : {},
    maxRetries: typeof body.maxRetries === "number" ? body.maxRetries : 2,
  });
  await store.create(task);
  try {
    const job = await enqueueMediaJob({
      taskId: task.id,
      userId: user.id,
      projectId: task.projectId,
      episodeId: task.episodeId,
      channelId: task.channelId,
      kind,
      maxAttempts: task.maxRetries + 1,
    });
    task.queueJobId = job.id;
    await store.update(task);
  } catch (error) {
    await store.update({
      ...task,
      status: "failed",
      error: {
        code: "QUEUE_ENQUEUE_FAILED",
        message: error instanceof Error ? error.message : "Queue unavailable.",
        retryable: true,
      },
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await store.appendEvent({
      taskId: task.id,
      type: "failed",
      status: "failed",
      message: error instanceof Error ? error.message : "Queue unavailable.",
    });
    return attachSessionCookie(
      Response.json(
        { message: "Unable to enqueue media task." },
        { status: 503 },
      ),
      sessionId,
    );
  }
  return attachSessionCookie(
    Response.json({ task }, { status: 202 }),
    sessionId,
  );
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
