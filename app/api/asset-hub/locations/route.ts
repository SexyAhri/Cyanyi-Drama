import {
  createGlobalLocation,
  listGlobalAssetHub,
} from "@/lib/assets/global-store";
import { assetError, readJsonObject } from "@/lib/assets/http";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export async function GET(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const folderId =
    new URL(request.url).searchParams.get("folderId") ?? undefined;
  const { locations } = await listGlobalAssetHub(user.id, folderId);
  return attachSessionCookie(Response.json({ locations }), sessionId);
}

export async function POST(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  try {
    const location = await createGlobalLocation(
      user.id,
      await readJsonObject(request),
    );
    return attachSessionCookie(
      Response.json({ location }, { status: 201 }),
      sessionId,
    );
  } catch (error) {
    return attachSessionCookie(assetError(error), sessionId);
  }
}
