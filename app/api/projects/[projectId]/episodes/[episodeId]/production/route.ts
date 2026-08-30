import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  getProductionProjectData,
  saveProductionClips,
  saveVoiceLines,
  saveEditorProject,
  updateVoiceLine,
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

export async function PATCH(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await readObject(request);
  const lineId = typeof body.lineId === "string" ? body.lineId.trim() : "";
  if (!lineId) {
    return attachSessionCookie(
      Response.json({ message: "lineId 是必填项" }, { status: 400 }),
      sessionId,
    );
  }
  try {
    const voiceLine = await updateVoiceLine(
      user.id,
      projectId,
      episodeId,
      lineId,
      {
        speaker:
          typeof body.speaker === "string" ? body.speaker : undefined,
        content:
          typeof body.content === "string" ? body.content : undefined,
        voicePresetId:
          body.voicePresetId === null || typeof body.voicePresetId === "string"
            ? body.voicePresetId
            : undefined,
        voiceProfilePrompt:
          body.voiceProfilePrompt === null ||
          typeof body.voiceProfilePrompt === "string"
            ? body.voiceProfilePrompt
            : undefined,
        emotionPrompt:
          body.emotionPrompt === null || typeof body.emotionPrompt === "string"
            ? body.emotionPrompt
            : undefined,
        emotionStrength:
          body.emotionStrength === null ||
          (typeof body.emotionStrength === "number" &&
            Number.isFinite(body.emotionStrength))
            ? body.emotionStrength
            : undefined,
        optimizeInstructions:
          typeof body.optimizeInstructions === "boolean"
            ? body.optimizeInstructions
            : undefined,
        matchedPanelId:
          body.matchedPanelId === null || typeof body.matchedPanelId === "string"
            ? body.matchedPanelId
            : undefined,
      },
    );
    if (!voiceLine) {
      return attachSessionCookie(
        Response.json(
          { message: "台词、音色或关联镜头不存在" },
          { status: 404 },
        ),
        sessionId,
      );
    }
    return attachSessionCookie(Response.json({ voiceLine }), sessionId);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "VOICE_LINE_SPEAKER_REQUIRED" ||
        error.message === "VOICE_LINE_CONTENT_REQUIRED")
    ) {
      return attachSessionCookie(
        Response.json({ message: error.message }, { status: 400 }),
        sessionId,
      );
    }
    throw error;
  }
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
