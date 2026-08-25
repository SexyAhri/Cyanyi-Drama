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
  return process.env.STORAGE_PROVIDER === "local" ? "local" : "s3";
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
  const sha256 = sha256Hex(body);
  const existing = await prisma.mediaHash.findUnique({ where: { sha256 } });
  if (existing) return existing.storageKey;

  const resolvedType =
    contentType || response.headers.get("content-type") || undefined;
  await uploadObject(key, body, resolvedType);
  const record = await prisma.mediaHash.upsert({
    where: { sha256 },
    create: {
      sha256,
      storageKey: key,
      mimeType: resolvedType,
      sizeBytes: BigInt(body.byteLength),
    },
    update: {},
  });
  if (record.storageKey !== key) await deleteObject(key).catch(() => undefined);
  return record.storageKey;
}
