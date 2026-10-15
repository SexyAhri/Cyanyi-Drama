import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { z } from "zod";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import {
  createOrReuseWorkflowRun,
  getWorkflowRun,
} from "@/lib/workflow/store";

type Context = {
  params: Promise<{ projectId: string; episodeId: string; panelId: string }>;
};

const requestSchema = z.object({
  channelId: z.string().trim().min(1).max(200), model: z.string().trim().min(1).max(200),
  kind: z.enum(["image", "video"]), mode: z.enum(["reference", "first-last"]).optional(),
  action: z.enum(["design", "review-video"]).default("design"),
  async: z.boolean().optional(),
  currentPrompt: z.string().trim().max(12000).optional(), locale: z.enum(["zh", "en"]).default("zh"),
}).strict();

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId, panelId } = await context.params;
  const parsed = requestSchema.safeParse(await readObject(request));
  if (!parsed.success)
    return attachSessionCookie(
      Response.json({ message: "提示词设计请求无效；不接受客户端素材 URL 或上下文快照" }, { status: 400 }),
      sessionId,
    );
  const input = {
    ...parsed.data,
    panelId,
    mode: parsed.data.mode ?? "reference",
  };
  const reviewing = input.action === "review-video";
  if (reviewing && input.kind !== "video") return attachSessionCookie(Response.json({ message: "仅视频支持抽帧诊断" }, { status: 400 }), sessionId);
  const runtimeSettings = await loadUserRuntimeSettings(user.id);
  let workflowId: string | undefined;
  try {
    const result = await createOrReuseWorkflowRun({
      id: `workflow_${crypto.randomUUID()}`,
      userId: user.id,
      projectId,
      episodeId,
      workflowType: reviewing ? "storyboard-video-review" : "storyboard-prompt-design",
      targetType: reviewing ? "storyboard_panel_video_review" : `storyboard_panel_prompt_${input.kind}_${input.mode}`,
      targetId: panelId,
      input,
      steps: [
        {
          key: reviewing ? "review_storyboard_video" : "design_storyboard_media_prompt",
          type: reviewing ? "review_storyboard_video" : "design_storyboard_media_prompt",
          artifactTypes: reviewing ? ["storyboard.video-review", "prompt.trace"] : [
            "storyboard.prompt-design",
            "storyboard.prompt-design.raw",
            "prompt.trace",
          ],
          input,
          retryable: !reviewing,
          maxAttempts: reviewing ? 1 : runtimeSettings.workflowStepMaxAttempts,
        },
      ],
      maxAttempts: runtimeSettings.workflowStepMaxAttempts,
    });
    if (!result)
      return attachSessionCookie(
        Response.json({ message: "项目或剧集不存在" }, { status: 404 }),
        sessionId,
      );
    workflowId = result.workflow.id;
    if (!result.reused)
      await enqueueWorkflowJob({
        runId: result.workflow.id,
        userId: user.id,
        projectId,
        maxAttempts: 1,
      });
    if (input.async) return attachSessionCookie(Response.json({ workflowId: result.workflow.id, pending: true }, { status: 202 }), sessionId);
    const output = await waitForPromptDesignWorkflow(
      user.id,
      result.workflow.id,
      reviewing,
    );
    return attachSessionCookie(
      Response.json({
        ...publicOutput(output, reviewing),
        workflowId: result.workflow.id,
      }),
      sessionId,
    );
  } catch (error) {
    return attachSessionCookie(
      Response.json(
        {
          message: error instanceof Error ? error.message : "镜头提示设计失败",
          workflowId,
        },
        { status: typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 502 },
      ),
      sessionId,
    );
  }
}

async function waitForPromptDesignWorkflow(userId: string, runId: string, reviewing: boolean) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const workflow = await getWorkflowRun(userId, runId);
    if (!workflow) throw new Error("WORKFLOW_RUN_NOT_FOUND");
    if (workflow.status === "succeeded") {
      if (reviewing && isObject(workflow.output) && isObject(workflow.output.review)) return workflow.output;
      if (!reviewing && isPromptDesignOutput(workflow.output)) return workflow.output;
      throw new Error("WORKFLOW_STORYBOARD_PROMPT_DESIGN_OUTPUT_MISSING");
    }
    if (["failed", "blocked", "canceled", "paused"].includes(workflow.status))
      throw new Error(workflowErrorMessage(workflow.error));
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`等待超时，任务仍可能执行；请在任务中心查看，不要重复提交。${runId}`);
}

function publicOutput(output: Record<string, unknown>, reviewing: boolean) {
  if (!reviewing) return { design: output.design, trace: output.trace };
  return Object.fromEntries(["review", "videoAssetId", "referenceAssetIds", "frames", "durationSeconds", "coverage", "audio", "continuousMotion", "trace"].map((key) => [key, output[key]]));
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
