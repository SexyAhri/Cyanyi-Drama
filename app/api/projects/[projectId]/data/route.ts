import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { getProject, listEpisodes } from "@/lib/projects/queries";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const [project, episodes] = await Promise.all([
    getProject(user.id, projectId),
    listEpisodes(user.id, projectId),
  ]);
  if (!project || !episodes)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(
    Response.json({ project: { ...project, episodes } }),
    sessionId,
  );
}
