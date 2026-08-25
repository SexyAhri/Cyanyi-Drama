import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  getProductionProjectData,
  saveProductionClips,
  saveVoiceLines,
  saveEditorProject,
} from "@/lib/production/domain-store";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const data = await getProductionProjectData(user.id, projectId, episodeId);
  if (!data)
    return attachSessionCookie(
      Response.json({ message: "项目或剧集不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(Response.json(data), sessionId);
}

export async function PUT(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await readObject(request);
  if (Array.isArray(body.clips)) {
    const clips = body.clips.filter(isClip);
    const result = await saveProductionClips(
      user.id,
      projectId,
      episodeId,
      clips,
    );
    if (!result)
      return attachSessionCookie(
        Response.json({ message: "项目或剧集不存在" }, { status: 404 }),
        sessionId,
      );
  }
  if (Array.isArray(body.voiceLines)) {
    const lines = body.voiceLines.filter(isVoiceLine);
    const result = await saveVoiceLines(user.id, projectId, episodeId, lines);
    if (!result)
      return attachSessionCookie(
        Response.json({ message: "项目或剧集不存在" }, { status: 404 }),
        sessionId,
      );
  }
  if (
    body.timeline &&
    typeof body.timeline === "object" &&
    !Array.isArray(body.timeline)
  ) {
    const result = await saveEditorProject(
      user.id,
      projectId,
      episodeId,
      body.timeline as Record<string, unknown>,
      body.subtitles,
    );
    if (!result)
      return attachSessionCookie(
        Response.json({ message: "项目或剧集不存在" }, { status: 404 }),
        sessionId,
      );
  }
  const data = await getProductionProjectData(user.id, projectId, episodeId);
  return attachSessionCookie(Response.json(data), sessionId);
}

function isClip(
  value: unknown,
): value is Parameters<typeof saveProductionClips>[3][number] {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    Number.isInteger(item.clipIndex) &&
    typeof item.summary === "string" &&
    typeof item.content === "string" &&
    (item.shots === undefined ||
      (Array.isArray(item.shots) && item.shots.every(isShot)))
  );
}

function isShot(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return Number.isInteger(item.shotIndex);
}

function isVoiceLine(
  value: unknown,
): value is Parameters<typeof saveVoiceLines>[3][number] {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    Number.isInteger(item.lineIndex) &&
    typeof item.speaker === "string" &&
    typeof item.content === "string"
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
