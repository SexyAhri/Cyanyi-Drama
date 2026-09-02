import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { createOrReuseWorkflowRun } from "@/lib/workflow/store";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await readObject(request);
  const locale = body.locale === "en" ? "en" : "zh";
  const runtimeSettings = await loadUserRuntimeSettings(user.id);
  const result = await createOrReuseWorkflowRun({
    id: `workflow_${crypto.randomUUID()}`,
    userId: user.id,
    projectId,
    episodeId,
    workflowType: "story-to-script",
    targetType: "episode",
    targetId: episodeId,
    input: { locale },
    steps: [
      {
        key: "organize_production_script",
        type: "organize_production_script",
        artifactTypes: [
          "production-script.catalog",
          "production-script.scenes",
          "clips.split",
          "screenplay.clip",
        ],
        input: { locale },
        retryable: true,
        maxAttempts: runtimeSettings.workflowStepMaxAttempts,
      },
    ],
    maxAttempts: runtimeSettings.workflowStepMaxAttempts,
  });
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
