import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createProductionTask, ProductionTaskError } from "@/lib/media/production-tasks";
import { normalizeRenderSpecification } from "@/lib/providers/local/render-spec";
import { prisma } from "@/lib/server/prisma";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  if (!channelId || !model)
    return attachSessionCookie(Response.json({ message: "channelId 和 model 是必填项" }, { status: 400 }), sessionId);
  let specification;
  try {
    specification = normalizeRenderSpecification(body);
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        { message: error instanceof Error ? error.message : "渲染规格无效" },
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
      targetType: "editor_render",
      targetId: episodeId,
      channelId,
      model,
      request: {
        operation: "render_timeline",
        ...specification,
      },
    });
    await prisma.editorProject.updateMany({
      where: {
        episodeId,
        episode: { projectId, project: { userId: user.id } },
      },
      data: {
        renderStatus: "queued",
        renderTaskId: task.id,
        outputAssetId: null,
      },
    });
    return attachSessionCookie(Response.json({ task }, { status: 202 }), sessionId);
  } catch (error) {
    if (error instanceof ProductionTaskError)
      return attachSessionCookie(Response.json({ message: error.message }, { status: error.status }), sessionId);
    throw error;
  }
}

function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
