import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await context.params;
  const { user, sessionId } = await ensureAnonymousUser();
  const store = createDatabaseMediaTaskStore(user.id);
  const task = await store.get(taskId);
  if (!task) {
    return attachSessionCookie(
      Response.json({ message: "Media task not found." }, { status: 404 }),
      sessionId,
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const seen = new Set<string>();
      const startedAt = Date.now();
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        controller.close();
      };
      const send = (event: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: task\ndata: ${JSON.stringify(event)}\n\n`),
        );
      };
      const poll = async () => {
        if (closed) return;
        try {
          const current = await store.get(taskId);
          if (!current) return close();
          const events = await store.listEvents(taskId, 500);
          for (const event of events) {
            if (seen.has(event.id)) continue;
            seen.add(event.id);
            send({ task: current, event });
          }
          if (
            ["succeeded", "failed", "canceled"].includes(current.status) ||
            Date.now() - startedAt > 10 * 60_000
          ) {
            return close();
          }
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          close();
        }
      };
      const timer = setInterval(() => void poll(), 1000);
      void poll();
      request.signal.addEventListener("abort", close, { once: true });
    },
  });

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
  return attachSessionCookie(response, sessionId);
}
