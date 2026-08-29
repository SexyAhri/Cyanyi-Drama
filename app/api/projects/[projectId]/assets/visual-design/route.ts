import {
  generateProjectAssetVisualProfile,
  saveProjectAssetVisualProfile,
  type VisualDesignTargetType,
} from "@/lib/assets/visual-design";
import { ProjectAssetError } from "@/lib/assets/project-store";
import type { AssetVisualProfileSpec } from "@/lib/assets/visual-profile";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const targetType = visualTargetType(body.targetType);
  const targetId = stringValue(body.targetId);
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  if (!targetType || !targetId || !channelId || !model)
    return attachSessionCookie(
      Response.json(
        { message: "targetType、targetId、channelId 和 model 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  try {
    const result = await generateProjectAssetVisualProfile({
      userId: user.id,
      projectId,
      targetType,
      targetId,
      channelId,
      model,
      locale: body.locale === "en" ? "en" : "zh",
    });
    return attachSessionCookie(Response.json(result), sessionId);
  } catch (error) {
    return assetErrorResponse(error, sessionId);
  }
}

export async function PUT(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const targetType = visualTargetType(body.targetType);
  const targetId = stringValue(body.targetId);
  if (!targetType || !targetId || !isObject(body.spec))
    return attachSessionCookie(
      Response.json(
        { message: "targetType、targetId 和 spec 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  try {
    const profile = await saveProjectAssetVisualProfile({
      userId: user.id,
      projectId,
      targetType,
      targetId,
      spec: body.spec as AssetVisualProfileSpec,
    });
    return attachSessionCookie(Response.json({ profile }), sessionId);
  } catch (error) {
    return assetErrorResponse(error, sessionId);
  }
}

function assetErrorResponse(error: unknown, sessionId: string | null) {
  if (error instanceof ProjectAssetError)
    return attachSessionCookie(
      Response.json({ message: error.message }, { status: error.status }),
      sessionId,
    );
  throw error;
}

async function readObject(request: Request) {
  try {
    const value: unknown = await request.json();
    return isObject(value) ? value : {};
  } catch {
    return {};
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function visualTargetType(value: unknown): VisualDesignTargetType | undefined {
  return value === "character" || value === "location" || value === "prop"
    ? value
    : undefined;
}
