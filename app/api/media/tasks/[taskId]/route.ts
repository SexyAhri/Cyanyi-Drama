import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await context.params;
  const { user, sessionId } = await ensureAnonymousUser();
  const mediaTaskStore = createDatabaseMediaTaskStore(user.id);
  const task = await mediaTaskStore.get(taskId);

  if (!task) {
    return attachSessionCookie(Response.json({ message: "Media task not found." }, { status: 404 }), sessionId);
  }

  return attachSessionCookie(Response.json({ task }), sessionId);
}
