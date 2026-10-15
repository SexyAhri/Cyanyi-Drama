import { listUsageRecords } from "@/lib/billing/usage-records-store";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export async function GET(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const result = await listUsageRecords(
    new URL(request.url).searchParams,
    user.id,
  );
  return attachSessionCookie(Response.json(result), sessionId);
}
