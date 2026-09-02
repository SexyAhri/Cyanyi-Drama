import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { decodeInlineMediaUrl } from "@/lib/media/public-media";
import { prisma } from "@/lib/server/prisma";
import { readStoredObject } from "@/lib/storage";

type Context = { params: Promise<{ assetId: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { assetId } = await context.params;
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, task: { userId: user.id } },
    select: { storageKey: true, url: true, mimeType: true },
  });
  if (!asset)
    return attachSessionCookie(
      Response.json({ message: "媒体资产不存在" }, { status: 404 }),
      sessionId,
    );

  if (asset.storageKey) {
    const bytes = await readStoredObject(asset.storageKey).catch(() => null);
    if (bytes)
      return attachSessionCookie(
        mediaResponse(bytes, asset.mimeType),
        sessionId,
      );
  }

  const inline = asset.url ? decodeInlineMediaUrl(asset.url) : null;
  if (inline)
    return attachSessionCookie(
      mediaResponse(inline.bytes, asset.mimeType ?? inline.mimeType),
      sessionId,
    );
  if (asset.url?.startsWith("http://") || asset.url?.startsWith("https://"))
    return Response.redirect(asset.url, 307);

  return attachSessionCookie(
    Response.json({ message: "媒体内容不存在" }, { status: 404 }),
    sessionId,
  );
}

function mediaResponse(bytes: Uint8Array, mimeType: string | null) {
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(bytes.byteLength),
      "Content-Type": mimeType?.trim() || "application/octet-stream",
    },
  });
}
