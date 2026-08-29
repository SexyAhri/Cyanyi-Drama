import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { isProjectArtStyleId } from "@/lib/projects/art-style";
import { prisma } from "@/lib/server/prisma";
import { getProject } from "@/lib/projects/queries";

type RouteContext = { params: Promise<{ projectId: string }> };
const fields = ["analysisModel", "characterModel", "locationModel", "storyboardModel", "editModel", "videoModel", "audioModel", "videoRatio", "videoResolution", "artStyle", "ttsRate", "workflowMode", "globalAssetText", "capabilityOverrides"] as const;

export async function GET(_request: Request, context: RouteContext) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const project = await getProject(user.id, projectId);
  if (!project) return attachSessionCookie(Response.json({ message: "项目不存在" }, { status: 404 }), sessionId);
  return attachSessionCookie(Response.json({ config: project.config }), sessionId);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  if (!(await prisma.project.count({ where: { id: projectId, userId: user.id } }))) return attachSessionCookie(Response.json({ message: "项目不存在" }, { status: 404 }), sessionId);
  const body = await readJson(request);
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    if (body[field] === undefined) continue;
    if (field === "artStyle" && !isProjectArtStyleId(body[field]))
      return attachSessionCookie(
        Response.json({ message: "不支持的项目画风" }, { status: 400 }),
        sessionId,
      );
    if (field === "capabilityOverrides") {
      if (body[field] !== null && (!body[field] || typeof body[field] !== "object" || Array.isArray(body[field]))) return attachSessionCookie(Response.json({ message: "capabilityOverrides 格式不正确" }, { status: 400 }), sessionId);
      data.capabilityOverridesJson = body[field] === null ? null : JSON.stringify(body[field]);
      continue;
    }
    data[field] = body[field] === null ? null : String(body[field]);
  }
  if (Object.keys(data).length) await prisma.projectConfig.update({ where: { projectId }, data });
  const project = await getProject(user.id, projectId);
  return attachSessionCookie(Response.json({ project, config: project?.config }), sessionId);
}

async function readJson(request: Request) {
  try { const value: unknown = await request.json(); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; }
}
