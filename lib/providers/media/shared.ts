import { readStoredObject } from "@/lib/storage";
import { verifyLocalObjectSignature } from "@/lib/storage/local";

export async function readProviderJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

export function providerErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    const error = value.error;
    if (typeof error === "string") return error;
    if (
      error &&
      typeof error === "object" &&
      typeof (error as Record<string, unknown>).message === "string"
    )
      return (error as Record<string, unknown>).message as string;
    if (typeof value.message === "string") return value.message;
    if (typeof value.msg === "string" && value.msg.trim()) return value.msg;
  }
  return `Provider request failed (${status}).`;
}

export function resolveImageSize(ratio?: string, resolution?: string) {
  if (ratio && /^\d+x\d+$/i.test(ratio)) return ratio;
  const normalizedRatio = ratio?.trim() || "1:1";
  const [widthRatio, heightRatio] = normalizedRatio.split(":").map(Number);
  if (
    !Number.isFinite(widthRatio) ||
    !Number.isFinite(heightRatio) ||
    widthRatio <= 0 ||
    heightRatio <= 0
  )
    return undefined;
  const maxDimension = /4k/i.test(resolution ?? "")
    ? 4096
    : /2k/i.test(resolution ?? "")
      ? 2048
      : 1024;
  const scale = maxDimension / Math.max(widthRatio, heightRatio);
  return `${Math.max(1, Math.round(widthRatio * scale))}x${Math.max(1, Math.round(heightRatio * scale))}`;
}

export async function referencesAsDataUrls(
  references: Array<{ url: string; mimeType?: string }>,
) {
  return Promise.all(
    references.slice(0, 9).map(async (reference) => {
      if (reference.url.startsWith("data:")) return reference.url;
      const response = await fetch(reference.url, { cache: "no-store" });
      if (!response.ok)
        throw new Error(`REFERENCE_IMAGE_FETCH_FAILED:${response.status}`);
      const contentType =
        response.headers.get("content-type") ||
        reference.mimeType ||
        "image/png";
      const bytes = Buffer.from(await response.arrayBuffer());
      return `data:${contentType};base64,${bytes.toString("base64")}`;
    }),
  );
}

export async function localReferencesAsDataUrls(
  references: Array<{ url: string; mimeType?: string }>,
) {
  return Promise.all(
    references.map(async (reference) => {
      if (reference.url.startsWith("data:") || !isLoopbackUrl(reference.url))
        return reference.url;
      const storedReference = localStoredReference(reference.url);
      if (storedReference) {
        const bytes = await readStoredObject(storedReference.key);
        const contentType =
          reference.mimeType || contentTypeForKey(storedReference.key);
        return `data:${contentType};base64,${bytes.toString("base64")}`;
      }
      return (await referencesAsDataUrls([reference]))[0];
    }),
  );
}

function localStoredReference(value: string) {
  try {
    const url = new URL(value);
    const prefix = "/api/files/";
    if (!url.pathname.startsWith(prefix)) return null;
    const key = url.pathname
      .slice(prefix.length)
      .split("/")
      .map(decodeURIComponent)
      .join("/");
    const expires = Number(url.searchParams.get("expires"));
    const signature = url.searchParams.get("signature");
    return verifyLocalObjectSignature(key, expires, signature) ? { key } : null;
  } catch {
    return null;
  }
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
      mp3: "audio/mpeg",
      ogg: "audio/ogg",
      png: "image/png",
      wav: "audio/wav",
      webm: "application/octet-stream",
      webp: "image/webp",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}

function isLoopbackUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function waitForProviderPoll(delayMs = 3_000) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
