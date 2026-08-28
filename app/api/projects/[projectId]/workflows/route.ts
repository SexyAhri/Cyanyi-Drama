import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import {
  createOrReuseWorkflowRun,
  listWorkflowRunSummaries,
} from "@/lib/workflow/store";
import { getWorkflowTemplate } from "@/lib/workflow/registry";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const runs = await listWorkflowRunSummaries(
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
  const runtimeSettings = await loadUserRuntimeSettings(user.id);
  const workflowType =
    typeof body.workflowType === "string" ? body.workflowType.trim() : "";
  const explicitSteps = Array.isArray(body.steps)
    ? body.steps.filter(isStep)
    : [];
  const template = workflowType ? getWorkflowTemplate(workflowType) : null;
  const steps = (explicitSteps.length
    ? explicitSteps
    : (template?.steps ?? [])
  ).map((step) => ({
    ...step,
    maxAttempts: explicitSteps.length
      ? (step.maxAttempts ?? runtimeSettings.workflowStepMaxAttempts)
      : runtimeSettings.workflowStepMaxAttempts,
  }));
  if (!workflowType || !steps.length)
    return attachSessionCookie(
      Response.json(
        { message: "workflowType 和 steps 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  let result;
  try {
    result = await createOrReuseWorkflowRun({
      id: `workflow_${crypto.randomUUID()}`,
      userId: user.id,
      projectId,
      episodeId:
        typeof body.episodeId === "string" ? body.episodeId : undefined,
      workflowType,
      targetType:
        typeof body.targetType === "string" ? body.targetType : undefined,
      targetId: typeof body.targetId === "string" ? body.targetId : undefined,
      input: {
        ...(isRecord(body.input) ? body.input : {}),
        concurrency:
          isRecord(body.input) &&
          typeof body.input.concurrency === "number" &&
          Number.isFinite(body.input.concurrency)
            ? Math.max(1, Math.min(8, Math.floor(body.input.concurrency)))
            : runtimeSettings.workflowConcurrency,
      },
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
  if (!result)
    return attachSessionCookie(
      Response.json({ message: "项目或剧集不存在" }, { status: 404 }),
      sessionId,
    );
  if (!result.reused)
    await enqueueWorkflowJob({
      runId: result.workflow.id,
      userId: user.id,
      projectId,
      maxAttempts: 1,
    });
  return attachSessionCookie(
    Response.json(
      { workflow: result.workflow, reused: result.reused },
      { status: result.reused ? 200 : 202 },
    ),
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
    (value.maxAttempts === undefined ||
      (typeof value.maxAttempts === "number" &&
        Number.isInteger(value.maxAttempts) &&
        value.maxAttempts >= 1 &&
        value.maxAttempts <= 10)) &&
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
