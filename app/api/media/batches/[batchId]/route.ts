import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";
import { controlMediaTask } from "@/lib/media/task-actions";

type Context = { params: Promise<{ batchId: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { batchId } = await context.params;
  const store = createDatabaseMediaTaskStore(user.id);
  const tasks = await store.list({ batchId, limit: 100 });
  return attachSessionCookie(
    Response.json({
      batchId,
      tasks,
      summary: summarize(tasks),
    }),
    sessionId,
  );
}

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { batchId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
  };
  const store = createDatabaseMediaTaskStore(user.id);
  const tasks = await store.list({ batchId, limit: 100 });
  if (tasks.length === 0) {
    return attachSessionCookie(
      Response.json({ message: "Media batch not found." }, { status: 404 }),
      sessionId,
    );
  }

  if (body.action === "cancel") {
    const updated = [];
    for (const task of tasks) {
      if (task.status !== "queued" && task.status !== "running") continue;
      try {
        const canceled = await controlMediaTask({
          action: "cancel",
          taskId: task.id,
          userId: user.id,
          projectId: task.projectId,
        });
        updated.push(canceled);
      } catch {
        // Another worker or cancellation request may have changed this item; keep processing the batch.
      }
    }
    return attachSessionCookie(
      Response.json({ batchId, tasks: updated, summary: summarize(await store.list({ batchId, limit: 100 })) }),
      sessionId,
    );
  }

  if (body.action === "retry") {
    const retried = [];
    for (const task of tasks) {
      if (task.status !== "failed") continue;
      const queued = await controlMediaTask({
        action: "retry",
        taskId: task.id,
        userId: user.id,
        projectId: task.projectId,
      });
      retried.push(queued);
    }
    return attachSessionCookie(
      Response.json({ batchId, tasks: retried, summary: summarize(await store.list({ batchId, limit: 100 })) }, { status: 202 }),
      sessionId,
    );
  }

  return attachSessionCookie(
    Response.json({ message: "Unsupported batch action." }, { status: 400 }),
    sessionId,
  );
}

function summarize(tasks: Array<{ status: string }>) {
  return tasks.reduce<Record<string, number>>((summary, task) => {
    summary[task.status] = (summary[task.status] ?? 0) + 1;
    return summary;
  }, {});
}
