import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  createOrReuseWorkflowRun,
  getWorkflowRun,
} from "@/lib/workflow/store";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const channelId =
    typeof body.channelId === "string" ? body.channelId.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const locale = body.locale === "en" ? "en" : "zh";
  if (!channelId || !model)
    return attachSessionCookie(
      Response.json(
        { message: "channelId 和 model 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  const input = { channelId, model, locale };
  const runtimeSettings = await loadUserRuntimeSettings(user.id);
  const result = await createOrReuseWorkflowRun({
    id: `workflow_${crypto.randomUUID()}`,
    userId: user.id,
    projectId,
    episodeId,
    workflowType: "voice-performance-design",
    targetType: "episode_voice_performance",
    targetId: episodeId,
    input,
    steps: [
      {
        key: "design_voice_performance",
        type: "design_voice_performance",
        artifactTypes: [
          "voice.performance-design",
          "voice.performance-design.raw",
          "prompt.trace",
        ],
        input,
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
  try {
    if (!result.reused)
      await enqueueWorkflowJob({
        runId: result.workflow.id,
        userId: user.id,
        projectId,
        maxAttempts: 1,
      });
    const output = await waitForVoiceDesignWorkflow(
      user.id,
      result.workflow.id,
    );
    return attachSessionCookie(
      Response.json({
        voiceLines: output.voiceLines,
        promptTrace: output.promptTrace,
        workflowId: result.workflow.id,
      }),
      sessionId,
    );
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        {
          message: error instanceof Error ? error.message : "AI 配音设计失败",
          workflowId: result.workflow.id,
        },
        { status: 502 },
      ),
      sessionId,
    );
  }
}

async function waitForVoiceDesignWorkflow(userId: string, runId: string) {
  while (true) {
    const workflow = await getWorkflowRun(userId, runId);
    if (!workflow) throw new Error("WORKFLOW_RUN_NOT_FOUND");
    if (workflow.status === "succeeded") {
      if (isVoiceDesignOutput(workflow.output)) return workflow.output;
      throw new Error("WORKFLOW_VOICE_DESIGN_OUTPUT_MISSING");
    }
    if (["failed", "blocked", "canceled"].includes(workflow.status))
      throw new Error(workflowErrorMessage(workflow.error));
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

function isVoiceDesignOutput(value: unknown): value is {
  voiceLines: Array<Record<string, unknown>>;
  promptTrace: Record<string, unknown>;
} {
  return (
    isObject(value) &&
    Array.isArray(value.voiceLines) &&
    isObject(value.promptTrace)
  );
}

function workflowErrorMessage(error: Record<string, unknown> | undefined) {
  return typeof error?.message === "string" && error.message.trim()
    ? error.message
    : "WORKFLOW_VOICE_DESIGN_FAILED";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
