import { ensureAnonymousUser, attachSessionCookie } from "@/lib/server/auth";
import { startEpisodeProductionWorkflow } from "@/lib/studio/agent-production-actions";

export async function POST(request: Request, context: { params: Promise<{ projectId: string; episodeId: string }> }) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.channelId !== "string" || typeof body.model !== "string") throw new Error("请选择文本模型");
    const result = await startEpisodeProductionWorkflow({ userId: user.id, projectId, targetId: episodeId,
      operation: "start_original_episode_generation", channelId: body.channelId, model: body.model,
      locale: body.locale === "en" ? "en" : "zh", request: typeof body.instructions === "string" ? body.instructions : "" });
    return attachSessionCookie(Response.json({ workflow: result.workflow, reused: result.reused }, { status: 202 }), sessionId);
  } catch (error) { return attachSessionCookie(Response.json({ message: error instanceof Error ? error.message : "续写任务提交失败" }, { status: 400 }), sessionId); }
}
