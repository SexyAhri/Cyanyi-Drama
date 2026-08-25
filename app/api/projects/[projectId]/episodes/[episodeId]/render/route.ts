import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createProductionTask, ProductionTaskError } from "@/lib/media/production-tasks";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  if (!channelId || !model)
    return attachSessionCookie(Response.json({ message: "channelId 和 model 是必填项" }, { status: 400 }), sessionId);
  try {
    const task = await createProductionTask({
      userId: user.id,
      projectId,
      episodeId,
      kind: "video",
      targetType: "editor_render",
      targetId: episodeId,
      channelId,
      model,
      request: { operation: "render_timeline", format: stringValue(body.format) || "mp4" },
    });
    return attachSessionCookie(Response.json({ task }, { status: 202 }), sessionId);
  } catch (error) {
    if (error instanceof ProductionTaskError)
      return attachSessionCookie(Response.json({ message: error.message }, { status: error.status }), sessionId);
    throw error;
  }
}

function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
