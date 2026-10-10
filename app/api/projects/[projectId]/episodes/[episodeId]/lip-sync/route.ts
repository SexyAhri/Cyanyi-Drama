import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createProductionTask, ProductionTaskError } from "@/lib/media/production-tasks";
import { prisma } from "@/lib/server/prisma";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  const panelId = stringValue(body.panelId);
  const audioAssetId = stringValue(body.audioAssetId);
  const voiceLineId = stringValue(body.voiceLineId);
  if (!channelId || !model || !panelId || !audioAssetId || !voiceLineId)
    return attachSessionCookie(Response.json({ message: "渠道、模型、镜头和配音行均为必填项" }, { status: 400 }), sessionId);
  const [panel, line, dialogueCount] = await Promise.all([
    prisma.storyboardPanel.findFirst({
      where: { id: panelId, storyboard: { projectId, episodeId, project: { userId: user.id } } },
      select: {
        id: true,
        speakingCharacter: true,
        lipSyncText: true,
        charactersJson: true,
        videoSegments: { select: { id: true } },
      },
    }),
    prisma.voiceLine.findFirst({
      where: { id: voiceLineId, episodeId, episode: { projectId, project: { userId: user.id } } },
      select: { speaker: true, content: true, delivery: true, matchedPanelId: true, audioAssetId: true },
    }),
    prisma.voiceLine.count({
      where: { episodeId, matchedPanelId: panelId, delivery: "dialogue" },
    }),
  ]);
  if (!panel || !line || line.delivery !== "dialogue" ||
      line.matchedPanelId !== panelId || line.audioAssetId !== audioAssetId)
    return attachSessionCookie(Response.json({ message: "配音行与镜头或音频不匹配，请先核对说话人和镜头" }, { status: 400 }), sessionId);
  const characters = parseCharacters(panel.charactersJson);
  if (panel.speakingCharacter !== line.speaker ||
      panel.lipSyncText?.trim() !== line.content.trim() ||
      !characters.includes(line.speaker))
    return attachSessionCookie(Response.json({ message: "镜头中的说话人或口型台词与配音行不一致，请先调整分镜" }, { status: 400 }), sessionId);
  if (dialogueCount !== 1)
    return attachSessionCookie(Response.json({ message: "同一镜头有多条对白，请先拆分镜头，避免口型覆盖错误角色" }, { status: 400 }), sessionId);
  if (panel.videoSegments.length > 1)
    return attachSessionCookie(Response.json({ message: "多段视频需先合成单镜视频后再做口型" }, { status: 400 }), sessionId);
  try {
    const task = await createProductionTask({
      userId: user.id,
      projectId,
      episodeId,
      kind: "video",
      targetType: "lip_sync",
      targetId: panelId,
      channelId,
      model,
      request: { operation: "lip_sync", panelId, voiceLineId, audioAssetId },
    });
    return attachSessionCookie(Response.json({ task }, { status: 202 }), sessionId);
  } catch (error) {
    if (error instanceof ProductionTaskError)
      return attachSessionCookie(Response.json({ message: error.message }, { status: error.status }), sessionId);
    throw error;
  }
}

function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

function parseCharacters(value: string | null) {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
