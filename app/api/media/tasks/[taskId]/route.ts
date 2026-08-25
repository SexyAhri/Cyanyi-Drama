import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import { cancelMediaJob, enqueueMediaJob } from "@/lib/queue/media-queue";
import { transitionMediaTask, type MediaTask } from "@/lib/media/task-contract";

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await context.params;
  const { user, sessionId } = await ensureAnonymousUser();
  const mediaTaskStore = createDatabaseMediaTaskStore(user.id);
  const task = await mediaTaskStore.get(taskId);

  if (!task) {
    return attachSessionCookie(
      Response.json({ message: "Media task not found." }, { status: 404 }),
      sessionId,
    );
  }

  const events = await mediaTaskStore.listEvents(taskId);
  return attachSessionCookie(Response.json({ task, events }), sessionId);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await context.params;
  const { user, sessionId } = await ensureAnonymousUser();
  const store = createDatabaseMediaTaskStore(user.id);
  const task = await store.get(taskId);
  if (!task)
    return attachSessionCookie(
      Response.json({ message: "Media task not found." }, { status: 404 }),
      sessionId,
    );
  const body = (await request.json().catch(() => ({}))) as { action?: string };

  if (body.action === "cancel") {
    const canceled = await store.requestCancel(taskId);
    if (!canceled)
      return attachSessionCookie(
        Response.json(
          { message: "Task cannot be canceled in its current state." },
          { status: 409 },
        ),
        sessionId,
      );
    await cancelMediaJob(taskId).catch(() => undefined);
    return attachSessionCookie(Response.json({ task: canceled }), sessionId);
  }

  if (body.action === "retry") {
    if (task.status !== "failed")
      return attachSessionCookie(
        Response.json(
          { message: "Only failed tasks can be retried." },
          { status: 409 },
        ),
        sessionId,
      );
    let queued: MediaTask;
    try {
      queued = transitionMediaTask(task, { type: "retry" });
    } catch (error) {
      return attachSessionCookie(
        Response.json(
          {
            message:
              error instanceof Error ? error.message : "Retry limit reached.",
          },
          { status: 409 },
        ),
        sessionId,
      );
    }
    queued = { ...queued, queueJobId: undefined };
    await store.update(queued);
    const job = await enqueueMediaJob({
      taskId,
      userId: user.id,
      projectId: task.projectId,
      episodeId: task.episodeId,
      kind: task.kind,
      maxAttempts: 1,
    });
    queued.queueJobId = job.id;
    await store.update(queued);
    return attachSessionCookie(
      Response.json({ task: queued }, { status: 202 }),
      sessionId,
    );
  }

  return attachSessionCookie(
    Response.json({ message: "Unsupported task action." }, { status: 400 }),
    sessionId,
  );
}
