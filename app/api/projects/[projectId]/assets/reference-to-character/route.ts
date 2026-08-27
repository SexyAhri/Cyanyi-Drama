import { createHash } from "node:crypto";

import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  extractCharacterReferenceDescription,
} from "@/lib/assets/visual-extraction";
import { ProjectAssetError } from "@/lib/assets/project-store";
import {
  createProjectImageTask,
  ProjectAssetTaskError,
} from "@/lib/media/project-asset-tasks";

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
      const result = await extractCharacterReferenceDescription({
        userId: user.id,
        projectId,
        assetIds,
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
