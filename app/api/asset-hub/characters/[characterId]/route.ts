import {
  deleteGlobalCharacter,
  updateGlobalCharacter,
} from "@/lib/assets/global-store";
import { assetError, readJsonObject } from "@/lib/assets/http";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

type Context = { params: Promise<{ characterId: string }> };

export async function PATCH(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { characterId } = await context.params;
  try {
    const character = await updateGlobalCharacter(
      user.id,
      characterId,
      await readJsonObject(request),
    );
    return attachSessionCookie(
      character
        ? Response.json({ character })
        : Response.json({ message: "角色不存在" }, { status: 404 }),
      sessionId,
    );
  } catch (error) {
    return attachSessionCookie(assetError(error), sessionId);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { characterId } = await context.params;
  const deleted = await deleteGlobalCharacter(user.id, characterId);
  return attachSessionCookie(
    deleted
      ? Response.json({ deleted: true })
      : Response.json({ message: "角色不存在" }, { status: 404 }),
    sessionId,
  );
}
