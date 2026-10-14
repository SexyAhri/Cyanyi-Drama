import { randomUUID } from "node:crypto";
import { z } from "zod";

import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), id: z.string().min(1) }),
  z.object({ action: z.literal("read_all") }),
  z.object({
    action: z.literal("preferences"),
    completedEnabled: z.boolean(),
    partialFailureEnabled: z.boolean(),
    actionRequiredEnabled: z.boolean(),
  }),
]);

export async function GET() {
  const { user, sessionId } = await ensureAnonymousUser();
  const [items, unreadCount, preference] = await Promise.all([
    prisma.executionNotification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        kind: true,
        titleZh: true,
        titleEn: true,
        bodyZh: true,
        bodyEn: true,
        href: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.executionNotification.count({ where: { userId: user.id, readAt: null } }),
    prisma.executionNotificationPreference.findUnique({ where: { userId: user.id } }),
  ]);
  return attachSessionCookie(Response.json({
    items,
    unreadCount,
    preferences: {
      completedEnabled: preference?.completedEnabled ?? true,
      partialFailureEnabled: preference?.partialFailureEnabled ?? true,
      actionRequiredEnabled: preference?.actionRequiredEnabled ?? true,
    },
  }), sessionId);
}

export async function PATCH(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return attachSessionCookie(Response.json({ message: "请求格式无效" }, { status: 400 }), sessionId);
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success)
    return attachSessionCookie(Response.json({ message: "通知设置或已读请求无效" }, { status: 400 }), sessionId);

  if (parsed.data.action === "read") {
    await prisma.executionNotification.updateMany({
      where: { id: parsed.data.id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  } else if (parsed.data.action === "read_all") {
    await prisma.executionNotification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  } else {
    await prisma.executionNotificationPreference.upsert({
      where: { userId: user.id },
      create: {
        id: randomUUID(),
        userId: user.id,
        completedEnabled: parsed.data.completedEnabled,
        partialFailureEnabled: parsed.data.partialFailureEnabled,
        actionRequiredEnabled: parsed.data.actionRequiredEnabled,
      },
      update: {
        completedEnabled: parsed.data.completedEnabled,
        partialFailureEnabled: parsed.data.partialFailureEnabled,
        actionRequiredEnabled: parsed.data.actionRequiredEnabled,
      },
    });
  }
  return attachSessionCookie(Response.json({ ok: true }), sessionId);
}
