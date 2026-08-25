import {
  deleteGlobalFolder,
  updateGlobalFolder,
} from "@/lib/assets/global-store";
import { assetError, readJsonObject, stringValue } from "@/lib/assets/http";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

type Context = { params: Promise<{ folderId: string }> };

export async function PATCH(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { folderId } = await context.params;
  try {
    const body = await readJsonObject(request);
    const folder = await updateGlobalFolder(
      user.id,
      folderId,
      stringValue(body.name),
    );
    return attachSessionCookie(
      folder
        ? Response.json({ folder })
        : Response.json({ message: "文件夹不存在" }, { status: 404 }),
      sessionId,
    );
  } catch (error) {
    return attachSessionCookie(assetError(error), sessionId);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { folderId } = await context.params;
  const deleted = await deleteGlobalFolder(user.id, folderId);
  return attachSessionCookie(
    deleted
      ? Response.json({ deleted: true })
      : Response.json({ message: "文件夹不存在" }, { status: 404 }),
    sessionId,
  );
}
