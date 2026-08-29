import { activateEpisodeSource } from "@/lib/episodes/adaptation";
import { EpisodeSourceError } from "@/lib/episodes/errors";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

type Context = {
  params: Promise<{
    projectId: string;
    episodeId: string;
    sourceId: string;
  }>;
};

export async function POST(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId, sourceId } = await context.params;
  try {
    const source = await activateEpisodeSource({
      userId: user.id,
      projectId,
      episodeId,
      sourceId,
    });
    return attachSessionCookie(Response.json({ source }), sessionId);
  } catch (error) {
    if (error instanceof EpisodeSourceError)
      return attachSessionCookie(
        Response.json(
          { message: error.message, details: error.details },
          { status: error.status },
        ),
        sessionId,
      );
    throw error;
  }
}
