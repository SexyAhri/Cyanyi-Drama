/** Count Unicode characters: a surrogate-pair emoji is one character. */
export const inputCharacterCount = (text: string) => Array.from(text).length;

export type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number; cachedInputTokens?: number; cacheWriteTokens?: number };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const count = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Normalize provider-reported totals. Reasoning is already included in total output. */
export function openAiTokenUsage(value: unknown): TokenUsage | null {
  const usage = record(value);
  const inputTokens = count(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = count(usage.completion_tokens ?? usage.output_tokens);
  if (inputTokens === undefined || outputTokens === undefined) return null;
  const details = record(usage.prompt_tokens_details ?? usage.input_tokens_details);
  const rawCached = details.cached_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cache_read_input_tokens;
  const rawWritten = usage.cache_creation_input_tokens ?? details.cache_write_tokens;
  const cachedInputTokens = count(rawCached);
  const cacheWriteTokens = count(rawWritten);
  if ((rawCached != null && cachedInputTokens === undefined) || (rawWritten != null && cacheWriteTokens === undefined)) return null;
  if ((cachedInputTokens ?? 0) + (cacheWriteTokens ?? 0) > inputTokens) return null;
  return { inputTokens, outputTokens, totalTokens: count(usage.total_tokens) ?? inputTokens + outputTokens,
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}), ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}) };
}

export function sdkTokenUsage(value: unknown): TokenUsage | null {
  const usage = record(value), input = record(usage.inputTokens), output = record(usage.outputTokens);
  // V4 cacheRead/cacheWrite are subdivisions of inputTokens.total.
  return openAiTokenUsage({ input_tokens: count(input.total) ?? count(usage.inputTokens), output_tokens: count(output.total) ?? count(usage.outputTokens),
    input_tokens_details: { cached_tokens: input.cacheRead ?? usage.cachedInputTokens, cache_write_tokens: input.cacheWrite } });
}
