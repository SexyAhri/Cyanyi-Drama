import {
  copyGlobalAssetToProject,
  type GlobalAssetKind,
} from "@/lib/assets/global-store";
import { assetError, readJsonObject, stringValue } from "@/lib/assets/http";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export async function POST(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  try {
    const body = await readJsonObject(request);
    const kind = stringValue(body.kind) as GlobalAssetKind;
    if (!(["character", "location", "voice"] as string[]).includes(kind))
      throw new Error("GLOBAL_ASSET_KIND_REQUIRED");
    const result = await copyGlobalAssetToProject(
      user.id,
      stringValue(body.projectId),
      kind,
      stringValue(body.assetId),
    );
    return attachSessionCookie(
      result
        ? Response.json(result, { status: 201 })
        : Response.json({ message: "资产或项目不存在" }, { status: 404 }),
      sessionId,
    );
  } catch (error) {
    return attachSessionCookie(assetError(error), sessionId);
  }
}
