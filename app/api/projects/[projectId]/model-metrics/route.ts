import { getProjectModelMetrics } from "@/lib/observability/project-model-metrics";
import { ConfigurationError } from "@/lib/production-configuration/store";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  try {
    const metrics = await getProjectModelMetrics(user.id, projectId);
    if (!metrics) return attachSessionCookie(Response.json({ message: "项目不存在" }, { status: 404 }), sessionId);
    return attachSessionCookie(Response.json({ metrics }), sessionId);
  } catch (error) {
    const status = error instanceof ConfigurationError ? error.status : 500;
    return attachSessionCookie(
      Response.json({ message: error instanceof Error ? error.message : "无法读取项目模型统计" }, { status }),
      sessionId,
    );
  }
}
