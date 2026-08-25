import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { retryWorkflowStep } from "@/lib/workflow/store";

type Context = { params: Promise<{ runId: string; stepKey: string }> };

export async function POST(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { runId, stepKey } = await context.params;
  const workflow = await retryWorkflowStep(user.id, runId, stepKey);
  if (!workflow)
    return attachSessionCookie(
      Response.json(
        { message: "步骤不存在、不可重试或已达到重试上限" },
        { status: 409 },
      ),
      sessionId,
    );
  await enqueueWorkflowJob({
    runId,
    userId: user.id,
    projectId: workflow.projectId,
    maxAttempts: 1,
  });
  return attachSessionCookie(
    Response.json({ workflow }, { status: 202 }),
    sessionId,
  );
}
