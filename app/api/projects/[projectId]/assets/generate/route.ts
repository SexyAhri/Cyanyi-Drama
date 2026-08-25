import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  createProjectImageTask,
  ProjectAssetTaskError,
} from "@/lib/media/project-asset-tasks";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const targetType = body.targetType === "character" || body.targetType === "location" ? body.targetType : null;
  const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
  const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!targetType || !targetId || !channelId || !model || !prompt) return attachSessionCookie(Response.json({ message: "targetType、targetId、channelId、model 和 prompt 是必填项" }, { status: 400 }), sessionId);
  try {
    const result = await createProjectImageTask({
      userId: user.id,
      projectId,
      channelId,
      model,
      targetType,
      targetId,
      prompt,
      ratio: typeof body.ratio === "string" ? body.ratio : undefined,
      resolution: typeof body.resolution === "string" ? body.resolution : undefined,
      useSelectedReference: body.useSelectedReference === true,
    });
    return attachSessionCookie(Response.json(result, { status: 202 }), sessionId);
  } catch (error) {
    if (error instanceof ProjectAssetTaskError) {
      return attachSessionCookie(
        Response.json({ message: error.message }, { status: error.status }),
        sessionId,
      );
    }
    throw error;
  }
}
async function readObject(request: Request) { try { const value: unknown = await request.json(); return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; } }
