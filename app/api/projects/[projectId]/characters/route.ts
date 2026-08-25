import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  listNovelCharacters,
  upsertNovelCharacters,
} from "@/lib/novel/domain-store";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const characters = await listNovelCharacters(user.id, projectId);
  if (!characters)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(Response.json({ characters }), sessionId);
}

export async function PUT(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const input = Array.isArray(body.characters)
    ? body.characters.filter(isCharacterInput)
    : [];
  const characters = await upsertNovelCharacters(user.id, projectId, input);
  if (!characters)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(Response.json({ characters }), sessionId);
}

function isCharacterInput(value: unknown): value is {
  name: string;
  aliases?: string[];
  profile?: Record<string, unknown>;
  introduction?: string | null;
} {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as { name?: unknown }).name !== "string"
  )
    return false;
  const item = value as Record<string, unknown>;
  return (
    (item.aliases === undefined || Array.isArray(item.aliases)) &&
    (item.profile === undefined ||
      (!!item.profile &&
        typeof item.profile === "object" &&
        !Array.isArray(item.profile)))
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
