import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { randomUUID } from "node:crypto";
import {
  createProjectImageTask,
  ProjectAssetTaskError,
  type ProjectAssetTarget,
} from "@/lib/media/project-asset-tasks";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";

type Context = { params: Promise<{ projectId: string }> };

type BatchItem = {
  targetType: ProjectAssetTarget;
  targetId: string;
  prompt?: string;
};

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  const basePrompt = stringValue(body.prompt);
  const items = Array.isArray(body.items)
    ? body.items.filter(isBatchItem)
    : [];

  if (!channelId || !model || !basePrompt || items.length === 0) {
    return attachSessionCookie(
      Response.json(
        { message: "channelId、model、prompt 和 items 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  }

  const results: Array<{ item: BatchItem; task: unknown; entity: unknown }> = [];
  const batchId = `asset_batch_${randomUUID()}`;
  const mediaDefaults = await loadUserRuntimeSettings(user.id);
  for (const item of items.slice(0, 50)) {
    try {
      const result = await createProjectImageTask({
        userId: user.id,
        projectId,
        batchId,
        channelId,
        model,
        targetType: item.targetType,
        targetId: item.targetId,
        prompt: item.prompt?.trim() || basePrompt,
        ratio: stringValue(body.ratio) || undefined,
        resolution: stringValue(body.resolution) || undefined,
        mediaDefaults,
        useSelectedReference: body.useSelectedReference !== false,
      });
      results.push({ item, ...result });
    } catch (error) {
      if (error instanceof ProjectAssetTaskError) {
        return attachSessionCookie(
          Response.json(
            { message: error.message, item },
            { status: error.status },
          ),
          sessionId,
        );
      }
      throw error;
    }
  }

  return attachSessionCookie(
    Response.json({ batchId, count: results.length, results }, { status: 202 }),
    sessionId,
  );
}

function isBatchItem(value: unknown): value is BatchItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    (item.targetType === "character" || item.targetType === "location" || item.targetType === "prop") &&
    typeof item.targetId === "string" &&
    item.targetId.trim().length > 0 &&
    (item.prompt === undefined || typeof item.prompt === "string")
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
