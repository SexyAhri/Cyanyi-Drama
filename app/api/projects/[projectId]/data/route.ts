import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import { getProject, listEpisodes } from "@/lib/projects/queries";
import { listWorkflowRunSummaries } from "@/lib/workflow/store";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const touch = new URL(request.url).searchParams.get("touch") === "1";
  const mediaTaskStore = createDatabaseMediaTaskStore(user.id);
  const [project, episodes, workflows, tasks] = await Promise.all([
    getProject(user.id, projectId, { touch }),
    listEpisodes(user.id, projectId),
    listWorkflowRunSummaries(user.id, projectId, 100),
    mediaTaskStore.list({ projectId, limit: 100 }),
  ]);
  if (!project || !episodes)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(
    Response.json({
      project: { ...project, episodes },
      workflows,
      tasks: tasks.map((task) => ({
        ...task,
        request:
          task.targetType === "vfx_element" || task.targetType === "vfx_composite"
            ? publicVfxRequest(task.request)
            : {},
      })),
    }),
    sessionId,
  );
}

function publicVfxRequest(request: Record<string, unknown>) {
  return Object.fromEntries(
    ["vfxStage", "deliverableId", "deliverableVersion", "panelId"].flatMap(
      (key) => {
        const value = request[key];
        return typeof value === "string" || typeof value === "number"
          ? [[key, value]]
          : [];
      },
    ),
  );
}
