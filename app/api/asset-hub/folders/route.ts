import {
  createGlobalFolder,
  listGlobalAssetHub,
} from "@/lib/assets/global-store";
import { assetError, readJsonObject, stringValue } from "@/lib/assets/http";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export async function GET() {
  const { user, sessionId } = await ensureAnonymousUser();
  const { folders } = await listGlobalAssetHub(user.id);
  return attachSessionCookie(Response.json({ folders }), sessionId);
}

export async function POST(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  try {
    const body = await readJsonObject(request);
    const folder = await createGlobalFolder(user.id, stringValue(body.name));
    return attachSessionCookie(
      Response.json({ folder }, { status: 201 }),
      sessionId,
    );
  } catch (error) {
    return attachSessionCookie(assetError(error), sessionId);
  }
}
