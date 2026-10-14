import { listUsageCosts } from "@/lib/billing/service";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export async function GET(request: Request) {
  const { user, sessionId } = await ensureAnonymousUser();
  const params = new URL(request.url).searchParams;
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(params.get("limit") ?? 20)) || 20));
  const cursorToken = params.get("cursor");
  let cursor: { createdAt: Date; id: string } | undefined;
  if (cursorToken) {
    try {
      const decoded = JSON.parse(Buffer.from(cursorToken, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
      const createdAt = typeof decoded.createdAt === "string" ? new Date(decoded.createdAt) : new Date(Number.NaN);
      if (!Number.isFinite(createdAt.getTime()) || typeof decoded.id !== "string" || !decoded.id || decoded.id.length > 191)
        throw new Error("invalid cursor");
      cursor = { createdAt, id: decoded.id };
    } catch {
      return attachSessionCookie(Response.json({ message: "费用记录游标无效" }, { status: 400 }), sessionId);
    }
  }
  const page = await listUsageCosts(
    user.id,
    params.get("projectId") ?? undefined,
    limit,
    cursor,
  );
  const last = page.costs.at(-1);
  const nextCursor = page.hasMore && last
    ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString("base64url")
    : null;
  return attachSessionCookie(Response.json({
    costs: page.costs.map(cost => ({ ...cost, quantity: Number(cost.quantity) })),
    nextCursor,
    summary: {
      total: page.summary._sum.cost?.toString() ?? "0",
      quantity: Number(page.summary._sum.quantity ?? 0),
      count: page.summary._count._all,
    },
  }), sessionId);
}
