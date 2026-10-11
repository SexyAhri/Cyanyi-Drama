import { loadProductionReadiness } from "@/lib/studio/production-readiness";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import { getProject, listEpisodes } from "@/lib/projects/queries";
import { listWorkflowRunSummaries } from "@/lib/workflow/store";
import { prisma } from "@/lib/server/prisma";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const touch = new URL(request.url).searchParams.get("touch") === "1";
  const mediaTaskStore = createDatabaseMediaTaskStore(user.id);
  const [project, episodes, workflows, recentTasks, queuedTasks, runningTasks] = await Promise.all([
    getProject(user.id, projectId, { touch }),
    listEpisodes(user.id, projectId),
    listWorkflowRunSummaries(user.id, projectId, 100),
    mediaTaskStore.list({ projectId, limit: 100 }),
    mediaTaskStore.list({ projectId, status: "queued", limit: 10000 }),
    mediaTaskStore.list({ projectId, status: "running", limit: 10000 }),
  ]);
  if (!project || !episodes)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  const tasks = [...new Map([...recentTasks, ...queuedTasks, ...runningTasks].map(task => [task.id, task])).values()];
  const readiness = await loadProductionReadiness(user.id, projectId);
  const operationTargets = await resolveOperationTargets(projectId, [
    ...workflows.map((workflow) => ({
      targetId: workflow.targetId,
      targetType: workflow.targetType,
    })),
    ...tasks.map((task) => ({
      targetId: task.targetId,
      targetType: task.targetType,
    })),
  ]);
  return attachSessionCookie(
    Response.json({
      project: { ...project, episodes },
      readiness,
      workflows: workflows.map((workflow) => ({
        ...workflow,
        ...operationTargets.get(
          operationTargetKey(workflow.targetType, workflow.targetId),
        ),
      })),
      tasks: tasks.map((task) => ({
        ...task,
        ...operationTargets.get(
          operationTargetKey(task.targetType, task.targetId),
        ),
        request:
          task.targetType === "vfx_element" || task.targetType === "vfx_composite"
            ? publicVfxRequest(task.request)
            : {},
      })),
    }),
    sessionId,
  );
}

async function resolveOperationTargets(
  projectId: string,
  tasks: Array<{ targetId?: string; targetType?: string }>,
) {
  const ids = (targetType: string) =>
    Array.from(
      new Set(
        tasks.flatMap((task) =>
          task.targetType === targetType && task.targetId ? [task.targetId] : [],
        ),
      ),
    );
  const [
    characters,
    appearances,
    locations,
    locationImages,
    props,
    panels,
    voiceLines,
  ] = await Promise.all([
    prisma.novelCharacter.findMany({
      where: { id: { in: ids("character") }, projectId },
      select: { id: true, name: true },
    }),
    prisma.characterAppearance.findMany({
      where: {
        id: { in: ids("character_appearance") },
        character: { projectId },
      },
      select: { id: true, character: { select: { name: true } } },
    }),
    prisma.novelLocation.findMany({
      where: { id: { in: ids("location") }, projectId },
      select: { id: true, name: true },
    }),
    prisma.locationImage.findMany({
      where: {
        id: { in: ids("location_image") },
        location: { projectId },
      },
      select: { id: true, location: { select: { name: true } } },
    }),
    prisma.novelProp.findMany({
      where: { id: { in: ids("prop") }, projectId },
      select: { id: true, name: true },
    }),
    prisma.storyboardPanel.findMany({
      where: {
        id: { in: ids("storyboard_panel") },
        storyboard: { projectId },
      },
      select: { id: true, panelIndex: true, description: true },
    }),
    prisma.voiceLine.findMany({
      where: {
        id: { in: ids("voice_line") },
        episode: { projectId },
      },
      select: { id: true, lineIndex: true, speaker: true, content: true },
    }),
  ]);
  const result = new Map<
    string,
    { displayName?: string; displayIndex?: number; displaySummary?: string }
  >();
  for (const row of characters)
    result.set(operationTargetKey("character", row.id), {
      displayName: row.name,
    });
  for (const row of appearances)
    result.set(operationTargetKey("character_appearance", row.id), {
      displayName: row.character.name,
    });
  for (const row of locations)
    result.set(operationTargetKey("location", row.id), {
      displayName: row.name,
    });
  for (const row of locationImages)
    result.set(operationTargetKey("location_image", row.id), {
      displayName: row.location.name,
    });
  for (const row of props)
    result.set(operationTargetKey("prop", row.id), { displayName: row.name });
  for (const row of panels)
    result.set(operationTargetKey("storyboard_panel", row.id), {
      displayIndex: row.panelIndex + 1,
      displaySummary: row.description ?? undefined,
    });
  for (const row of voiceLines)
    result.set(operationTargetKey("voice_line", row.id), {
      displayName: row.speaker,
      displayIndex: row.lineIndex + 1,
      displaySummary: row.content,
    });
  return result;
}

function operationTargetKey(targetType?: string, targetId?: string) {
  return `${targetType ?? ""}:${targetId ?? ""}`;
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
