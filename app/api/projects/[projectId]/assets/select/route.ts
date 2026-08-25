import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  selectProjectAsset,
  type SelectableAssetType,
} from "@/lib/novel/asset-selection";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const targetType =
    body.targetType === "character" ||
    body.targetType === "location" ||
    body.targetType === "storyboard_panel"
      ? (body.targetType as SelectableAssetType)
      : null;
  const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";

  if (!targetType || !targetId) {
    return attachSessionCookie(
      Response.json(
        { message: "targetType 和 targetId 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  }

  const selected = await selectProjectAsset({
    userId: user.id,
    projectId,
    targetType,
    targetId,
  });
  if (!selected) {
    return attachSessionCookie(
      Response.json(
        { message: "资产不存在或尚未生成图片" },
        { status: 404 },
      ),
      sessionId,
    );
  }

  return attachSessionCookie(Response.json({ selected }), sessionId);
}

async function readObject(request: Request) {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
