import { prisma } from "@/lib/server/prisma";
import { resolveStoredMediaInput } from "@/lib/storage";
import type {
  MediaProviderRequest,
  MediaReferenceImage,
} from "@/lib/providers/media/types";

export async function resolveStoredReferenceImages(
  request: MediaProviderRequest,
  userId: string,
): Promise<MediaProviderRequest> {
  const references = request.referenceImages ?? [];
  if (!references.length) return request;

  const storageKeys = uniqueStrings(
    references.map((reference) => reference.storageKey),
  );
  const urls = uniqueStrings(
    references
      .filter((reference) => !reference.url.startsWith("data:"))
      .map((reference) => reference.url),
  );
  if (!storageKeys.length && !urls.length) return request;

  const assets = await prisma.mediaAsset.findMany({
    where: {
      task: { userId },
      storageKey: { not: null },
      OR: [
        ...(storageKeys.length ? [{ storageKey: { in: storageKeys } }] : []),
        ...(urls.length ? [{ url: { in: urls } }] : []),
      ],
    },
    select: { url: true, storageKey: true, mimeType: true },
  });
  const byStorageKey = new Map(
    assets.flatMap((asset) =>
      asset.storageKey ? [[asset.storageKey, asset] as const] : [],
    ),
  );
  const byUrl = new Map(
    assets.flatMap((asset) => (asset.url ? [[asset.url, asset] as const] : [])),
  );

  const resolved = await Promise.all(
    references.map(async (reference): Promise<MediaReferenceImage> => {
      const asset =
        (reference.storageKey
          ? byStorageKey.get(reference.storageKey)
          : undefined) ?? byUrl.get(reference.url);
      if (reference.storageKey && !asset)
        throw new Error("REFERENCE_IMAGE_STORAGE_ASSET_NOT_FOUND");
      if (!asset?.storageKey) return reference;
      return {
        ...reference,
        storageKey: asset.storageKey,
        url: await resolveStoredMediaInput(
          asset.storageKey,
          reference.mimeType ?? asset.mimeType,
        ),
      };
    }),
  );

  return { ...request, referenceImages: resolved };
}

function uniqueStrings(values: Array<string | undefined>) {
  return [
    ...new Set(values.map((value) => value?.trim()).filter(Boolean)),
  ] as string[];
}
