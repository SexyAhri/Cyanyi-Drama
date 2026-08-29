import {
  adaptEpisodeSource,
  listEpisodeSources,
  type EpisodeAdaptationMode,
} from "@/lib/episodes/adaptation";
import { EpisodeSourceError, EpisodeSplitError } from "@/lib/episodes/errors";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

type Context = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  try {
    const result = await listEpisodeSources({ userId: user.id, projectId, episodeId });
    return attachSessionCookie(Response.json(result), sessionId);
  } catch (error) {
    return sourceErrorResponse(error, sessionId);
  }
}

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await readObject(request);
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  const mode = adaptationMode(body.mode);
  if (!channelId || !model || !mode)
    return attachSessionCookie(
      Response.json({ message: "改编模式、渠道和模型不能为空" }, { status: 400 }),
      sessionId,
    );
  try {
    const source = await adaptEpisodeSource({
      userId: user.id,
      projectId,
      episodeId,
      channelId,
      model,
      mode,
      instructions: stringValue(body.instructions),
      locale: body.locale === "en" ? "en" : "zh",
    });
    return attachSessionCookie(Response.json({ source }, { status: 201 }), sessionId);
  } catch (error) {
    return sourceErrorResponse(error, sessionId);
  }
}

function adaptationMode(value: unknown): EpisodeAdaptationMode | null {
  return value === "faithful" ||
    value === "polish" ||
    value === "drama" ||
    value === "custom"
    ? value
    : null;
}

function sourceErrorResponse(error: unknown, sessionId: string | null) {
  if (error instanceof EpisodeSourceError)
    return attachSessionCookie(
      Response.json(
        { message: error.message, details: error.details },
        { status: error.status },
      ),
      sessionId,
    );
  if (error instanceof EpisodeSplitError)
    return attachSessionCookie(
      Response.json({ message: error.message }, { status: error.status }),
      sessionId,
    );
  throw error;
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
  return typeof value === "string" ? value : undefined;
}
