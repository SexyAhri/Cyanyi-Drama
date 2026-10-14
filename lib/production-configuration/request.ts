import type { RenderedPrompt } from "@/lib/prompts";
import { prisma } from "@/lib/server/prisma";
import { currentProductionConfiguration } from "./context";
import { applyConfiguredAgentPrompt, getConfiguredAgentForPrompt } from "./agents";

export type ProductionFallbackProvider = {
  channelId: string;
  baseUrl: string;
  apiKeys: string[];
  model: string;
  provider?: string;
  structuredOutputMode?: "text" | "json_object" | "json_schema";
  supportsReferenceImages?: boolean;
  priceCompatibility?: "same" | "different" | "unknown";
};

/** Resolve authorized credentials server-side; configuration never stores secrets. */
export async function configureProductionRequest<
  T extends {
    prompt: RenderedPrompt;
    model: string;
    channelId?: string;
    provider?: string;
    baseUrl: string;
    apiKeys: string[];
    temperature?: number;
    fallbackProvider?: ProductionFallbackProvider;
    timeoutMs?: number;
    maxTransportAttempts?: number;
    maxCorrectionAttempts?: number;
    structuredOutputMode?: "text" | "json_object" | "json_schema";
  },
>(input: T): Promise<T> {
  const context = currentProductionConfiguration();
  if (!context) return input;
  const { snapshot, userId } = context;
  const agent = getConfiguredAgentForPrompt(input.prompt, snapshot);
  const configured = {
    ...input,
    prompt: applyConfiguredAgentPrompt(input.prompt, snapshot),
    temperature: agent?.temperature ?? input.temperature,
    timeoutMs: snapshot.workflow.requestTimeoutSeconds * 1000,
    maxTransportAttempts: snapshot.workflow.transportAttempts,
    maxCorrectionAttempts:
      agent?.maxCorrections ?? snapshot.workflow.maxCorrections,
  };
  let primaryProviderKey = input.provider;
  if (agent?.channelId && agent.model) {
    const { resolveEpisodeTextProvider } =
      await import("@/lib/episodes/provider");
    const provider = await resolveEpisodeTextProvider({
      userId,
      channelId: agent.channelId,
      model: agent.model,
    });
    Object.assign(configured, {
      baseUrl: provider.baseUrl,
      apiKeys: provider.apiKeys,
      model: provider.model,
      channelId: agent.channelId,
      provider: provider.provider,
      structuredOutputMode: provider.structuredOutputMode,
    });
    primaryProviderKey = provider.provider;
  }
  if (agent?.fallbackChannelId && agent.fallbackModel) {
    const { resolveEpisodeTextProvider } =
      await import("@/lib/episodes/provider");
    const fallbackProvider = await resolveEpisodeTextProvider({
      userId,
      channelId: agent.fallbackChannelId,
      model: agent.fallbackModel,
    });
    const prices = await compareConfiguredModelPrices({
      primaryProvider: primaryProviderKey,
      primaryModel: configured.model,
      fallbackProvider: fallbackProvider.provider,
      fallbackModel: fallbackProvider.model,
    });
    Object.assign(configured, {
      fallbackProvider: {
        ...fallbackProvider,
        channelId: agent.fallbackChannelId,
        priceCompatibility: prices,
      },
    });
  }
  return configured;
}

async function compareConfiguredModelPrices(input: {
  primaryProvider?: string;
  primaryModel: string;
  fallbackProvider?: string;
  fallbackModel: string;
}): Promise<"same" | "different" | "unknown"> {
  if (!input.primaryProvider || !input.fallbackProvider) return "unknown";
  const [primary, fallback] = await Promise.all([
    prisma.modelPrice.findMany({
      where: { provider: input.primaryProvider, model: input.primaryModel, capability: "text", active: true },
      select: { unit: true, unitPrice: true },
    }),
    prisma.modelPrice.findMany({
      where: { provider: input.fallbackProvider, model: input.fallbackModel, capability: "text", active: true },
      select: { unit: true, unitPrice: true },
    }),
  ]);
  if (!primary.length || !fallback.length) return "unknown";
  const primaryRates = new Map(primary.map((price) => [price.unit, price.unitPrice.toString()]));
  const fallbackRates = new Map(fallback.map((price) => [price.unit, price.unitPrice.toString()]));
  if (primaryRates.size !== fallbackRates.size) return "different";
  for (const [unit, price] of primaryRates)
    if (fallbackRates.get(unit) !== price) return "different";
  return "same";
}
