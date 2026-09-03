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
    if (typeof error === "string" && error.trim()) return error;
    if (
      error &&
      typeof error === "object" &&
      typeof (error as Record<string, unknown>).message === "string" &&
      ((error as Record<string, unknown>).message as string).trim()
    )
      return (error as Record<string, unknown>).message as string;
    if (typeof value.message === "string" && value.message.trim())
      return value.message;
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
  let scale = maxDimension / Math.max(widthRatio, heightRatio);
  const pixelCount = widthRatio * scale * heightRatio * scale;
  if (pixelCount < 655_360)
    scale = Math.sqrt(655_360 / (widthRatio * heightRatio));
  if (pixelCount > 8_294_400)
    scale = Math.sqrt(8_294_400 / (widthRatio * heightRatio));

  const roundDimension =
    pixelCount < 655_360
      ? roundUpToMultipleOfEight
      : pixelCount > 8_294_400
        ? roundDownToMultipleOfEight
        : (value: number) => Math.max(1, Math.round(value));
  const width = roundDimension(widthRatio * scale);
  const height = roundDimension(heightRatio * scale);
  return `${width}x${height}`;
}

function roundUpToMultipleOfEight(value: number) {
  return Math.max(8, Math.ceil(value / 8) * 8);
}

function roundDownToMultipleOfEight(value: number) {
  return Math.max(8, Math.floor(value / 8) * 8);
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
      return (await referencesAsDataUrls([reference]))[0];
    }),
  );
}

function isLoopbackUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

export function waitForProviderPoll(delayMs = 3_000) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
