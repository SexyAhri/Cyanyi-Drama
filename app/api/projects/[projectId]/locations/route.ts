import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  listNovelLocations,
  upsertNovelLocations,
} from "@/lib/novel/domain-store";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const locations = await listNovelLocations(user.id, projectId);
  if (!locations)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(Response.json({ locations }), sessionId);
}

export async function PUT(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const input = Array.isArray(body.locations)
    ? body.locations.filter(isLocationInput)
    : [];
  const locations = await upsertNovelLocations(user.id, projectId, input);
  if (!locations)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(Response.json({ locations }), sessionId);
}

function isLocationInput(
  value: unknown,
): value is { name: string; summary?: string | null } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { name?: unknown }).name === "string"
  );
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
