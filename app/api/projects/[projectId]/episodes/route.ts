import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createEpisode, listEpisodes } from "@/lib/projects/queries";
import {
  normalizeEpisodeDraft,
  validateEpisodeDraft,
} from "@/lib/projects/validation";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const episodes = await listEpisodes(user.id, projectId);
  if (!episodes)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(Response.json({ episodes }), sessionId);
}

export async function POST(request: Request, context: RouteContext) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readJson(request);
  const draft = normalizeEpisodeDraft({
    name: typeof body.name === "string" ? body.name : "",
    description: typeof body.description === "string" ? body.description : null,
    novelText: typeof body.novelText === "string" ? body.novelText : null,
  });
  const issue = validateEpisodeDraft(draft);
  if (issue)
    return attachSessionCookie(
      Response.json(
        {
          message:
            issue === "EPISODE_NAME_REQUIRED"
              ? "剧集名称不能为空"
              : "剧集名称不能超过 160 个字符",
        },
        { status: 400 },
      ),
      sessionId,
    );
  const episode = await createEpisode(user.id, projectId, draft);
  if (!episode)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(
    Response.json({ episode }, { status: 201 }),
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
