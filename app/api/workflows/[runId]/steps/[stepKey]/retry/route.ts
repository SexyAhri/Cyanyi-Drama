import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import {
  retryWorkflowStep,
  STORYBOARD_RETRY_PHASES,
  type StoryboardRetryPhase,
} from "@/lib/workflow/store";

type Context = { params: Promise<{ runId: string; stepKey: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { runId, stepKey } = await context.params;
  const body = await readObject(request);
  const refId = typeof body.refId === "string" ? body.refId.trim() : "";
  const phase = typeof body.phase === "string" ? body.phase.trim() : "";
  const phaseRetry = refId && isStoryboardRetryPhase(phase)
    ? { refId, phase }
    : undefined;
  if ((refId || phase) && !phaseRetry)
    return attachSessionCookie(
      Response.json(
        { message: "refId 和有效的 phase 必须同时提供" },
        { status: 400 },
      ),
      sessionId,
    );
  const workflow = await retryWorkflowStep(
    user.id,
    runId,
    stepKey,
    phaseRetry,
  );
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

function isStoryboardRetryPhase(value: string): value is StoryboardRetryPhase {
  return STORYBOARD_RETRY_PHASES.includes(value as StoryboardRetryPhase);
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
