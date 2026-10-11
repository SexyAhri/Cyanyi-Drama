import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { mediaAssetContentUrl } from "@/lib/media/public-media";
import { prisma } from "@/lib/server/prisma";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const ownsProject = await prisma.project.count({
    where: { id: projectId, userId: user.id },
  });
  if (!ownsProject) {
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  }

  const cursor = new URL(request.url).searchParams.get("cursor");
  const rows = await prisma.mediaAsset.findMany({
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    where: { task: { userId: user.id, projectId } },
    select: {
      id: true,
      kind: true,
      mimeType: true,
      metadataJson: true,
      createdAt: true,
      references: {
        where: { projectId },
        select: { entityId: true, entityType: true, role: true },
      },
      task: {
        select: { status: true, targetId: true, targetType: true },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 501,
  });
  const assets = rows.slice(0, 500).map((row) => ({
      id: row.id,
      kind: row.kind,
      mimeType: row.mimeType,
      metadata: parseObject(row.metadataJson),
      references: row.references,
      sourceTargetId: row.task.targetId,
      sourceTargetType: row.task.targetType,
      taskStatus: row.task.status,
      url: mediaAssetContentUrl(row.id),
      createdAt: row.createdAt.toISOString(),
    }));

  return attachSessionCookie(Response.json({ assets, nextCursor: rows.length > 500 ? rows[499].id : null }), sessionId);
}

function parseObject(value: string | null) {
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
