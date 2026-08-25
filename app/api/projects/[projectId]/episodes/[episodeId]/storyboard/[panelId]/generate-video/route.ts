import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  createStoryboardPanelVideoTask,
  ProjectAssetTaskError,
} from "@/lib/media/project-asset-tasks";

type Context = {
  params: Promise<{ projectId: string; episodeId: string; panelId: string }>;
};

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId, panelId } = await context.params;
  const body = await readObject(request);
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  if (!channelId || !model) {
    return attachSessionCookie(
      Response.json({ message: "channelId 和 model 是必填项" }, { status: 400 }),
      sessionId,
    );
  }
  try {
    const result = await createStoryboardPanelVideoTask({
      userId: user.id,
      projectId,
      episodeId,
      panelId,
      channelId,
      model,
      prompt: stringValue(body.prompt) || undefined,
      ratio: stringValue(body.ratio) || undefined,
      resolution: stringValue(body.resolution) || undefined,
      duration: stringValue(body.duration) || undefined,
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

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
