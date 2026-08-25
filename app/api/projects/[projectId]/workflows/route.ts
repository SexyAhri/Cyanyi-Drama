import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { createWorkflowRun, listWorkflowRuns } from "@/lib/workflow/store";
import { getWorkflowTemplate } from "@/lib/workflow/registry";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const runs = await listWorkflowRuns(
    user.id,
    projectId,
    Number(new URL(request.url).searchParams.get("limit") ?? 50),
  );
  return attachSessionCookie(Response.json({ workflows: runs }), sessionId);
}

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const workflowType =
    typeof body.workflowType === "string" ? body.workflowType.trim() : "";
  const explicitSteps = Array.isArray(body.steps)
    ? body.steps.filter(isStep)
    : [];
  const template = workflowType ? getWorkflowTemplate(workflowType) : null;
  const steps = explicitSteps.length ? explicitSteps : (template?.steps ?? []);
  if (!workflowType || !steps.length)
    return attachSessionCookie(
      Response.json(
        { message: "workflowType 和 steps 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  let run;
  try {
    run = await createWorkflowRun({
      id: `workflow_${crypto.randomUUID()}`,
      userId: user.id,
      projectId,
      episodeId:
        typeof body.episodeId === "string" ? body.episodeId : undefined,
      workflowType,
      input: isRecord(body.input) ? body.input : undefined,
      steps,
    });
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        { message: error instanceof Error ? error.message : "工作流定义无效" },
        { status: 400 },
      ),
      sessionId,
    );
  }
  if (!run)
    return attachSessionCookie(
      Response.json({ message: "项目或剧集不存在" }, { status: 404 }),
      sessionId,
    );
  await enqueueWorkflowJob({
    runId: run.id,
    userId: user.id,
    projectId,
    maxAttempts: 1,
  });
  return attachSessionCookie(
    Response.json({ workflow: run }, { status: 202 }),
    sessionId,
  );
}

function isStep(value: unknown): value is {
  key: string;
  type: string;
  dependsOn?: string[];
  artifactTypes?: string[];
  retryable?: boolean;
  failureMode?: "fail_run";
  input?: Record<string, unknown>;
  maxAttempts?: number;
} {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.type === "string" &&
    (value.dependsOn === undefined ||
      (Array.isArray(value.dependsOn) &&
        value.dependsOn.every((item: unknown) => typeof item === "string"))) &&
    (value.artifactTypes === undefined ||
      (Array.isArray(value.artifactTypes) &&
        value.artifactTypes.every(
          (item: unknown) => typeof item === "string",
        ))) &&
    (value.retryable === undefined || typeof value.retryable === "boolean") &&
    (value.failureMode === undefined || value.failureMode === "fail_run") &&
    (value.input === undefined || isRecord(value.input))
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
async function readObject(request: Request) {
  try {
    const value: unknown = await request.json();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}
