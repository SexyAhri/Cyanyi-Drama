import { randomUUID } from "node:crypto";

import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const presets = await prisma.voicePreset.findMany({
    where: { userId: user.id, OR: [{ projectId }, { projectId: null }] },
    orderBy: { updatedAt: "desc" },
  });
  return attachSessionCookie(Response.json({ presets }), sessionId);
}

export async function PUT(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name)
    return attachSessionCookie(
      Response.json({ message: "name 是必填项" }, { status: 400 }),
      sessionId,
    );
  const ownsProject = await prisma.project.count({
    where: { id: projectId, userId: user.id },
  });
  if (!ownsProject)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  const preset = await prisma.voicePreset.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      projectId,
      name,
      providerVoiceId:
        typeof body.providerVoiceId === "string"
          ? body.providerVoiceId.trim() || null
          : null,
      language:
        typeof body.language === "string" ? body.language.trim() || null : null,
      gender:
        typeof body.gender === "string" ? body.gender.trim() || null : null,
      description:
        typeof body.description === "string"
          ? body.description.trim() || null
          : null,
    },
  });
  return attachSessionCookie(
    Response.json({ preset }, { status: 201 }),
    sessionId,
  );
}
