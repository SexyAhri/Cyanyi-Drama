import { randomUUID } from "node:crypto";

import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  createStoryboardPanelVideoTask,
  parseGenerationIterationDiagnostics,
  ProjectAssetTaskError,
} from "@/lib/media/project-asset-tasks";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import { productionRequestOptionsSchema, productionRequestErrorStatus } from "@/lib/production-configuration/execution";
import { submitBatchItems } from "@/lib/media/batch-submission";
import { preflightStoryboardBatch } from "@/lib/media/storyboard-batch-preflight";
import { getMediaBudgetSummary, setMediaBudgetLimit } from "@/lib/billing/media-budget";

type Context = { params: Promise<{ projectId: string; episodeId: string }> };
type PanelItem = {
  panelId: string;
  prompt?: string;
  mode?: "reference" | "first-last";
  lastFramePanelId?: string;
  iteration?: unknown;
  previewConfigurationHash?: string;
  previewRequestHash?: string;
};

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId, episodeId } = await context.params;
  const body = await readObject(request);
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  const items = Array.isArray(body.items) ? body.items.filter(isPanelItem) : [];
  const batchBudgetLimit = budgetLimit(body.batchBudgetLimit);
  if (!channelId || !model || !items.length || items.length !== (Array.isArray(body.items) ? body.items.length : 0) || items.length > 50 || batchBudgetLimit === false) {
    return attachSessionCookie(
      Response.json({ message: "channelId、model 和 items 是必填项" }, { status: 400 }),
      sessionId,
    );
  }
  const batchId = `storyboard_video_batch_${randomUUID()}`;
  const mediaDefaults = await loadUserRuntimeSettings(user.id);
  try {
    productionRequestOptionsSchema.parse(body);
    items.forEach((item) => productionRequestOptionsSchema.parse(item));
  } catch (error) {
    const status = productionRequestErrorStatus(error) ?? 400;
    return attachSessionCookie(Response.json({ message: error instanceof Error ? error.message : "配置无效" }, { status }), sessionId);
  }
  const preflight = await preflightStoryboardBatch({
    userId: user.id,
    projectId,
    episodeId,
    channelId,
    model,
    kind: "video",
    mode: body.mode === "first-last" ? "first-last" : "reference",
    ratio: stringValue(body.ratio) || undefined,
    resolution: stringValue(body.resolution) || undefined,
    duration: stringValue(body.duration) || undefined,
    batchBudgetLimit,
    items,
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
    async (item) => createStoryboardPanelVideoTask({
        ...productionRequestOptionsSchema.parse({
          previewConfigurationHash: item.previewConfigurationHash,
          previewRequestHash: item.previewRequestHash,
        }),
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
        duration: stringValue(body.duration) || undefined,
        mediaDefaults,
        mode:
          item.mode ??
          (body.mode === "first-last" ? "first-last" : "reference"),
        lastFramePanelId: item.lastFramePanelId,
        iteration: parseGenerationIterationDiagnostics(
          item.iteration ?? body.iteration,
        ),
      }),
    (error) => {
      const configurationStatus = productionRequestErrorStatus(error);
      if (error instanceof ProjectAssetTaskError) {
        return error.message;
      }
      if (configurationStatus)
        return error instanceof Error ? error.message : "配置无效";
      return error instanceof Error ? error.message : "视频任务提交失败";
    },
  );
  const results = submitted.results.map(({ item, value }) => ({ item, ...value }));
  const budget = await getMediaBudgetSummary({ userId: user.id, projectId, scope: { type: "batch", id: batchId } });
  const count = results.reduce((total, result) => total + result.tasks.length, 0);
  return attachSessionCookie(
    Response.json(
      {
        batchId,
        budget,
        ...(count === 0 && submitted.failures.length
          ? { message: submitted.failures[0].message }
          : {}),
        sceneCount: submitted.summary.submitted,
        count,
        results,
        failures: submitted.failures,
        summary: submitted.summary,
      },
      { status: count ? 202 : 400 },
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
    (item.prompt === undefined || typeof item.prompt === "string") &&
    (item.mode === undefined ||
      item.mode === "reference" ||
      item.mode === "first-last") &&
    (item.lastFramePanelId === undefined || typeof item.lastFramePanelId === "string") &&
    (item.previewConfigurationHash === undefined || typeof item.previewConfigurationHash === "string") &&
    (item.previewRequestHash === undefined || typeof item.previewRequestHash === "string")
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
