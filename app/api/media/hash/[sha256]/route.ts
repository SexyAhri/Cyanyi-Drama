import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { resolveStoredMediaUrl } from "@/lib/storage";

type Context = { params: Promise<{ sha256: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { sha256 } = await context.params;
  const media = await prisma.mediaHash.findUnique({ where: { sha256 } });
  if (!media)
    return attachSessionCookie(
      Response.json({ message: "媒体不存在" }, { status: 404 }),
      sessionId,
    );
  const owned = await prisma.mediaAsset.count({
    where: { storageKey: media.storageKey, task: { userId: user.id } },
  });
  if (!owned)
    return attachSessionCookie(
      Response.json({ message: "媒体不存在" }, { status: 404 }),
      sessionId,
    );
  const url = await resolveStoredMediaUrl(media.storageKey);
  return attachSessionCookie(
    Response.json({
      media: {
        ...media,
        sizeBytes: media.sizeBytes?.toString() ?? null,
        url,
      },
    }),
    sessionId,
  );
}
