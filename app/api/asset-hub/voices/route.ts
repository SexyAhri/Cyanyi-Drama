import {
  createGlobalVoice,
  listGlobalAssetHub,
} from "@/lib/assets/global-store";
import { assetError, readJsonObject } from "@/lib/assets/http";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export async function GET(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const folderId =
    new URL(request.url).searchParams.get("folderId") ?? undefined;
  const { voices } = await listGlobalAssetHub(user.id, folderId);
  return attachSessionCookie(Response.json({ voices }), sessionId);
}

export async function POST(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  try {
    const voice = await createGlobalVoice(
      user.id,
      await readJsonObject(request),
    );
    return attachSessionCookie(
      Response.json({ voice }, { status: 201 }),
      sessionId,
    );
  } catch (error) {
    return attachSessionCookie(assetError(error), sessionId);
  }
}
