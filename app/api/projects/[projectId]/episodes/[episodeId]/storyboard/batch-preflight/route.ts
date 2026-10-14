import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { preflightStoryboardBatch, type StoryboardBatchPreflightItemInput } from "@/lib/media/storyboard-batch-preflight";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { productionRequestOptionsSchema, productionRequestErrorStatus } from "@/lib/production-configuration/execution";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await readObject(request);
  const kind = body.kind === "video" ? "video" : "image";
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.filter(isPanelItem);
  if (!channelId || !model || !items.length || items.length !== rawItems.length || items.length > 50) {
    return attachSessionCookie(Response.json({ message: "channelId、model 和 1–50 个有效 items 是必填项" }, { status: 400 }), sessionId);
  }

  try {
    productionRequestOptionsSchema.parse(body);
    items.forEach((item) => productionRequestOptionsSchema.parse(item));
    const mediaDefaults = await loadUserRuntimeSettings(user.id);
    const result = await preflightStoryboardBatch({
      userId: user.id,
      projectId,
      episodeId,
      channelId,
      model,
      kind,
      mode: body.mode === "first-last" ? "first-last" : "reference",
      ratio: stringValue(body.ratio) || undefined,
      resolution: stringValue(body.resolution) || undefined,
      duration: stringValue(body.duration) || undefined,
      batchBudgetLimit: budgetLimit(body.batchBudgetLimit),
      items,
      mediaDefaults,
    });
    return attachSessionCookie(Response.json({ preflight: result }), sessionId);
  } catch (error) {
    if (error instanceof Error && error.message === "BILLING_MEDIA_BUDGET_INPUT_INVALID") return attachSessionCookie(Response.json({ message: error.message }, { status: 400 }), sessionId);
    const status = productionRequestErrorStatus(error);
    if (status) return attachSessionCookie(Response.json({ message: error instanceof Error ? error.message : "配置无效" }, { status }), sessionId);
    throw error;
  }
}

function isPanelItem(value: unknown): value is StoryboardBatchPreflightItemInput {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.panelId === "string" && item.panelId.trim().length > 0 &&
    (item.prompt === undefined || typeof item.prompt === "string") &&
    (item.mode === undefined || item.mode === "reference" || item.mode === "first-last") &&
    (item.lastFramePanelId === undefined || typeof item.lastFramePanelId === "string") &&
    (item.previewConfigurationHash === undefined || typeof item.previewConfigurationHash === "string") &&
    (item.previewRequestHash === undefined || typeof item.previewRequestHash === "string");
}

function stringValue(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

function budgetLimit(value: unknown): string | number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+(\.\d{1,6})?$/.test(value) && value.length <= 32) return value;
  throw new Error("BILLING_MEDIA_BUDGET_INPUT_INVALID");
}

async function readObject(request: Request) {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}
