import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { ProjectAssetError } from "@/lib/assets/project-store";
import { enqueueWorkflowJob } from "@/lib/queue/workflow-queue";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";
import {
  createOrReuseWorkflowRun,
  getWorkflowRun,
} from "@/lib/workflow/store";

type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  const body = await readObject(request);
  const assetIds = stringArray(body.assetIds).slice(0, 10);
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  if (!assetIds.length || !channelId || !model)
    return attachSessionCookie(
      Response.json(
        { message: "assetIds、channelId 和 model 是必填项" },
        { status: 400 },
      ),
      sessionId,
    );
  try {
    const input = {
      assetIds,
      channelId,
      model,
      kindHint: stringValue(body.kindHint),
      locale: body.locale === "en" ? ("en" as const) : ("zh" as const),
      persist: body.persist === true,
    };
    const runtimeSettings = await loadUserRuntimeSettings(user.id);
    const created = await createOrReuseWorkflowRun({
      id: `workflow_${crypto.randomUUID()}`,
      userId: user.id,
      projectId,
      workflowType: "visual-asset-extraction",
      targetType: "project_asset_selection",
      targetId: [...assetIds].sort().join(":"),
      input,
      steps: [
        {
          key: "extract_visual_assets",
          type: "extract_visual_assets",
          artifactTypes: [
            "asset.visual-extraction",
            "asset.visual-extraction.raw",
            "prompt.trace",
          ],
          input,
          retryable: true,
          maxAttempts: runtimeSettings.workflowStepMaxAttempts,
        },
      ],
      maxAttempts: runtimeSettings.workflowStepMaxAttempts,
    });
    if (!created) throw new ProjectAssetError("项目不存在", 404);
    if (!created.reused)
      await enqueueWorkflowJob({
        runId: created.workflow.id,
        userId: user.id,
        projectId,
        maxAttempts: 1,
      });
    const result = await waitForVisualExtractionWorkflow(
      user.id,
      created.workflow.id,
    );
    return attachSessionCookie(
      Response.json({ ...result, workflowId: created.workflow.id }),
      sessionId,
    );
  } catch (error) {
    if (error instanceof ProjectAssetError)
      return attachSessionCookie(
        Response.json({ message: error.message }, { status: error.status }),
        sessionId,
      );
    return attachSessionCookie(
      Response.json(
        { message: error instanceof Error ? error.message : "视觉资产识别失败" },
        { status: 502 },
      ),
      sessionId,
    );
  }
}

async function waitForVisualExtractionWorkflow(userId: string, runId: string) {
  while (true) {
    const workflow = await getWorkflowRun(userId, runId);
    if (!workflow) throw new Error("WORKFLOW_RUN_NOT_FOUND");
    if (workflow.status === "succeeded") {
      if (isVisualExtractionOutput(workflow.output)) return workflow.output;
      throw new Error("WORKFLOW_VISUAL_EXTRACTION_OUTPUT_MISSING");
    }
    if (["failed", "blocked", "canceled"].includes(workflow.status))
      throw new Error(workflowErrorMessage(workflow.error));
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

function isVisualExtractionOutput(value: unknown): value is Record<string, unknown> & {
  assets: Record<string, unknown>;
} {
  return isObject(value) && isObject(value.assets);
}

function workflowErrorMessage(error: Record<string, unknown> | undefined) {
  return typeof error?.message === "string" && error.message.trim()
    ? error.message
    : "WORKFLOW_VISUAL_EXTRACTION_FAILED";
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

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
    : [];
}
