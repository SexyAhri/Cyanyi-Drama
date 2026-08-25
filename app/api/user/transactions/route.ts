import { listBalanceTransactions } from "@/lib/billing/service";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export async function GET(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 100);
  const transactions = await listBalanceTransactions(user.id, limit);
  return attachSessionCookie(Response.json({ transactions }), sessionId);
}
