import type { MediaAsset } from "@/lib/media/task-contract";

export function mediaAssetContentUrl(assetId: string) {
  return `/api/media/assets/${encodeURIComponent(assetId)}/content`;
}

export function compactMediaTaskRequest(
  request: Record<string, unknown>,
): Record<string, unknown> {
  const compactReferences = (values: unknown) => Array.isArray(values)
    ? values.map((value) => {
        if (!isRecord(value) || typeof value.storageKey !== "string")
          return value;
        return {
          ...value,
          url: `stored:${value.storageKey}`,
        };
      })
    : undefined;
  const referenceImages = compactReferences(request.referenceImages);
  const referenceAudios = compactReferences(request.referenceAudios);
  return referenceImages || referenceAudios ? { ...request, ...(referenceImages ? { referenceImages } : {}), ...(referenceAudios ? { referenceAudios } : {}) } : request;
}

export function compactMediaTaskOutput(output: MediaAsset[]) {
  return output.map((asset) => ({
    ...asset,
    url: mediaAssetContentUrl(asset.id),
    ...(asset.thumbnailUrl?.startsWith("data:")
      ? { thumbnailUrl: undefined }
      : {}),
  }));
}

export function decodeInlineMediaUrl(value: string) {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,([\s\S]+)$/iu.exec(value);
  if (!match) return null;
  return {
    bytes: new Uint8Array(Buffer.from(match[2], "base64")),
    mimeType: match[1] || "application/octet-stream",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
