import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  createVoiceLineAudioTask,
  VoiceTaskError,
} from "@/lib/media/voice-tasks";
import { prisma } from "@/lib/server/prisma";
import { synchronizeConfiguredVoiceLines } from "@/lib/media/configured-voice-lines";
import { productionRequestErrorStatus } from "@/lib/production-configuration/execution";
import { submitBatchItems } from "@/lib/media/batch-submission";

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
  let requestedIds = Array.isArray(body.lineIds)
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
  if (body.configuredSpeech === true) {
    try { requestedIds = await synchronizeConfiguredVoiceLines(user.id, projectId, episodeId); }
    catch (error) { return attachSessionCookie(Response.json({ message: error instanceof Error ? error.message : "配置台词读取失败" }, { status: productionRequestErrorStatus(error) ?? 409 }), sessionId); }
    if (!requestedIds.length) return attachSessionCookie(Response.json({ message: "没有启用的配置台词，请先在镜头制作配置中确认内容并发布" }, { status: 400 }), sessionId);
  }
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
  const submitted = await submitBatchItems(
    lines,
    async (line) => createVoiceLineAudioTask({
        userId: user.id,
        projectId,
        episodeId,
        lineId: line.id,
        channelId,
        model,
        voice: typeof body.voice === "string" ? body.voice.trim() : undefined,
      }),
    (error) =>
      error instanceof VoiceTaskError
        ? error.message
        : error instanceof Error
          ? error.message
          : "语音任务提交失败",
  );
  const results = submitted.results.map(({ item, value }) => ({ lineId: item.id, task: value.task }));
  return attachSessionCookie(
    Response.json(
      {
        ...(results.length === 0 && submitted.failures.length
          ? { message: submitted.failures[0].message }
          : {}),
        count: results.length,
        results,
        failures: submitted.failures.map(({ item, message }) => ({ lineId: item.id, message })),
        summary: submitted.summary,
      },
      { status: results.length ? 202 : 400 },
    ),
    sessionId,
  );
}
