import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { createDatabaseMediaTaskStore } from "@/lib/media/task-store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { user, sessionId } = await ensureAnonymousUser();
  const mediaTaskStore = createDatabaseMediaTaskStore(user.id);
  const status = url.searchParams.get("status") as
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "canceled"
    | null;
  const limitValue = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitValue)
    ? Math.min(Math.max(Math.floor(limitValue), 1), 100)
    : 50;

  return attachSessionCookie(
    Response.json({
      tasks: await mediaTaskStore.list({
        limit,
        ...(status ? { status } : {}),
        ...(url.searchParams.get("projectId")
          ? { projectId: url.searchParams.get("projectId")! }
          : {}),
        ...(url.searchParams.get("episodeId")
          ? { episodeId: url.searchParams.get("episodeId")! }
          : {}),
      }),
    }),
    sessionId,
  );
}
