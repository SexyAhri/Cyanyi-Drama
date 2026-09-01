import { createHash } from "node:crypto";

import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import { ProjectAssetError } from "@/lib/assets/project-store";
import {
  createProjectImageTask,
  ProjectAssetTaskError,
} from "@/lib/media/project-asset-tasks";
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
  const assetIds = stringArray(body.referenceAssetIds).slice(0, 5);
  const characterId = stringValue(body.characterId);
  const appearanceId = stringValue(body.appearanceId);
  const channelId = stringValue(body.channelId);
  const model = stringValue(body.model);
  if (!assetIds.length || !characterId || !channelId || !model)
    return attachSessionCookie(
      Response.json(
        {
          message:
            "referenceAssetIds、characterId、channelId 和 model 是必填项",
        },
        { status: 400 },
      ),
      sessionId,
    );
  try {
    if (body.extractOnly === true) {
      const result = await runCharacterReferenceWorkflow({
        userId: user.id,
        projectId,
        referenceAssetIds: assetIds,
        channelId,
        model,
        characterId,
        appearanceId,
        locale: body.locale === "en" ? "en" : "zh",
      });
      return attachSessionCookie(Response.json(result), sessionId);
    }

    const count = normalizeCount(body.count);
    if (appearanceId && count > 1)
      throw new ProjectAssetError("指定已有外观时 count 只能为 1", 400);
    const prompt =
      stringValue(body.prompt) ||
      "基于参考图片生成角色主设定三视图。使用干净无文字的浅色背景，在同一张宽幅画面中展示头像特写、全身正面、全身侧面、全身背面；四个视图必须是同一个角色，保持面部、发型、体型、服装、配饰、配色和全身比例完全一致。不要剧情场景、不要额外人物、不要文字、水印、镜面反射或拼贴边框。";
    const tasks = [];
    for (let index = 0; index < count; index += 1) {
      const result = await createProjectImageTask({
        userId: user.id,
        projectId,
        channelId,
        model,
        targetType: "character",
        targetId: characterId,
        targetAppearanceId: appearanceId,
        prompt,
        ratio: stringValue(body.ratio) || "16:9",
        resolution: stringValue(body.resolution) || "2k",
        referenceAssetIds: assetIds,
        idempotencyKey: referenceIdempotencyKey({
          projectId,
          characterId,
          appearanceId,
          assetIds,
          model,
          prompt,
          index,
        }),
      });
      tasks.push(result);
    }
    return attachSessionCookie(
      Response.json({ tasks }, { status: 202 }),
      sessionId,
    );
  } catch (error) {
    if (error instanceof ProjectAssetError || error instanceof ProjectAssetTaskError)
      return attachSessionCookie(
        Response.json({ message: error.message }, { status: error.status }),
        sessionId,
      );
    throw error;
  }
}

async function runCharacterReferenceWorkflow(input: {
  userId: string;
  projectId: string;
  referenceAssetIds: string[];
  channelId: string;
  model: string;
  characterId: string;
  appearanceId?: string;
  locale: "en" | "zh";
}) {
  const workflowInput = {
    assetIds: input.referenceAssetIds,
    channelId: input.channelId,
    model: input.model,
    characterId: input.characterId,
    appearanceId: input.appearanceId,
    locale: input.locale,
  };
  const runtimeSettings = await loadUserRuntimeSettings(input.userId);
  const created = await createOrReuseWorkflowRun({
    id: `workflow_${crypto.randomUUID()}`,
    userId: input.userId,
    projectId: input.projectId,
    workflowType: "character-reference-extraction",
    targetType: input.appearanceId ? "character_appearance" : "character",
    targetId: input.appearanceId ?? input.characterId,
    input: workflowInput,
    steps: [
      {
        key: "extract_character_reference",
        type: "extract_character_reference",
        artifactTypes: [
          "asset.character-reference",
          "asset.character-reference.raw",
          "prompt.trace",
        ],
        input: workflowInput,
        retryable: true,
        maxAttempts: runtimeSettings.workflowStepMaxAttempts,
      },
    ],
    maxAttempts: runtimeSettings.workflowStepMaxAttempts,
  });
  if (!created) throw new ProjectAssetError("项目不存在", 404);
  try {
    if (!created.reused)
      await enqueueWorkflowJob({
        runId: created.workflow.id,
        userId: input.userId,
        projectId: input.projectId,
        maxAttempts: 1,
      });
    while (true) {
      const workflow = await getWorkflowRun(input.userId, created.workflow.id);
      if (!workflow) throw new Error("WORKFLOW_RUN_NOT_FOUND");
      if (workflow.status === "succeeded") {
        if (!isCharacterReferenceOutput(workflow.output))
          throw new Error("WORKFLOW_CHARACTER_REFERENCE_OUTPUT_MISSING");
        return { ...workflow.output, workflowId: created.workflow.id };
      }
      if (["failed", "blocked", "canceled"].includes(workflow.status))
        throw new Error(workflowErrorMessage(workflow.error));
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  } catch (error) {
    if (error instanceof ProjectAssetError) throw error;
    throw new ProjectAssetError(
      error instanceof Error ? error.message : "角色参考识别失败",
      502,
    );
  }
}

function isCharacterReferenceOutput(value: unknown): value is Record<string, unknown> & {
  description: string;
} {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { description?: unknown }).description === "string"
  );
}

function workflowErrorMessage(error: Record<string, unknown> | undefined) {
  return typeof error?.message === "string" && error.message.trim()
    ? error.message
    : "WORKFLOW_CHARACTER_REFERENCE_FAILED";
}

function referenceIdempotencyKey(value: Record<string, unknown>) {
  return `reference_to_character:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function normalizeCount(value: unknown) {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(4, Math.max(1, value))
    : 1;
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

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
    : [];
}
