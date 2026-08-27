import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { getWorkflowRun } from "@/lib/workflow/store";
import {
  controlWorkflowRun,
  deleteWorkflowRun,
  WorkflowActionError,
  type WorkflowAction,
} from "@/lib/workflow/actions";

type Context = { params: Promise<{ runId: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { runId } = await context.params;
  const workflow = await getWorkflowRun(user.id, runId);
  if (!workflow)
    return attachSessionCookie(
      Response.json({ message: "工作流不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(Response.json({ workflow }), sessionId);
}

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { runId } = await context.params;
  const body = await readObject(request);
  const action = body.action as WorkflowAction | undefined;
  if (!action || !["cancel", "retry", "pause", "resume"].includes(action))
    return attachSessionCookie(
      Response.json({ message: "不支持的工作流操作" }, { status: 400 }),
      sessionId,
    );
  try {
    const workflow = await controlWorkflowRun({
      action,
      runId,
      userId: user.id,
    });
    return attachSessionCookie(Response.json({ workflow }), sessionId);
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        { message: error instanceof Error ? error.message : "工作流操作失败" },
        { status: error instanceof WorkflowActionError ? error.status : 500 },
      ),
      sessionId,
    );
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { runId } = await context.params;
  try {
    await deleteWorkflowRun({ runId, userId: user.id });
    return attachSessionCookie(Response.json({ ok: true }), sessionId);
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        { message: error instanceof Error ? error.message : "工作流删除失败" },
        { status: error instanceof WorkflowActionError ? error.status : 500 },
      ),
      sessionId,
    );
  }
}

async function readObject(request: Request) {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
