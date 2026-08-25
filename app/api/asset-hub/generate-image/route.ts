import {
  createGlobalAssetImageTask,
  GlobalAssetTaskError,
} from "@/lib/media/global-asset-tasks";
import { readJsonObject, stringValue } from "@/lib/assets/http";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export async function POST(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const body = await readJsonObject(request);
  const kind = stringValue(body.kind);
  if (kind !== "character" && kind !== "location")
    return attachSessionCookie(
      Response.json({ message: "kind 必须是 character 或 location" }, { status: 400 }),
      sessionId,
    );
  try {
    const result = await createGlobalAssetImageTask({
      userId: user.id,
      kind,
      assetId: stringValue(body.assetId),
      channelId: stringValue(body.channelId),
      model: stringValue(body.model),
      prompt: stringValue(body.prompt),
      ratio: stringValue(body.ratio) || undefined,
      resolution: stringValue(body.resolution) || undefined,
      useSelectedReference: body.useSelectedReference === true,
    });
    return attachSessionCookie(Response.json(result, { status: 202 }), sessionId);
  } catch (error) {
    if (error instanceof GlobalAssetTaskError)
      return attachSessionCookie(
        Response.json({ message: error.message }, { status: error.status }),
        sessionId,
      );
    throw error;
  }
}
