import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { resolveStoredMediaUrl } from "@/lib/storage";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
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

  const rows = await prisma.mediaAsset.findMany({
    where: { task: { userId: user.id, projectId } },
    include: {
      references: {
        where: { projectId },
        select: { entityId: true, entityType: true, role: true },
      },
      task: {
        select: { status: true, targetId: true, targetType: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const assets = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      kind: row.kind,
      mimeType: row.mimeType,
      metadata: parseObject(row.metadataJson),
      references: row.references,
      sourceTargetId: row.task.targetId,
      sourceTargetType: row.task.targetType,
      taskStatus: row.task.status,
      url: row.storageKey
        ? await resolveStoredMediaUrl(row.storageKey).catch(() => row.url)
        : row.url,
      createdAt: row.createdAt.toISOString(),
    })),
  );

  return attachSessionCookie(Response.json({ assets }), sessionId);
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
