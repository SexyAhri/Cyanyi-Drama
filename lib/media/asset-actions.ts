import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/server/prisma";
import { deleteObject } from "@/lib/storage";

export class MediaAssetActionError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export async function deleteMediaAsset(input: {
  assetId: string;
  userId: string;
}) {
  const cleanup = await prisma.$transaction(async (transaction) => {
    const asset = await transaction.mediaAsset.findFirst({
      where: { id: input.assetId, task: { userId: input.userId } },
      select: {
        id: true,
        storageKey: true,
        taskId: true,
        task: { select: { payload: true } },
      },
    });
    if (!asset) throw new MediaAssetActionError("Media asset not found.", 404);

    const payload = isRecord(asset.task.payload) ? asset.task.payload : {};
    const output = Array.isArray(payload.output) ? payload.output : [];
    const nextOutput = output.filter(
      (item) => !isRecord(item) || item.id !== asset.id,
    );
    const nextPayload = JSON.parse(
      JSON.stringify({
        ...payload,
        output: nextOutput.length ? nextOutput : null,
      }),
    ) as Prisma.InputJsonValue;

    await transaction.mediaTask.update({
      where: { id: asset.taskId },
      data: { payload: nextPayload },
    });
    await transaction.mediaAsset.delete({ where: { id: asset.id } });

    if (!asset.storageKey) return null;
    const remainingAssets = await transaction.mediaAsset.count({
      where: { storageKey: asset.storageKey },
    });
    if (remainingAssets) return null;

    await transaction.mediaHash.deleteMany({
      where: { storageKey: asset.storageKey },
    });
    return asset.storageKey;
  });

  if (cleanup) {
    await deleteObject(cleanup).catch((error) => {
      console.error("MEDIA_ASSET_STORAGE_CLEANUP_FAILED", error);
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
