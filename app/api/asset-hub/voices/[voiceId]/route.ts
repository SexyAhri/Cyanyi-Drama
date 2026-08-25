import {
  deleteGlobalVoice,
  updateGlobalVoice,
} from "@/lib/assets/global-store";
import { assetError, readJsonObject } from "@/lib/assets/http";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

type Context = { params: Promise<{ voiceId: string }> };

export async function PATCH(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { voiceId } = await context.params;
  try {
    const voice = await updateGlobalVoice(
      user.id,
      voiceId,
      await readJsonObject(request),
    );
    return attachSessionCookie(
      voice
        ? Response.json({ voice })
        : Response.json({ message: "音色不存在" }, { status: 404 }),
      sessionId,
    );
  } catch (error) {
    return attachSessionCookie(assetError(error), sessionId);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { voiceId } = await context.params;
  const deleted = await deleteGlobalVoice(user.id, voiceId);
  return attachSessionCookie(
    deleted
      ? Response.json({ deleted: true })
      : Response.json({ message: "音色不存在" }, { status: 404 }),
    sessionId,
  );
}
