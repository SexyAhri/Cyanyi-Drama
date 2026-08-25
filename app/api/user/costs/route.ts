import { listUsageCosts } from "@/lib/billing/service";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export async function GET(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const params = new URL(request.url).searchParams;
  const costs = await listUsageCosts(
    user.id,
    params.get("projectId") ?? undefined,
    Number(params.get("limit") ?? 100),
  );
  return attachSessionCookie(Response.json({ costs }), sessionId);
}
