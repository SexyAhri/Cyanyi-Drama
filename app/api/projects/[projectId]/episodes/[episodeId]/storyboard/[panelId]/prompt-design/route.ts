import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import {
  createOrReuseWorkflowRun,
  getWorkflowRun,
} from "@/lib/workflow/store";

type Context = {
  params: Promise<{ projectId: string; episodeId: string; panelId: string }>;
};

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId, panelId } = await context.params;
  const body = await readObject(request);
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  if (!channelId || !model)
    return attachSessionCookie(
      Response.json({ message: "channelId 和 model 是必填项" }, { status: 400 }),
      sessionId,
    );
  const input = {
    channelId,
    model,
    panelId,
    kind: body.kind === "video" ? ("video" as const) : ("image" as const),
    mode: body.mode === "first-last" ? ("first-last" as const) : ("reference" as const),
    currentPrompt: stringValue(body.currentPrompt) || undefined,
    locale: body.locale === "en" ? ("en" as const) : ("zh" as const),
  };
  const runtimeSettings = await loadUserRuntimeSettings(user.id);
  const result = await createOrReuseWorkflowRun({
    id: `workflow_${crypto.randomUUID()}`,
    userId: user.id,
    projectId,
    episodeId,
    workflowType: "storyboard-prompt-design",
    targetType: `storyboard_panel_prompt_${input.kind}_${input.mode}`,
    targetId: panelId,
    input,
    steps: [
      {
        key: "design_storyboard_media_prompt",
        type: "design_storyboard_media_prompt",
        artifactTypes: [
          "storyboard.prompt-design",
          "storyboard.prompt-design.raw",
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
    const output = await waitForPromptDesignWorkflow(
      user.id,
      result.workflow.id,
    );
    return attachSessionCookie(
      Response.json({
        design: output.design,
        trace: output.trace,
        workflowId: result.workflow.id,
      }),
      sessionId,
    );
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        {
          message: error instanceof Error ? error.message : "镜头提示设计失败",
          workflowId: result.workflow.id,
        },
        { status: 502 },
      ),
      sessionId,
    );
  }
}

async function waitForPromptDesignWorkflow(userId: string, runId: string) {
  while (true) {
    const workflow = await getWorkflowRun(userId, runId);
    if (!workflow) throw new Error("WORKFLOW_RUN_NOT_FOUND");
    if (workflow.status === "succeeded") {
      if (isPromptDesignOutput(workflow.output)) return workflow.output;
      throw new Error("WORKFLOW_STORYBOARD_PROMPT_DESIGN_OUTPUT_MISSING");
    }
    if (["failed", "blocked", "canceled"].includes(workflow.status))
      throw new Error(workflowErrorMessage(workflow.error));
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

function isPromptDesignOutput(value: unknown): value is {
  design: {
    prompt: string;
    designNotes: string[];
    continuitySafeguards: string[];
  };
  trace: Record<string, unknown>;
} {
  if (!isObject(value) || !isObject(value.design)) return false;
  return typeof value.design.prompt === "string" && isObject(value.trace);
}

function workflowErrorMessage(error: Record<string, unknown> | undefined) {
  return typeof error?.message === "string" && error.message.trim()
    ? error.message
    : "WORKFLOW_STORYBOARD_PROMPT_DESIGN_FAILED";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
