import { accessibleChannelWhere } from "./channel-access";
import { decryptSecret } from "./crypto";
import { prisma } from "./prisma";

export async function resolveChannelRuntime(
  userId: string,
  channelId: string,
  model?: string,
) {
  const channel = await prisma.channel.findFirst({
    where: accessibleChannelWhere(userId, channelId),
    include: {
      models: {
        where: model
          ? { modelId: model, selected: true }
          : { selected: true },
        take: 1,
      },
    },
  });
  if (!channel) throw new Error("CHANNEL_NOT_FOUND");
  if (model && channel.models.length === 0) {
    throw new Error("MODEL_NOT_CONFIGURED");
  }
  const apiKeys = parseApiKeys(channel.encryptedApiKeys);
  if (!apiKeys.length) throw new Error("CHANNEL_API_KEY_MISSING");
  return {
    apiKey: apiKeys[0],
    apiKeys,
    baseUrl: channel.baseUrl,
    channelId: channel.id,
    protocol: channel.protocol,
    providerKey: channel.providerKey,
  };
}

function parseApiKeys(value: string) {
  try {
    const parsed = JSON.parse(decryptSecret(value)) as unknown;
    return Array.isArray(parsed)
      ? [
          ...new Set(
            parsed.flatMap((item) =>
              typeof item === "string" && item.trim() ? [item.trim()] : [],
            ),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}
