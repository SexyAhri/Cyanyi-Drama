import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { deleteEpisode, updateEpisode } from "@/lib/projects/queries";
import {
  normalizeEpisodeDraft,
  validateEpisodeDraft,
} from "@/lib/projects/validation";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await readJson(request);
  const update: {
    name?: string;
    description?: string | null;
    novelText?: string | null;
  } = {};
  if (typeof body.name === "string") {
    const draft = normalizeEpisodeDraft({ name: body.name });
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
    update.name = draft.name;
  }
  if (body.description === null || typeof body.description === "string")
    update.description =
      typeof body.description === "string"
        ? body.description.trim() || null
        : null;
  if (body.novelText === null || typeof body.novelText === "string")
    update.novelText =
      typeof body.novelText === "string" ? body.novelText.trim() || null : null;
  const episode = await updateEpisode(user.id, projectId, episodeId, update);
  if (!episode)
    return attachSessionCookie(
      Response.json({ message: "剧集不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(Response.json({ episode }), sessionId);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const deleted = await deleteEpisode(user.id, projectId, episodeId);
  if (!deleted)
    return attachSessionCookie(
      Response.json({ message: "剧集不存在" }, { status: 404 }),
      sessionId,
    );
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
