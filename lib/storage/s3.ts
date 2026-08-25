import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client: S3Client | null = null;

function getClient() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || "us-east-1";
  client ??= new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
  return client;
}

function getBucket() {
  if (!process.env.S3_BUCKET) throw new Error("S3_BUCKET must be configured.");
  return process.env.S3_BUCKET;
}

export async function uploadObject(
  key: string,
  body: Uint8Array | string,
  contentType?: string,
) {
  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return key;
}

export async function getObjectUrl(key: string, expiresIn = 3600) {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
    { expiresIn },
  );
}

export async function deleteObject(key: string) {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  );
}

export async function downloadAndStoreMedia(
  sourceUrl: string,
  key: string,
  contentType?: string,
) {
  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`MEDIA_DOWNLOAD_FAILED:${response.status}`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  const resolvedType =
    contentType || response.headers.get("content-type") || undefined;
  await uploadObject(key, body, resolvedType);
  return key;
}

export async function resolveStoredMediaUrl(key: string, expiresIn = 3600) {
  return getObjectUrl(key, expiresIn);
}
