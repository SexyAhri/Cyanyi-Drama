import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  extractProjectVisualAssets,
} from "@/lib/assets/visual-extraction";
import { ProjectAssetError } from "@/lib/assets/project-store";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const assetIds = stringArray(body.assetIds).slice(0, 10);
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  if (!assetIds.length || !channelId || !model)
    return attachSessionCookie(
      Response.json(
        { message: "assetIds、channelId 和 model 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  try {
    const result = await extractProjectVisualAssets({
      userId: user.id,
      projectId,
      assetIds,
      channelId,
      model,
      kindHint: stringValue(body.kindHint),
      locale: body.locale === "en" ? "en" : "zh",
      persist: body.persist === true,
    });
    return attachSessionCookie(Response.json(result), sessionId);
  } catch (error) {
    if (error instanceof ProjectAssetError)
      return attachSessionCookie(
        Response.json({ message: error.message }, { status: error.status }),
        sessionId,
      );
    throw error;
  }
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

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
    : [];
}
