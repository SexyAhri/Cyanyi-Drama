import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  createVoiceLineAudioTask,
  VoiceTaskError,
} from "@/lib/media/voice-tasks";

type Context = {
  params: Promise<{ projectId: string; episodeId: string; lineId: string }>;
};

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId, lineId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const channelId =
    typeof body.channelId === "string" ? body.channelId.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!channelId || !model)
    return attachSessionCookie(
      Response.json(
        { message: "channelId 和 model 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  try {
    const result = await createVoiceLineAudioTask({
      userId: user.id,
      projectId,
      episodeId,
      lineId,
      channelId,
      model,
      voice: typeof body.voice === "string" ? body.voice.trim() : undefined,
    });
    return attachSessionCookie(
      Response.json(result, { status: 202 }),
      sessionId,
    );
  } catch (error) {
    if (error instanceof VoiceTaskError)
      return attachSessionCookie(
        Response.json({ message: error.message }, { status: error.status }),
        sessionId,
      );
    throw error;
  }
}
