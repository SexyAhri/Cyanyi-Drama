import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import {
  getWorkflowRun,
  requestWorkflowCancel,
  retryWorkflowRun,
  updateWorkflowRunStatus,
} from "@/lib/workflow/store";

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
  const action = body.action;
  const current = await getWorkflowRun(user.id, runId);
  if (!current)
    return attachSessionCookie(
      Response.json({ message: "工作流不存在" }, { status: 404 }),
      sessionId,
    );
  let workflow;
  if (action === "cancel")
    workflow = await requestWorkflowCancel(user.id, runId);
  else if (action === "retry")
    workflow = await retryWorkflowRun(user.id, runId);
  else if (action === "pause" || action === "resume") {
    try {
      workflow = await updateWorkflowRunStatus(
        user.id,
        runId,
        action === "pause" ? "paused" : "queued",
        `${action}_requested`,
      );
    } catch (error) {
      return attachSessionCookie(
        Response.json(
          {
            message:
              error instanceof Error ? error.message : "当前状态不支持操作",
          },
          { status: 409 },
        ),
        sessionId,
      );
    }
  } else
    return attachSessionCookie(
      Response.json({ message: "不支持的工作流操作" }, { status: 400 }),
      sessionId,
    );
  if (!workflow)
    return attachSessionCookie(
      Response.json(
        { message: `当前状态不支持操作: ${current.status}` },
        { status: 409 },
      ),
      sessionId,
    );
  if (action === "resume" || action === "retry")
    await enqueueWorkflowJob({
      runId,
      userId: user.id,
      projectId: current.projectId,
      maxAttempts: 1,
    });
  return attachSessionCookie(Response.json({ workflow }), sessionId);
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
