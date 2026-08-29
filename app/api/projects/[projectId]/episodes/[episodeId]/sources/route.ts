import {
  adaptEpisodeSource,
  listEpisodeSources,
  type EpisodeAdaptationMode,
} from "@/lib/episodes/adaptation";
import { EpisodeSourceError, EpisodeSplitError } from "@/lib/episodes/errors";
import { StructuredOutputError } from "@/lib/llm/structured-output";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

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
  if (request.headers.get("accept")?.includes("application/x-ndjson"))
    return adaptationStreamResponse(adaptationInput, sessionId);
  try {
    const source = await adaptEpisodeSource(adaptationInput);
    return attachSessionCookie(Response.json({ source }, { status: 201 }), sessionId);
  } catch (error) {
    return sourceErrorResponse(error, sessionId);
  }
}

function adaptationStreamResponse(
  input: Parameters<typeof adaptEpisodeSource>[0],
  sessionId: string | null,
) {
  const encoder = new TextEncoder();
  let closed = false;
  let pendingDelta = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
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
      const flushDelta = () => {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = null;
        if (!pendingDelta) return;
        send({ type: "delta", delta: pendingDelta });
        pendingDelta = "";
      };
      const progress = (
        event: Parameters<NonNullable<typeof input.onProgress>>[0],
      ) => {
        if (event.type === "reset") {
          pendingDelta = "";
          if (flushTimer) clearTimeout(flushTimer);
          flushTimer = null;
          send(event);
          return;
        }
        pendingDelta += event.delta;
        flushTimer ??= setTimeout(flushDelta, 40);
      };
      send({ type: "started" });
      void adaptEpisodeSource({
        ...input,
        onProgress: progress,
      })
        .then((source) => {
          flushDelta();
          send({ type: "completed", source });
          if (!closed) controller.close();
          closed = true;
        })
        .catch((error: unknown) => {
          flushDelta();
          send({
            type: "failed",
            message: adaptationErrorMessage(error, input.locale),
            detail: error instanceof Error ? error.message : String(error),
          });
          if (!closed) controller.close();
          closed = true;
        });
    },
    cancel() {
      if (flushTimer) clearTimeout(flushTimer);
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

function adaptationErrorMessage(error: unknown, locale: "zh" | "en" = "zh") {
  if (error instanceof EpisodeSourceError || error instanceof EpisodeSplitError)
    return error.message;
  if (error instanceof StructuredOutputError) {
    if (locale === "en")
      return "The model output did not pass source-evidence and synopsis validation, so no adaptation version was saved.";
    return "模型输出未通过原文证据与本集梗概校验，因此没有保存为改编版本。";
  }
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
