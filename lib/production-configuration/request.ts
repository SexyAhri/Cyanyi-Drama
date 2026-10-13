import type { RenderedPrompt } from "@/lib/prompts";
import { currentProductionConfiguration } from "./context";
import { applyConfiguredAgentPrompt } from "./agents";

/** Resolve authorized credentials server-side; configuration never stores secrets. */
export async function configureProductionRequest<
  T extends {
    prompt: RenderedPrompt;
    model: string;
    baseUrl: string;
    apiKeys: string[];
    temperature?: number;
    timeoutMs?: number;
    maxTransportAttempts?: number;
    maxCorrectionAttempts?: number;
    structuredOutputMode?: "text" | "json_object" | "json_schema";
  },
>(input: T): Promise<T> {
  const context = currentProductionConfiguration();
  if (!context) return input;
  const { snapshot, userId } = context;
  const agent =
    snapshot.agents[input.prompt.agentId] ?? snapshot.agents[input.prompt.id];
  const configured = {
    ...input,
    prompt: applyConfiguredAgentPrompt(input.prompt, snapshot),
    temperature: agent?.temperature ?? input.temperature,
    timeoutMs: snapshot.workflow.requestTimeoutSeconds * 1000,
    maxTransportAttempts: snapshot.workflow.transportAttempts,
    maxCorrectionAttempts:
      agent?.maxCorrections ?? snapshot.workflow.maxCorrections,
  };
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
      structuredOutputMode: provider.structuredOutputMode,
    });
  }
  return configured;
}
