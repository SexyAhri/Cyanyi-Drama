import { z } from "zod";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  startEpisodeProductionWorkflow,
  type EpisodeProductionOperation,
} from "./agent-production-actions";
import { studioProductionOptionsSchema } from "./production-input";

const requestSchema = z.object({
  channelId: z.string().trim().min(1),
  model: z.string().trim().min(1),
  locale: z.enum(["zh", "en"]).default("zh"),
  options: studioProductionOptionsSchema.optional(),
});

export async function submitEpisodeProductionRequest(
  request: Request,
  context: { params: Promise<{ projectId: string; episodeId: string }> },
  operation: EpisodeProductionOperation,
) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return attachSessionCookie(
      Response.json({ message: "请选择文本模型" }, { status: 400 }),
      sessionId,
    );
  try {
    const result = await startEpisodeProductionWorkflow({
      ...parsed.data,
      operation,
      userId: user.id,
      projectId,
      targetId: episodeId,
    });
    return attachSessionCookie(Response.json(result, { status: result.reused ? 200 : 202 }), sessionId);
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        { message: error instanceof Error ? error.message : "启动制作失败" },
        { status: 400 },
      ),
      sessionId,
    );
  }
}
