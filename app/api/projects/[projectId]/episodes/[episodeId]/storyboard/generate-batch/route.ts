import { randomUUID } from "node:crypto";

import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  createStoryboardPanelImageTask,
  parseGenerationIterationDiagnostics,
  ProjectAssetTaskError,
} from "@/lib/media/project-asset-tasks";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { submitBatchItems } from "@/lib/media/batch-submission";
import { preflightStoryboardBatch } from "@/lib/media/storyboard-batch-preflight";
import { getMediaBudgetSummary, setMediaBudgetLimit } from "@/lib/billing/media-budget";

type Context = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

type PanelItem = { panelId: string; prompt?: string; iteration?: unknown };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await readObject(request);
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  const items = Array.isArray(body.items)
    ? body.items.filter(isPanelItem)
    : [];

  const batchBudgetLimit = budgetLimit(body.batchBudgetLimit);
  if (!channelId || !model || items.length === 0 || items.length !== (Array.isArray(body.items) ? body.items.length : 0) || items.length > 50 || batchBudgetLimit === false) {
    return attachSessionCookie(
      Response.json(
        { message: "channelId、model 和 items 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  }

  const batchId = `storyboard_batch_${randomUUID()}`;
  const mediaDefaults = await loadUserRuntimeSettings(user.id);
  const preflight = await preflightStoryboardBatch({
    userId: user.id,
    projectId,
    episodeId,
    channelId,
    model,
    kind: "image",
    items,
    batchBudgetLimit,
    mediaDefaults,
  });
  if (preflight.blockers.length) {
    return attachSessionCookie(Response.json({ message: "批量生成预检发现阻塞项", preflight }, { status: 409 }), sessionId);
  }
  if (batchBudgetLimit !== undefined && batchBudgetLimit !== null) {
    await setMediaBudgetLimit({ userId: user.id, projectId, scope: { type: "batch", id: batchId }, limit: batchBudgetLimit });
  }
  const submitted = await submitBatchItems(
    items.slice(0, 50),
    async (item) => createStoryboardPanelImageTask({
        userId: user.id,
        projectId,
        episodeId,
        panelId: item.panelId,
        batchId,
        channelId,
        model,
        prompt: item.prompt,
        ratio: stringValue(body.ratio) || undefined,
        resolution: stringValue(body.resolution) || undefined,
        mediaDefaults,
        iteration: parseGenerationIterationDiagnostics(
          item.iteration ?? body.iteration,
        ),
      }),
    (error) =>
      error instanceof ProjectAssetTaskError
        ? error.message
        : error instanceof Error
          ? error.message
          : "图片任务提交失败",
  );
  const results = submitted.results.map(({ item, value }) => ({ item, ...value }));
  const budget = await getMediaBudgetSummary({ userId: user.id, projectId, scope: { type: "batch", id: batchId } });

  return attachSessionCookie(
    Response.json(
      {
        batchId,
        budget,
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

function isPanelItem(value: unknown): value is PanelItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.panelId === "string" &&
    item.panelId.trim().length > 0 &&
    (item.prompt === undefined || typeof item.prompt === "string")
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function budgetLimit(value: unknown): string | number | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+(\.\d{1,6})?$/.test(value) && value.length <= 32) return value;
  return false;
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
