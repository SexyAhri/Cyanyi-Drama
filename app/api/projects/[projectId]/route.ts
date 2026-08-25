import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  deleteProject,
  getProject,
  updateProject,
} from "@/lib/projects/queries";
import {
  normalizeProjectDraft,
  validateProjectDraft,
} from "@/lib/projects/validation";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const project = await getProject(user.id, projectId);
  if (!project)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(Response.json({ project }), sessionId);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const current = await getProject(user.id, projectId);
  if (!current)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  const body = await readJson(request);
  const draft = normalizeProjectDraft({
    name: typeof body.name === "string" ? body.name : current.name,
    description:
      body.description === null || typeof body.description === "string"
        ? body.description
        : current.description,
  });
  const issue = validateProjectDraft(draft);
  if (issue)
    return attachSessionCookie(
      Response.json({ message: issue.code }, { status: 400 }),
      sessionId,
    );
  const project = await updateProject(user.id, projectId, draft);
  return attachSessionCookie(Response.json({ project }), sessionId);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const current = await getProject(user.id, projectId);
  if (!current)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  await deleteProject(user.id, projectId);
  return attachSessionCookie(Response.json({ ok: true }), sessionId);
}

async function readJson(request: Request) {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
