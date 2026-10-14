import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { retryWorkflowStepAndEnqueue } from "@/lib/workflow/actions";

type Context = { params: Promise<{ runId: string; stepKey: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { runId, stepKey } = await context.params;
  const body = await request.json().catch(() => ({}));
  if (body.mode !== undefined && body.mode !== "continue") return attachSessionCookie(Response.json({ message: "续跑模式无效" }, { status: 400 }), sessionId);
  const workflow = await retryWorkflowStepAndEnqueue({
    runId,
    stepKey,
    userId: user.id,
    mode: body.mode === "continue" ? "continue" : undefined,
  });
  if (!workflow)
    return attachSessionCookie(
      Response.json(
        { message: "步骤不存在或当前状态不可重试" },
        { status: 409 },
      ),
      sessionId,
    );
  return attachSessionCookie(
    Response.json({ workflow }, { status: 202 }),
    sessionId,
  );
}
