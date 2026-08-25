import { listGlobalAssetHub } from "@/lib/assets/global-store";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export async function GET(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const folderId =
    new URL(request.url).searchParams.get("folderId") ?? undefined;
  const assets = await listGlobalAssetHub(user.id, folderId);
  return attachSessionCookie(Response.json(assets), sessionId);
}
