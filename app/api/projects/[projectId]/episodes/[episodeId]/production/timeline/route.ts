import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { buildEditorTimeline } from "@/lib/production/domain-store";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function POST(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const editorProject = await buildEditorTimeline(user.id, projectId, episodeId);
  if (!editorProject)
    return attachSessionCookie(Response.json({ message: "没有可编排的 Clip 或 Shot" }, { status: 404 }), sessionId);
  return attachSessionCookie(Response.json({ editorProject }, { status: 202 }), sessionId);
}
