import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  listProductionProps,
  upsertProductionProps,
} from "@/lib/production/domain-store";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const props = await listProductionProps(user.id, projectId);
  if (!props)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(Response.json({ props }), sessionId);
}

export async function PUT(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const props = Array.isArray(body.props) ? body.props.filter(isProp) : [];
  const result = await upsertProductionProps(user.id, projectId, props);
  if (!result)
    return attachSessionCookie(
      Response.json({ message: "项目不存在" }, { status: 404 }),
      sessionId,
    );
  return attachSessionCookie(Response.json({ props: result }), sessionId);
}

function isProp(value: unknown): value is {
  name: string;
  summary?: string | null;
  metadata?: Record<string, unknown>;
} {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.name === "string" &&
    (item.summary === undefined ||
      item.summary === null ||
      typeof item.summary === "string") &&
    (item.metadata === undefined ||
      (!!item.metadata &&
        typeof item.metadata === "object" &&
        !Array.isArray(item.metadata)))
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
