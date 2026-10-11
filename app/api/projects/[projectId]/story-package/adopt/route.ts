import { z } from "zod";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { adoptStoryPackage } from "@/lib/production/story-package-adoption";

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const parsed = z
    .object({ deliverableId: z.string().min(1) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return attachSessionCookie(
      Response.json({ message: "请选择策划包" }, { status: 400 }),
      sessionId,
    );
  try {
    const result = await adoptStoryPackage({
      userId: user.id,
      projectId,
      ...parsed.data,
    });
    return attachSessionCookie(Response.json(result), sessionId);
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        { message: error instanceof Error ? error.message : "采用失败" },
        { status: 400 },
      ),
      sessionId,
    );
  }
}
