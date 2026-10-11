import { prisma } from "@/lib/server/prisma";
import { ensureAnonymousUser, attachSessionCookie } from "@/lib/server/auth";
import { ManuscriptNotesSchema } from "@/lib/episodes/manuscript-analysis";

export async function GET(request: Request, context: { params: Promise<{ projectId: string; manuscriptId: string }> }) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, manuscriptId } = await context.params;
  const ref = new URL(request.url).searchParams.get("ref");
  if (!ref || ref.length > 128) return Response.json({ message: "资料引用无效" }, { status: 400 });
  const row = await prisma.workflowArtifact.findFirst({ where: { refId: ref, artifactType: "manuscript.chunk",
    run: { userId: user.id, projectId, targetId: manuscriptId, targetType: "manuscript" } },
    orderBy: { createdAt: "desc" }, select: { payload: true } });
  const notes = ManuscriptNotesSchema.safeParse(row?.payload);
  return attachSessionCookie(notes.success ? Response.json({ notes: notes.data }) :
    Response.json({ message: "原文段落资料不存在" }, { status: 404 }), sessionId);
}
