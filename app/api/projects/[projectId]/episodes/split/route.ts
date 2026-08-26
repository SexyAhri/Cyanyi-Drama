import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  detectEpisodeMarkers,
  EpisodeSplitError,
  persistEpisodeSplits,
  splitEpisodesWithAi,
} from "@/lib/episodes/split";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const content = stringValue(body.content) ?? "";
  if (content.length < 100 || content.length > 2_000_000)
    return attachSessionCookie(
      Response.json(
        { message: "整本小说长度必须在 100 到 2,000,000 字符之间" },
        { status: 400 },
      ),
      sessionId,
    );
  const mode = body.mode === "markers" || body.mode === "ai" ? body.mode : "auto";
  try {
    const markers = detectEpisodeMarkers(content);
    let method: "markers" | "ai";
    let episodes;
    let trace;
    if (mode !== "ai" && markers.hasMarkers) {
      method = "markers";
      episodes = markers.episodes;
    } else {
      if (mode === "markers")
        throw new EpisodeSplitError("没有检测到至少两个可靠分集标记");
      const channelId = stringValue(body.channelId);
      const model = stringValue(body.model);
      if (!channelId || !model)
        throw new EpisodeSplitError("AI 分集需要 channelId 和 model");
      method = "ai";
      const result = await splitEpisodesWithAi({
        userId: user.id,
        projectId,
        content,
        channelId,
        model,
        locale: body.locale === "en" ? "en" : "zh",
      });
      episodes = result.episodes;
      trace = result.trace;
    }
    const persisted = body.persist === true
      ? await persistEpisodeSplits({
          userId: user.id,
          projectId,
          episodes,
        })
      : null;
    return attachSessionCookie(
      Response.json({
        method,
        markerType: method === "markers" ? markers.markerType : null,
        confidence: method === "markers" ? markers.confidence : null,
        episodes,
        persisted,
        trace: trace ?? null,
      }),
      sessionId,
    );
  } catch (error) {
    if (error instanceof EpisodeSplitError)
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
  return typeof value === "string" ? value : undefined;
}
