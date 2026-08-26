import { getExecutionTrace } from "@/lib/observability/trace-store";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

type Context = { params: Promise<{ traceId: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { traceId } = await context.params;
  const trace = await getExecutionTrace(user.id, traceId);
  if (!trace)
    return attachSessionCookie(
      Response.json({ message: "Trace 不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(Response.json({ trace }), sessionId);
}
