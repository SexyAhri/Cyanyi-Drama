import { attachSessionCookie, ensureAnonymousUser } from "@/lib/server/auth";
import {
  createUploadedProjectAsset,
  ProjectAssetError,
  type ProjectAssetTargetType,
} from "@/lib/assets/project-store";

type Context = { params: Promise<{ projectId: string }> };

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export async function POST(request: Request, context: Context) {
  const { user, sessionId } = await ensureAnonymousUser();
  const { projectId } = await context.params;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new ProjectAssetError("file 是必填项", 400);
    const kind = normalizeKind(form.get("kind"), file.type);
    if (!kind) throw new ProjectAssetError("仅支持图片或视频文件", 400);
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES)
      throw new ProjectAssetError("文件大小必须在 1B 到 100MB 之间", 400);
    if (!file.type.toLowerCase().startsWith(`${kind}/`))
      throw new ProjectAssetError("文件 MIME 类型与资产类型不匹配", 400);
    const rawTargetType = stringValue(form.get("targetType"));
    const normalizedTargetType = targetType(form.get("targetType"));
    if (rawTargetType && !normalizedTargetType)
      throw new ProjectAssetError("targetType 不受支持", 400);

    const asset = await createUploadedProjectAsset({
      userId: user.id,
      projectId,
      episodeId: stringValue(form.get("episodeId")),
      kind,
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type,
      source: { sourceType: "upload", fileName: file.name },
      targetType: normalizedTargetType,
      targetId: stringValue(form.get("targetId")),
      role: stringValue(form.get("role")),
    });
    return attachSessionCookie(
      Response.json({ asset }, { status: 201 }),
      sessionId,
    );
  } catch (error) {
    if (error instanceof ProjectAssetError)
      return attachSessionCookie(
        Response.json({ message: error.message }, { status: error.status }),
        sessionId,
      );
    throw error;
  }
}

function normalizeKind(value: FormDataEntryValue | null, mimeType: string) {
  if (value === "image" || value === "video") return value;
  if (mimeType.toLowerCase().startsWith("image/")) return "image";
  if (mimeType.toLowerCase().startsWith("video/")) return "video";
  return null;
}

function targetType(value: FormDataEntryValue | null) {
  return typeof value === "string" &&
    [
      "project",
      "episode",
      "character",
      "character_appearance",
      "location",
      "location_image",
      "storyboard_panel",
    ].includes(value)
    ? (value as ProjectAssetTargetType)
    : undefined;
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}
