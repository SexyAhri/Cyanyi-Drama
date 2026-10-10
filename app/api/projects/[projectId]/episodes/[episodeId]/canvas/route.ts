import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };
const coordinate = z.number().finite().min(-1000000).max(1000000);
const schema = z.object({
  revision: z.number().int().min(0),
  document: z.object({
    nodes: z.array(z.object({
      id: z.string().min(1).max(100), kind: z.enum(["text", "panel", "image", "video"]),
      title: z.string().max(300), text: z.string().max(30000), x: coordinate, y: coordinate,
      videoText: z.string().max(30000).optional(),
      panelId: z.string().max(100).optional(), assetId: z.string().max(100).optional(),
    })).max(1000),
    edges: z.array(z.object({ id: z.string().max(100), from: z.string().max(100), to: z.string().max(100) })).max(3000),
    viewport: z.object({ x: coordinate, y: coordinate, k: z.number().min(0.05).max(5) }),
  }),
});

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const episode = await prisma.episode.findFirst({ where: { id: episodeId, projectId, project: { userId: user.id } } });
  if (!episode) return attachSessionCookie(Response.json({ message: "剧集不存在" }, { status: 404 }), sessionId);
  const canvas = await prisma.creativeCanvas.findUnique({ where: { episodeId } });
  return attachSessionCookie(Response.json({ document: canvas?.document ?? null, revision: canvas?.revision ?? 0 }), sessionId);
}

export async function PUT(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const episode = await prisma.episode.findFirst({ where: { id: episodeId, projectId, project: { userId: user.id } } });
  const reply = (body: object, status = 200) => attachSessionCookie(Response.json(body, { status }), sessionId);
  if (!episode) return reply({ message: "剧集不存在" }, 404);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply({ message: "画布数据无效或超出限制" }, 400);
  const { document, revision } = input.data;
  const ids = new Set(document.nodes.map(node => node.id));
  if (ids.size !== document.nodes.length || new Set(document.edges.map(edge => edge.id)).size !== document.edges.length || document.edges.some(edge => !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to)) return reply({ message: "节点或连线数据无效" }, 400);
  await prisma.creativeCanvas.upsert({ where: { episodeId }, create: { episodeId, document: { nodes: [], edges: [], viewport: { x: 40, y: 40, k: 1 } } }, update: {} });
  const result = await prisma.creativeCanvas.updateMany({ where: { episodeId, revision }, data: { document, revision: { increment: 1 } } });
  if (!result.count) return reply({ message: "画布已在其他页面更新，请导出当前画布后重新加载" }, 409);
  return reply({ revision: revision + 1 });
}
