import { prisma } from "@/lib/server/prisma";
import { sha256Hex } from "@/lib/media/hash";
import {
  deleteLocalObject,
  getLocalObjectUrl,
  readLocalObject,
  uploadLocalObject,
} from "./local";
import {
  deleteObject as deleteS3Object,
  getObjectUrl as getS3ObjectUrl,
  uploadObject as uploadS3Object,
} from "./s3";

export type StorageProvider = "s3" | "local";

export function getStorageProvider(): StorageProvider {
  return process.env.STORAGE_PROVIDER === "s3" ? "s3" : "local";
}

export async function uploadObject(
  key: string,
  body: Uint8Array | string,
  contentType?: string,
) {
  return getStorageProvider() === "local"
    ? uploadLocalObject(key, body)
    : uploadS3Object(key, body, contentType);
}

export async function resolveStoredMediaUrl(key: string, expiresIn = 3600) {
  return getStorageProvider() === "local"
    ? getLocalObjectUrl(key, expiresIn)
    : getS3ObjectUrl(key, expiresIn);
}

export async function resolveStoredMediaInput(
  key: string,
  mimeType?: string | null,
) {
  if (getStorageProvider() !== "local") return getS3ObjectUrl(key);
  const bytes = await readLocalObject(key);
  const contentType = mimeType?.trim() || contentTypeForKey(key);
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

export async function deleteObject(key: string) {
  return getStorageProvider() === "local"
    ? deleteLocalObject(key)
    : deleteS3Object(key);
}

export async function readStoredObject(key: string) {
  if (getStorageProvider() !== "local")
    throw new Error("STORAGE_DIRECT_READ_LOCAL_ONLY");
  return readLocalObject(key);
}

export async function downloadAndStoreMedia(
  sourceUrl: string,
  key: string,
  contentType?: string,
) {
  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`MEDIA_DOWNLOAD_FAILED:${response.status}`);
  const body = new Uint8Array(await response.arrayBuffer());
  return storeMediaBytes(
    body,
    key,
    contentType || response.headers.get("content-type") || undefined,
  );
}

export async function storeMediaBytes(
  body: Uint8Array,
  key: string,
  contentType?: string,
) {
  const sha256 = sha256Hex(body);
  const existing = await prisma.mediaHash.findUnique({ where: { sha256 } });
  if (existing) return existing.storageKey;

  await uploadObject(key, body, contentType);
  const record = await prisma.mediaHash.upsert({
    where: { sha256 },
    create: {
      sha256,
      storageKey: key,
      mimeType: contentType,
      sizeBytes: BigInt(body.byteLength),
    },
    update: {},
  });
  if (record.storageKey !== key) await deleteObject(key).catch(() => undefined);
  return record.storageKey;
}

function contentTypeForKey(key: string) {
  const extension = key.split(".").pop()?.toLowerCase();
  return (
    {
      flac: "audio/flac",
      gif: "image/gif",
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      m4a: "audio/mp4",
      mov: "video/quicktime",
      mp3: "audio/mpeg",
      mp4: "video/mp4",
      ogg: "audio/ogg",
      png: "image/png",
      wav: "audio/wav",
      webm: "application/octet-stream",
      webp: "image/webp",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}
