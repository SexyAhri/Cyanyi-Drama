import { revertGlobalImage } from "@/lib/assets/global-store";
import { assetError, readJsonObject, stringValue } from "@/lib/assets/http";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export async function POST(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  try {
    const body = await readJsonObject(request);
    const kind = stringValue(body.kind);
    if (kind !== "character" && kind !== "location")
      throw new Error("GLOBAL_IMAGE_KIND_REQUIRED");
    const image = await revertGlobalImage(
      user.id,
      kind,
      stringValue(body.imageId),
    );
    return attachSessionCookie(
      image
        ? Response.json({ image })
        : Response.json({ message: "图片不存在" }, { status: 404 }),
      sessionId,
    );
  } catch (error) {
    return attachSessionCookie(assetError(error), sessionId);
  }
}
