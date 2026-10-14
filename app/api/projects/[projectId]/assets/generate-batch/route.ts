import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { randomUUID } from "node:crypto";
import {
  createProjectImageTask,
  ProjectAssetTaskError,
  type ProjectAssetTarget,
} from "@/lib/media/project-asset-tasks";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { submitBatchItems } from "@/lib/media/batch-submission";

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

  const batchId = `asset_batch_${randomUUID()}`;
  const mediaDefaults = await loadUserRuntimeSettings(user.id);
  const submitted = await submitBatchItems(
    items.slice(0, 50),
    async (item) => createProjectImageTask({
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
      }),
    (error) =>
      error instanceof ProjectAssetTaskError
        ? error.message
        : error instanceof Error
          ? error.message
          : "资产图片任务提交失败",
  );
  const results = submitted.results.map(({ item, value }) => ({ item, ...value }));

  return attachSessionCookie(
    Response.json(
      {
        batchId,
        ...(results.length === 0 && submitted.failures.length
          ? { message: submitted.failures[0].message }
          : {}),
        count: results.length,
        results,
        failures: submitted.failures,
        summary: submitted.summary,
      },
      { status: results.length ? 202 : 400 },
    ),
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
