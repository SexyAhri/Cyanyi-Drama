import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import { previewMediaTaskRetry } from "@/lib/media/retry-preview";

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  const { user, sessionId } = await ensureAnonymousUser();
  const task = await createDatabaseMediaTaskStore(user.id).get(taskId);
  if (!task) return attachSessionCookie(Response.json({ message: "Media task not found." }, { status: 404 }), sessionId);
  if (task.status !== "failed") return attachSessionCookie(Response.json({ message: "Only failed tasks can be retried." }, { status: 409 }), sessionId);
  const preview = await previewMediaTaskRetry(task, user.id);
  return attachSessionCookie(Response.json({ preview }), sessionId);
}
