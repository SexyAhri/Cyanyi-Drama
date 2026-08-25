import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  createVoiceLineAudioTask,
  VoiceTaskError,
} from "@/lib/media/voice-tasks";
import { prisma } from "@/lib/server/prisma";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const channelId =
    typeof body.channelId === "string" ? body.channelId.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const requestedIds = Array.isArray(body.lineIds)
    ? body.lineIds
        .filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
        .map((id) => id.trim())
    : [];
  if (!channelId || !model)
    return attachSessionCookie(
      Response.json(
        { message: "channelId 和 model 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  const lines = await prisma.voiceLine.findMany({
    where: {
      episodeId,
      ...(requestedIds.length ? { id: { in: requestedIds } } : {}),
      episode: { projectId, project: { userId: user.id } },
    },
    orderBy: { lineIndex: "asc" },
    select: { id: true },
  });
  if (!lines.length)
    return attachSessionCookie(
      Response.json({ message: "没有可生成的台词" }, { status: 404 }),
      sessionId,
    );
  const results: Array<{ lineId: string; task: unknown }> = [];
  const failures: Array<{ lineId: string; message: string }> = [];
  for (const line of lines) {
    try {
      const result = await createVoiceLineAudioTask({
        userId: user.id,
        projectId,
        episodeId,
        lineId: line.id,
        channelId,
        model,
        voice: typeof body.voice === "string" ? body.voice.trim() : undefined,
      });
      results.push({ lineId: line.id, task: result.task });
    } catch (error) {
      failures.push({
        lineId: line.id,
        message:
          error instanceof VoiceTaskError
            ? error.message
            : error instanceof Error
              ? error.message
              : "语音任务提交失败",
      });
    }
  }
  return attachSessionCookie(
    Response.json(
      { count: results.length, results, failures },
      { status: results.length ? 202 : 400 },
    ),
    sessionId,
  );
}
