import {
  saveProjectAssetVisualProfile,
  type VisualDesignTargetType,
} from "@/lib/assets/visual-design";
import { createAssetVisualDesignWorkflow } from "@/lib/assets/visual-design-workflow";
import { ProjectAssetError } from "@/lib/assets/project-store";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { getWorkflowRun } from "@/lib/workflow/store";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const targetType = visualTargetType(body.targetType);
  const targetId = stringValue(body.targetId);
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  if (!targetType || !targetId || !channelId || !model)
    return attachSessionCookie(
      Response.json(
        { message: "targetType、targetId、channelId 和 model 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  const input = {
    userId: user.id,
    projectId,
    channelId,
    model,
    targetType,
    targetId,
    locale: body.locale === "en" ? ("en" as const) : ("zh" as const),
  };
  const result = await createAssetVisualDesignWorkflow(input);
  if (!result)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  if (request.headers.get("accept")?.includes("application/x-ndjson"))
    return visualDesignStreamResponse(
      {
        userId: user.id,
        runId: result.workflow.id,
        locale: input.locale,
      },
      sessionId,
    );
  return attachSessionCookie(
    Response.json(
      { workflow: result.workflow, reused: result.reused },
      { status: result.reused ? 200 : 202 },
    ),
    sessionId,
  );
}

export async function PUT(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const targetType = visualTargetType(body.targetType);
  const targetId = stringValue(body.targetId);
  if (!targetType || !targetId || !isObject(body.spec))
    return attachSessionCookie(
      Response.json(
        { message: "targetType、targetId 和 spec 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  try {
    const profile = await saveProjectAssetVisualProfile({
      userId: user.id,
      projectId,
      targetType,
      targetId,
      spec: body.spec,
    });
    return attachSessionCookie(Response.json({ profile }), sessionId);
  } catch (error) {
    return assetErrorResponse(error, sessionId);
  }
}

function visualDesignStreamResponse(
  input: { userId: string; runId: string; locale: "zh" | "en" },
  sessionId: string | null,
) {
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      send({ type: "started", workflowId: input.runId });
      void waitForVisualDesignWorkflow(input)
        .then(send)
        .catch((error: unknown) => {
          send({
            type: "failed",
            message: visualDesignErrorMessage(error, input.locale),
            detail: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          if (!closed) controller.close();
          closed = true;
        });
    },
    cancel() {
      closed = true;
    },
  });
  return attachSessionCookie(
    new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    }),
    sessionId,
  );
}

async function waitForVisualDesignWorkflow(input: {
  userId: string;
  runId: string;
  locale: "zh" | "en";
}) {
  while (true) {
    const workflow = await getWorkflowRun(input.userId, input.runId);
    if (!workflow) throw new Error("WORKFLOW_RUN_NOT_FOUND");
    if (workflow.status === "succeeded") {
      if (isVisualDesignResult(workflow.output))
        return { type: "completed", ...workflow.output };
      throw new Error("WORKFLOW_VISUAL_DESIGN_OUTPUT_MISSING");
    }
    if (["failed", "blocked", "canceled"].includes(workflow.status))
      throw new Error(workflowErrorMessage(workflow.error));
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

function isVisualDesignResult(value: unknown): value is {
  target: { id: string; type: string; name: string };
  profile: Record<string, unknown>;
} {
  if (!isObject(value)) return false;
  return isObject(value.target) && isObject(value.profile);
}

function workflowErrorMessage(error: Record<string, unknown> | undefined) {
  return typeof error?.message === "string" && error.message.trim()
    ? error.message
    : "WORKFLOW_VISUAL_DESIGN_FAILED";
}

function visualDesignErrorMessage(error: unknown, locale: "zh" | "en") {
  if (error instanceof ProjectAssetError) return error.message;
  const detail = error instanceof Error ? error.message : String(error);
  return locale === "en"
    ? `Visual design failed: ${detail}`
    : `视觉设计失败：${detail}`;
}

function assetErrorResponse(error: unknown, sessionId: string | null) {
  if (error instanceof ProjectAssetError)
    return attachSessionCookie(
      Response.json({ message: error.message }, { status: error.status }),
      sessionId,
    );
  throw error;
}

async function readObject(request: Request) {
  try {
    const value: unknown = await request.json();
    return isObject(value) ? value : {};
  } catch {
    return {};
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function visualTargetType(value: unknown): VisualDesignTargetType | undefined {
  return value === "character" || value === "location" || value === "prop"
    ? value
    : undefined;
}
