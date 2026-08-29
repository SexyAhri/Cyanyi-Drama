import { supportsStoredStructuredOutputs } from "@/lib/agent/provider-types";
import { accessibleChannelWhere } from "@/lib/server/channel-access";
import { decryptSecret } from "@/lib/server/crypto";
import { prisma } from "@/lib/server/prisma";
import { structuredRequestOptions } from "@/lib/settings/runtime-contract";
import { loadUserRuntimeSettings } from "@/lib/settings/runtime-store";

import { EpisodeSplitError } from "./errors";

export async function resolveEpisodeTextProvider(input: {
  userId: string;
  channelId: string;
  model: string;
}) {
  const channel = await prisma.channel.findFirst({
    where: accessibleChannelWhere(input.userId, input.channelId),
  });
  if (!channel) throw new EpisodeSplitError("分析渠道不存在", 404);
  if (
    channel.protocol !== "openai-compatible" &&
    channel.protocol !== "volcengine-ark"
  )
    throw new EpisodeSplitError("文本处理需要 OpenAI 兼容渠道");
  const configuredModel = await prisma.providerModel.findFirst({
    where: {
      channelId: input.channelId,
      modelId: input.model,
      selected: true,
    },
  });
  if (!configuredModel) throw new EpisodeSplitError("分析模型未配置");
  const apiKeys = parseApiKeys(channel.encryptedApiKeys);
  if (!apiKeys.length) throw new EpisodeSplitError("分析渠道缺少 API Key");
  const runtimeSettings = await loadUserRuntimeSettings(input.userId);
  return {
    baseUrl: channel.baseUrl,
    apiKeys,
    model: input.model,
    provider: channel.providerKey,
    ...structuredRequestOptions(runtimeSettings),
    structuredOutputMode: supportsStoredStructuredOutputs(
      configuredModel.capabilitiesJson,
    )
      ? ("json_schema" as const)
      : ("json_object" as const),
  };
}

function parseApiKeys(value: string) {
  try {
    const parsed: unknown = JSON.parse(decryptSecret(value));
    return Array.isArray(parsed)
      ? parsed.flatMap((item) =>
          typeof item === "string" && item.trim() ? [item.trim()] : [],
        )
      : [];
  } catch {
    return [];
  }
}
