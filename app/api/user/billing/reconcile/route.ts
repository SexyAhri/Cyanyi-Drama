import { reconcilePendingMediaCharges } from "@/lib/billing/service";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export async function POST() {
  const { user, sessionId } = await ensureAnonymousUser();
  const report = await reconcilePendingMediaCharges({ userId: user.id });
  return attachSessionCookie(Response.json({ report }), sessionId);
}
