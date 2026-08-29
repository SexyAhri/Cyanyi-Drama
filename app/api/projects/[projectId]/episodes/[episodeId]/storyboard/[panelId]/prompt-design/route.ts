import {
  designStoryboardMediaPrompt,
  StoryboardPromptDesignError,
} from "@/lib/media/storyboard-prompt-design";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

type Context = {
  params: Promise<{ projectId: string; episodeId: string; panelId: string }>;
};

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId, panelId } = await context.params;
  const body = await readObject(request);
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  if (!channelId || !model)
    return attachSessionCookie(
      Response.json({ message: "channelId 和 model 是必填项" }, { status: 400 }),
      sessionId,
    );
  try {
    const result = await designStoryboardMediaPrompt({
      userId: user.id,
      projectId,
      episodeId,
      panelId,
      channelId,
      model,
      kind: body.kind === "video" ? "video" : "image",
      mode: body.mode === "first-last" ? "first-last" : "reference",
      currentPrompt: stringValue(body.currentPrompt) || undefined,
      locale: body.locale === "en" ? "en" : "zh",
    });
    return attachSessionCookie(Response.json(result), sessionId);
  } catch (error) {
    if (error instanceof StoryboardPromptDesignError)
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
