import { randomUUID } from "node:crypto";

import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  createStoryboardPanelImageTask,
  parseGenerationIterationDiagnostics,
  ProjectAssetTaskError,
} from "@/lib/media/project-asset-tasks";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";

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

  if (!channelId || !model || items.length === 0) {
    return attachSessionCookie(
      Response.json(
        { message: "channelId、model 和 items 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  }

  const batchId = `storyboard_batch_${randomUUID()}`;
  const results: Array<{ item: PanelItem; task: unknown; panel: unknown }> = [];
  const mediaDefaults = await loadUserRuntimeSettings(user.id);
  for (const item of items.slice(0, 50)) {
    try {
      const result = await createStoryboardPanelImageTask({
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
