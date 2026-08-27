import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import {
  controlMediaTask,
  deleteMediaTask,
  MediaTaskActionError,
} from "@/lib/media/task-actions";

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
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "cancel" && body.action !== "retry")
    return attachSessionCookie(
      Response.json({ message: "Unsupported task action." }, { status: 400 }),
      sessionId,
    );
  try {
    const task = await controlMediaTask({
      action: body.action,
      taskId,
      userId: user.id,
    });
    return attachSessionCookie(
      Response.json({ task }, { status: body.action === "retry" ? 202 : 200 }),
      sessionId,
    );
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        {
          message:
            error instanceof Error ? error.message : "Task action failed.",
        },
        { status: error instanceof MediaTaskActionError ? error.status : 500 },
      ),
      sessionId,
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await context.params;
  const { user, sessionId } = await ensureAnonymousUser();
  try {
    await deleteMediaTask({ taskId, userId: user.id });
    return attachSessionCookie(Response.json({ ok: true }), sessionId);
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        {
          message:
            error instanceof Error ? error.message : "Task deletion failed.",
        },
        { status: error instanceof MediaTaskActionError ? error.status : 500 },
      ),
      sessionId,
    );
  }
}
