import { createAssetVisualDesignWorkflow } from "@/lib/assets/visual-design-workflow";
import type { VisualDesignTargetType } from "@/lib/assets/visual-design";
import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";

type Context = { params: Promise<{ projectId: string }> };

type BatchItem = {
  targetType: VisualDesignTargetType;
  targetId: string;
};

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  const locale = body.locale === "en" ? ("en" as const) : ("zh" as const);
  const items = Array.isArray(body.items) ? body.items.filter(isBatchItem) : [];
  if (!channelId || !model || items.length === 0)
    return attachSessionCookie(
      Response.json(
        { message: "channelId、model 和 items 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );

  const uniqueItems = Array.from(
    new Map(
      items
        .slice(0, 50)
        .map((item) => [`${item.targetType}:${item.targetId}`, item]),
    ).values(),
  );
  const results = [];
  for (const item of uniqueItems) {
    const result = await createAssetVisualDesignWorkflow({
      userId: user.id,
      projectId,
      channelId,
      model,
      locale,
      ...item,
      completeMissing: body.completeMissing === true,
    });
    if (!result)
      return attachSessionCookie(
        Response.json({ message: "项目不存在" }, { status: 404 }),
        sessionId,
      );
    results.push({
      item,
      reused: result.reused,
      workflow: result.workflow,
    });
  }
  return attachSessionCookie(
    Response.json({ count: results.length, results }, { status: 202 }),
    sessionId,
  );
}

function isBatchItem(value: unknown): value is BatchItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    (item.targetType === "character" ||
      item.targetType === "location" ||
      item.targetType === "prop") &&
    typeof item.targetId === "string" &&
    item.targetId.trim().length > 0
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
