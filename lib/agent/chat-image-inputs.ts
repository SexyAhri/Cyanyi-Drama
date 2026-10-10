import type { ModelMessage } from "ai";

import { prisma } from "@/lib/server/prisma";
import { resolveStoredMediaInput } from "@/lib/storage";
import { resolveReferenceImageMediaType } from "./model-messages";

export async function resolveChatImageInputs(
  messages: ModelMessage[],
  userId: string,
  origin: string,
): Promise<ModelMessage[]> {
  const resolvedAssets = new Map<string, Promise<{ image: string; mediaType?: string }>>();
  return Promise.all(messages.map(async (message): Promise<ModelMessage> => {
    if (message.role !== "user" || typeof message.content === "string") return message;
    const content = await Promise.all(message.content.map(async (part) => {
      if (part.type !== "image" || typeof part.image !== "string") return part;
      const source = part.image;
      const sourceUrl = source.startsWith("/") || /^https?:\/\//i.test(source)
        ? new URL(source, origin)
        : null;
      const encodedId = sourceUrl?.origin === origin
        ? /^\/api\/media\/assets\/([^/]+)\/content\/?$/.exec(sourceUrl.pathname)?.[1]
        : undefined;
      if (!encodedId) {
        return {
          ...part,
          mediaType: resolveReferenceImageMediaType({ url: source, mimeType: part.mediaType }),
        };
      }
      const assetId = decodeURIComponent(encodedId);
      let resolved = resolvedAssets.get(assetId);
      if (!resolved) {
        resolved = readOwnedImage(assetId, userId);
        resolvedAssets.set(assetId, resolved);
      }
      return { ...part, ...await resolved };
    }));
    return { ...message, content };
  }));
}

async function readOwnedImage(assetId: string, userId: string) {
  const asset = await prisma.mediaAsset.findFirst({
    where: { id: assetId, task: { userId } },
    select: { storageKey: true, url: true, mimeType: true },
  });
  if (!asset) throw new Error("参考图片不存在或无权访问，请重新选择图片。");
  const image = asset.storageKey
    ? await resolveStoredMediaInput(asset.storageKey)
    : asset.url;
  if (!image || !/^(?:data:image\/|https?:\/\/)/i.test(image))
    throw new Error("参考图片内容不可用，请重新上传图片。");
  return {
    image,
    mediaType: resolveReferenceImageMediaType({
      url: image,
      mimeType: image.startsWith("data:") ? undefined : asset.mimeType ?? undefined,
    }),
  };
}
