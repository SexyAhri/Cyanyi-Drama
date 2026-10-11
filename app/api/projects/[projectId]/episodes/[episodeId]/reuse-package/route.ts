import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { syncAdoptedPackageProduction } from "@/lib/production/story-package-production";

export async function POST(_request: Request, context: { params: Promise<{ projectId: string; episodeId: string }> }) {
  const { user, sessionId } = await ensureAnonymousUser();
  try {
    const result = await syncAdoptedPackageProduction({ ...await context.params, userId: user.id });
    return attachSessionCookie(Response.json(result), sessionId);
  } catch (error) {
    return attachSessionCookie(Response.json({ message: error instanceof Error ? error.message : "同步失败" },
      { status: 400 }), sessionId);
  }
}
