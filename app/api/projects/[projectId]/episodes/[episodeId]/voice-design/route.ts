import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  designEpisodeVoicePerformance,
  VoiceDesignError,
} from "@/lib/voice/design";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const channelId =
    typeof body.channelId === "string" ? body.channelId.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const locale = body.locale === "en" ? "en" : "zh";
  if (!channelId || !model)
    return attachSessionCookie(
      Response.json(
        { message: "channelId 和 model 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  try {
    const result = await designEpisodeVoicePerformance({
      userId: user.id,
      projectId,
      episodeId,
      channelId,
      model,
      locale,
    });
    return attachSessionCookie(Response.json(result), sessionId);
  } catch (error) {
    if (error instanceof VoiceDesignError)
      return attachSessionCookie(
        Response.json({ message: error.message }, { status: error.status }),
        sessionId,
      );
    throw error;
  }
}
