import {
  listEpisodeSources,
  type EpisodeAdaptationMode,
} from "@/lib/episodes/adaptation";
import { EpisodeSourceError, EpisodeSplitError } from "@/lib/episodes/errors";
import { startEpisodeProductionWorkflow } from "@/lib/studio/agent-production-actions";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  getWorkflowRun,
} from "@/lib/workflow/store";

type Context = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  try {
    const result = await listEpisodeSources({ userId: user.id, projectId, episodeId });
    return attachSessionCookie(Response.json(result), sessionId);
  } catch (error) {
    return sourceErrorResponse(error, sessionId);
  }
}

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await readObject(request);
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  const mode = adaptationMode(body.mode);
  if (!channelId || !model || !mode)
    return attachSessionCookie(
      Response.json({ message: "改编模式、渠道和模型不能为空" }, { status: 400 }),
      sessionId,
    );
  const adaptationInput = {
    userId: user.id,
    projectId,
    episodeId,
    channelId,
    model,
    mode,
    instructions: stringValue(body.instructions),
    locale: body.locale === "en" ? ("en" as const) : ("zh" as const),
  };
  try {
  const result = await startEpisodeProductionWorkflow({
    userId: user.id, projectId, targetId: episodeId,
    operation: "start_episode_adaptation", channelId, model,
    locale: adaptationInput.locale,
    options: { adaptationMode: mode, instructions: adaptationInput.instructions },
  });
  if (request.headers.get("accept")?.includes("application/x-ndjson"))
    return adaptationStreamResponse(
      {
        userId: user.id,
        runId: result.workflow.id,
        locale: adaptationInput.locale,
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
  } catch (error) { return sourceErrorResponse(error, sessionId); }
}

function adaptationStreamResponse(
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
      void waitForAdaptationWorkflow(input)
        .then(send)
        .catch((error: unknown) => {
          send({
            type: "failed",
            message: adaptationErrorMessage(error, input.locale),
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

async function waitForAdaptationWorkflow(input: {
  userId: string;
  runId: string;
  locale: "zh" | "en";
}) {
  while (true) {
    const workflow = await getWorkflowRun(input.userId, input.runId);
    if (!workflow) throw new Error("WORKFLOW_RUN_NOT_FOUND");
    if (workflow.status === "succeeded") {
      const source = workflow.output?.source;
      if (isEpisodeSource(source)) return { type: "completed", source };
      throw new Error("WORKFLOW_ADAPTATION_SOURCE_MISSING");
    }
    if (["failed", "blocked", "canceled"].includes(workflow.status))
      throw new Error(workflowErrorMessage(workflow.error));
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

function isEpisodeSource(value: unknown) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { content?: unknown }).content === "string"
  );
}

function workflowErrorMessage(error: Record<string, unknown> | undefined) {
  return typeof error?.message === "string" && error.message.trim()
    ? error.message
    : "WORKFLOW_ADAPTATION_FAILED";
}

function adaptationErrorMessage(error: unknown, locale: "zh" | "en" = "zh") {
  if (error instanceof EpisodeSourceError || error instanceof EpisodeSplitError)
    return error.message;
  const detail = error instanceof Error ? error.message : String(error);
  if (locale === "en") return `The adaptation request failed: ${detail}`;
  return `改编请求失败：${detail}`;
}

function adaptationMode(value: unknown): EpisodeAdaptationMode | null {
  return value === "faithful" ||
    value === "polish" ||
    value === "drama" ||
    value === "custom"
    ? value
    : null;
}

function sourceErrorResponse(error: unknown, sessionId: string | null) {
  if (error instanceof EpisodeSourceError)
    return attachSessionCookie(
      Response.json(
        { message: error.message, details: error.details },
        { status: error.status },
      ),
      sessionId,
    );
  if (error instanceof EpisodeSplitError)
    return attachSessionCookie(
      Response.json({ message: error.message }, { status: error.status }),
      sessionId,
    );
  throw error;
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

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
