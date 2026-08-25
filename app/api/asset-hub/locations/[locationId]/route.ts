import {
  deleteGlobalLocation,
  updateGlobalLocation,
} from "@/lib/assets/global-store";
import { assetError, readJsonObject } from "@/lib/assets/http";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

type Context = { params: Promise<{ locationId: string }> };

export async function PATCH(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { locationId } = await context.params;
  try {
    const location = await updateGlobalLocation(
      user.id,
      locationId,
      await readJsonObject(request),
    );
    return attachSessionCookie(
      location
        ? Response.json({ location })
        : Response.json({ message: "场景不存在" }, { status: 404 }),
      sessionId,
    );
  } catch (error) {
    return attachSessionCookie(assetError(error), sessionId);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { locationId } = await context.params;
  const deleted = await deleteGlobalLocation(user.id, locationId);
  return attachSessionCookie(
    deleted
      ? Response.json({ deleted: true })
      : Response.json({ message: "场景不存在" }, { status: 404 }),
    sessionId,
  );
}
