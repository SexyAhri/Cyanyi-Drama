import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  approveProductionDeliverablesBatch,
  ProductionDeliverableError,
} from "@/lib/production/deliverables";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || body.action !== "approve_all" || !isIds(body.ids))
    return attachSessionCookie(
      Response.json(
        { message: "PRODUCTION_BATCH_INPUT_INVALID" },
        { status: 400 },
      ),
      sessionId,
    );
  try {
    const deliverables = await approveProductionDeliverablesBatch(
      user.id,
      projectId,
      body.ids,
    );
    return attachSessionCookie(Response.json({ deliverables }), sessionId);
  } catch (error) {
    const known = error instanceof ProductionDeliverableError;
    return attachSessionCookie(
      Response.json(
        { message: known ? error.message : "PRODUCTION_BATCH_FAILED" },
        { status: known ? error.status : 500 },
      ),
      sessionId,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 100 &&
    value.every((id) => typeof id === "string" && Boolean(id.trim()))
  );
}
