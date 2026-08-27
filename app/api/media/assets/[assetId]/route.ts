import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  deleteMediaAsset,
  MediaAssetActionError,
} from "@/lib/media/asset-actions";
import { prisma } from "@/lib/server/prisma";
import { resolveStoredMediaUrl } from "@/lib/storage";

type Context = { params: Promise<{ assetId: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { assetId } = await context.params;
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, task: { userId: user.id } },
  });
  if (!asset)
    return attachSessionCookie(
      Response.json({ message: "媒体资产不存在" }, { status: 404 }),
      sessionId,
    );
  const url = asset.storageKey
    ? await resolveStoredMediaUrl(asset.storageKey).catch(() => asset.url)
    : asset.url;
  return attachSessionCookie(
    Response.json({ asset: { ...asset, url } }),
    sessionId,
  );
}

export async function DELETE(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { assetId } = await context.params;
  try {
    await deleteMediaAsset({ assetId, userId: user.id });
    return attachSessionCookie(Response.json({ ok: true }), sessionId);
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        {
          message:
            error instanceof Error ? error.message : "Asset deletion failed.",
        },
        { status: error instanceof MediaAssetActionError ? error.status : 500 },
      ),
      sessionId,
    );
  }
}
