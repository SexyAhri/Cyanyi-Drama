import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createProductionTask, ProductionTaskError } from "@/lib/media/production-tasks";
import { prisma } from "@/lib/server/prisma";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  const panelId = stringValue(body.panelId);
  const audioAssetId = stringValue(body.audioAssetId);
  if (!channelId || !model || !panelId)
    return attachSessionCookie(Response.json({ message: "channelId、model 和 panelId 是必填项" }, { status: 400 }), sessionId);
  if (audioAssetId) {
    const innerMonologue = await prisma.voiceLine.findFirst({
      where: {
        episodeId,
        audioAssetId,
        delivery: { not: "dialogue" },
      },
      select: { id: true },
    });
    if (innerMonologue)
      return attachSessionCookie(
        Response.json(
          { message: "内心独白和画外音不允许生成口型" },
          { status: 400 },
        ),
        sessionId,
      );
  }
  try {
    const task = await createProductionTask({
      userId: user.id,
      projectId,
      episodeId,
      kind: "video",
      targetType: "lip_sync",
      targetId: panelId,
      channelId,
      model,
      request: { operation: "lip_sync", panelId, audioAssetId: audioAssetId || undefined },
    });
    return attachSessionCookie(Response.json({ task }, { status: 202 }), sessionId);
  } catch (error) {
    if (error instanceof ProductionTaskError)
      return attachSessionCookie(Response.json({ message: error.message }, { status: error.status }), sessionId);
    throw error;
  }
}

function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
