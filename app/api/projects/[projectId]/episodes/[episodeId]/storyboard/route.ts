import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { getStoryboard, saveStoryboard } from "@/lib/novel/domain-store";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const storyboard = await getStoryboard(user.id, projectId, episodeId);
  return attachSessionCookie(Response.json({ storyboard }), sessionId);
}

export async function PUT(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await readObject(request);
  const panels = Array.isArray(body.panels)
    ? body.panels.filter(isPanelInput)
    : [];
  const storyboard = await saveStoryboard(user.id, projectId, episodeId, {
    status: typeof body.status === "string" ? body.status : undefined,
    sourceHash: typeof body.sourceHash === "string" ? body.sourceHash : null,
    panels,
  });
  if (!storyboard)
    return attachSessionCookie(
      Response.json({ message: "剧集不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(Response.json({ storyboard }), sessionId);
}

function isPanelInput(value: unknown): value is {
  panelIndex: number;
  shotType?: string | null;
  cameraMove?: string | null;
  description?: string | null;
  locationName?: string | null;
  characters?: string[];
  props?: string[];
  imagePrompt?: string | null;
  videoPrompt?: string | null;
} {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.panelIndex === "number" && Number.isInteger(item.panelIndex)
  );
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
