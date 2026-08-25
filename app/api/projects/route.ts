import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createProject, listProjects } from "@/lib/projects/queries";
import {
  normalizeProjectDraft,
  validateProjectDraft,
} from "@/lib/projects/validation";

export async function GET(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const url = new URL(request.url);
  const page = clampInteger(url.searchParams.get("page"), 1, 1, 100000);
  const pageSize = clampInteger(url.searchParams.get("pageSize"), 12, 1, 100);
  const result = await listProjects(user.id, {
    page,
    pageSize,
    search: url.searchParams.get("search") ?? "",
  });
  return attachSessionCookie(
    Response.json({
      projects: result.projects,
      pagination: {
        page,
        pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / pageSize),
      },
    }),
    sessionId,
  );
}

export async function POST(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const body = await readJson(request);
  const draft = normalizeProjectDraft({
    name: typeof body.name === "string" ? body.name : "",
    description: typeof body.description === "string" ? body.description : null,
  });
  const issue = validateProjectDraft(draft);
  if (issue)
    return attachSessionCookie(
      Response.json(
        { message: projectIssueMessage(issue.code) },
        { status: 400 },
      ),
      sessionId,
    );
  const project = await createProject(user.id, draft);
  return attachSessionCookie(
    Response.json({ project }, { status: 201 }),
    sessionId,
  );
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

function clampInteger(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, min), max)
    : fallback;
}

function projectIssueMessage(code: string) {
  if (code === "PROJECT_NAME_REQUIRED") return "项目名称不能为空";
  if (code === "PROJECT_NAME_TOO_LONG") return "项目名称不能超过 100 个字符";
  return "项目描述不能超过 500 个字符";
}
