import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  previewStoryboardPanelPrompt,
  ProjectAssetTaskError,
} from "@/lib/media/project-asset-tasks";

type Context = {
  params: Promise<{ projectId: string; episodeId: string; panelId: string }>;
};

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId, panelId } = await context.params;
  const body = await readObject(request);
  const kind = body.kind === "video" ? "video" : "image";
  const mode = body.mode === "first-last" ? "first-last" : "reference";
  try {
    const preview = await previewStoryboardPanelPrompt({
      userId: user.id,
      projectId,
      episodeId,
      panelId,
      kind,
      mode,
      prompt: stringValue(body.prompt) || undefined,
      lastFramePanelId: stringValue(body.lastFramePanelId) || undefined,
    });
    return attachSessionCookie(Response.json({ preview }), sessionId);
  } catch (error) {
    if (error instanceof ProjectAssetTaskError)
      return attachSessionCookie(
        Response.json({ message: error.message }, { status: error.status }),
        sessionId,
      );
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
