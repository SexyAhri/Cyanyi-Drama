import { Buffer } from "node:buffer";

import { decodeInlineMediaUrl } from "@/lib/media/public-media";
import {
  verifyProviderInputSignature,
  verifyProviderTaskInputSignature,
} from "@/lib/media/provider-input-url";
import { prisma } from "@/lib/server/prisma";
import { contentTypeForKey, readStoredObject } from "@/lib/storage";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const assetId = url.searchParams.get("assetId") ?? "";
  const taskId = url.searchParams.get("taskId") ?? "";
  const referenceIndex = url.searchParams.get("referenceIndex") ?? "";
  const expires = url.searchParams.get("expires") ?? "";
  const signature = url.searchParams.get("signature") ?? "";
  const validAssetLink =
    Boolean(assetId) && verifyProviderInputSignature(assetId, expires, signature);
  const validTaskLink =
    Boolean(taskId) &&
    verifyProviderTaskInputSignature(
      taskId,
      referenceIndex,
      expires,
      signature,
    );
  if (!validAssetLink && !validTaskLink)
    return Response.json({ message: "媒体链接无效或已过期" }, { status: 403 });

  if (validTaskLink)
    return readTaskReferenceImage(taskId, Number(referenceIndex));

  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId },
    select: { storageKey: true, url: true, mimeType: true },
  });
  if (!asset)
    return Response.json({ message: "媒体资产不存在" }, { status: 404 });

  let bytes: Uint8Array | null = null;
  let mimeType = asset.mimeType?.trim() || "";
  if (asset.storageKey) {
    bytes = await readStoredObject(asset.storageKey).catch(() => null);
    mimeType ||= contentTypeForKey(asset.storageKey);
  } else {
    const inline = asset.url ? decodeInlineMediaUrl(asset.url) : null;
    if (inline) {
      bytes = inline.bytes;
      mimeType ||= inline.mimeType;
    }
  }

  if (!bytes && /^https?:\/\//i.test(asset.url ?? ""))
    return Response.redirect(asset.url!, 307);
  if (!bytes)
    return Response.json({ message: "媒体内容不存在" }, { status: 404 });
  if (!mimeType.toLowerCase().startsWith("image/"))
    return Response.json({ message: "只允许读取图片参考素材" }, { status: 415 });

  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(bytes.byteLength),
      "Content-Type": mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readTaskReferenceImage(taskId: string, referenceIndex: number) {
  const task = await prisma.mediaTask.findFirst({
    where: { id: taskId },
    select: { payload: true },
  });
  if (!task)
    return Response.json({ message: "媒体任务不存在" }, { status: 404 });

  const payload = asRecord(task.payload);
  const taskRequest = asRecord(payload.request);
  const references = taskRequest.referenceImages;
  const reference = Array.isArray(references)
    ? asRecord(references[referenceIndex])
    : {};
  const imageUrl = typeof reference.url === "string" ? reference.url : "";
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/]*={0,2})$/i.exec(
    imageUrl,
  );
  if (!match || !match[2])
    return Response.json({ message: "参考图片内容不存在" }, { status: 404 });

  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length)
    return Response.json({ message: "参考图片内容不存在" }, { status: 404 });
  return imageResponse(bytes, match[1]);
}

function imageResponse(bytes: Uint8Array, mimeType: string) {
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(bytes.byteLength),
      "Content-Type": mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
