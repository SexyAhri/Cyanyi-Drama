import { prisma } from "@/lib/server/prisma";
import { sha256Hex } from "@/lib/media/hash";

export async function resolveStoredMediaUrl(key: string) {
  const media = await storedMedia(key);
  return asDataUrl(media.data, media.mimeType || contentTypeForKey(key));
}

export async function resolveStoredMediaInput(
  key: string,
  mimeType?: string | null,
) {
  const media = await storedMedia(key);
  return asDataUrl(
    media.data,
    mimeType?.trim() || media.mimeType || contentTypeForKey(key),
  );
}

export async function deleteObject(key: string) {
  await prisma.mediaHash.deleteMany({ where: { storageKey: key } });
}

export async function readStoredObject(key: string) {
  const media = await storedMedia(key);
  return Buffer.from(media.data);
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
  const data = Buffer.from(body);
  const record = await prisma.mediaHash.upsert({
    where: { sha256 },
    create: {
      sha256,
      storageKey: key,
      mimeType: contentType,
      sizeBytes: BigInt(body.byteLength),
      data,
    },
    update: {
      data,
      mimeType: contentType,
      sizeBytes: BigInt(body.byteLength),
    },
  });
  return record.storageKey;
}

async function storedMedia(key: string) {
  const media = await prisma.mediaHash.findUnique({
    where: { storageKey: key },
    select: { data: true, mimeType: true },
  });
  if (!media?.data?.byteLength) throw new Error("DATABASE_MEDIA_NOT_FOUND");
  return { data: Buffer.from(media.data), mimeType: media.mimeType };
}

function asDataUrl(data: Uint8Array, contentType: string) {
  return `data:${contentType};base64,${Buffer.from(data).toString("base64")}`;
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
      webm: "video/webm",
      webp: "image/webp",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}
