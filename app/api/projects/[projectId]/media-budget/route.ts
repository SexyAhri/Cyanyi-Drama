import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { getMediaBudgetSummary, MediaBudgetError, setMediaBudgetLimit } from "@/lib/billing/media-budget";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const search = new URL(request.url).searchParams;
  const batchId = search.get("batchId")?.trim();
  try {
    const summary = await getMediaBudgetSummary({ userId: user.id, projectId, scope: batchId ? { type: "batch", id: batchId } : { type: "project", id: projectId } });
    return attachSessionCookie(Response.json({ summary }), sessionId);
  } catch (error) {
    return errorResponse(error, sessionId);
  }
}

export async function PUT(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const batchId = stringValue(body.batchId);
  if (body.limit !== null && typeof body.limit !== "number" && typeof body.limit !== "string") {
    return attachSessionCookie(Response.json({ message: "预算必须是非负数字或 null" }, { status: 400 }), sessionId);
  }
  if (typeof body.limit === "number" && (!Number.isFinite(body.limit) || body.limit < 0)) {
    return attachSessionCookie(Response.json({ message: "预算必须是非负数字" }, { status: 400 }), sessionId);
  }
  if (typeof body.limit === "string" && (!/^\d+(\.\d{1,6})?$/.test(body.limit) || body.limit.length > 32)) {
    return attachSessionCookie(Response.json({ message: "预算格式无效" }, { status: 400 }), sessionId);
  }
  try {
    const summary = await setMediaBudgetLimit({
      userId: user.id,
      projectId,
      scope: batchId ? { type: "batch", id: batchId } : { type: "project", id: projectId },
      limit: body.limit as number | string | null,
    });
    return attachSessionCookie(Response.json({ summary }), sessionId);
  } catch (error) {
    return errorResponse(error, sessionId);
  }
}

function errorResponse(error: unknown, sessionId: string | null) {
  return attachSessionCookie(Response.json({ message: error instanceof MediaBudgetError ? error.code : "BILLING_MEDIA_BUDGET_FAILED" }, { status: error instanceof MediaBudgetError ? error.status : 500 }), sessionId);
}

function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

async function readObject(request: Request) {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}
