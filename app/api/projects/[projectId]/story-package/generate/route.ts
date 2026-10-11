import { storySetupSchema } from "@/lib/studio/production-input";
import { z } from "zod";

import { EpisodeSplitError } from "@/lib/episodes/errors";
import {
  StoryPackageGenerationError,
  generateAndSaveStoryPackage,
} from "@/lib/production/story-package-generation";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

export const maxDuration = 300;

type Context = { params: Promise<{ projectId: string }> };

const requestSchema = z.object({
  channelId: z.string().trim().min(1),
  model: z.string().trim().min(1),
  locale: z.enum(["zh", "en"]).default("zh"),
  setup: storySetupSchema,
});

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return attachSessionCookie(
      Response.json(
        { message: "STORY_PACKAGE_INPUT_INVALID" },
        { status: 400 },
      ),
      sessionId,
    );
  if (request.headers.get("accept")?.includes("application/x-ndjson")) {
    const encoder = new TextEncoder();
    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => { if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); };
        send({ type: "started" });
        heartbeat = setInterval(() => send({ type: "heartbeat" }), 15000);
        void generateAndSaveStoryPackage({ userId: user.id, projectId, ...parsed.data,
          onProgress: progress => send({ type: "progress", ...progress }),
        }).then(result => send({ type: "completed", result })).catch(error =>
          send({ type: "failed", message: error instanceof Error ? error.message : "策划包生成失败" }),
        ).finally(() => {
          if (heartbeat) clearInterval(heartbeat);
          if (!closed) controller.close();
          closed = true;
        });
      },
      cancel() { closed = true; if (heartbeat) clearInterval(heartbeat); },
    });
    return attachSessionCookie(new Response(stream, { headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no",
    } }), sessionId);
  }
  try {
    const result = await generateAndSaveStoryPackage({
      userId: user.id,
      projectId,
      ...parsed.data,
    });
    return attachSessionCookie(
      Response.json(result, { status: 201 }),
      sessionId,
    );
  } catch (error) {
    const known =
      error instanceof StoryPackageGenerationError ||
      error instanceof EpisodeSplitError;
    const status = known
      ? (error as StoryPackageGenerationError | EpisodeSplitError).status
      : 500;
    const message = known
      ? error instanceof Error
        ? error.message
        : "STORY_PACKAGE_GENERATION_FAILED"
      : error instanceof Error
        ? error.message
        : "STORY_PACKAGE_GENERATION_FAILED";
    return attachSessionCookie(
      Response.json({ message }, { status }),
      sessionId,
    );
  }
}
