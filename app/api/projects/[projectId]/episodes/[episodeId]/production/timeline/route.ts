import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { buildEditorTimeline } from "@/lib/production/domain-store";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function POST(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  let editorProject;
  try { editorProject = await buildEditorTimeline(user.id, projectId, episodeId); }
  catch (error) {
    if (error instanceof Error && /^(TIMELINE_|SUBTITLE_)/.test(error.message))
      return attachSessionCookie(Response.json({ message: error.message }, { status: 400 }), sessionId);
    throw error;
  }
  if (!editorProject)
    return attachSessionCookie(Response.json({ message: "没有可编排的 Clip 或 Shot" }, { status: 404 }), sessionId);
  return attachSessionCookie(Response.json({ editorProject }, { status: 202 }), sessionId);
}
