import { describe, expect, it } from "vitest";
import { billingQuantity, priceUsage } from "./pricing";
import { mediaBillingUsage } from "./service";
import { validatePricePlan } from "./pricing-contract";
import { openAiTokenUsage, sdkTokenUsage } from "./usage";

describe("shared model price calculation", () => {
  const tokens = [
    { unit: "1m_input_tokens", unitPrice: "2" }, { unit: "1m_output_tokens", unitPrice: "8" }, { unit: "1m_cached_input_tokens", unitPrice: "0.2" },
  ];
  it("subtracts cache hits from normal input and prices measured tokens without rounding quantities", () => {
    const bill = priceUsage(tokens, { inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000 });
    expect(bill.amount.toString()).toBe("2.44");
    expect(bill.components.map(component => component.quantity)).toEqual([0.8, 0.1, 0.2]);
    expect(priceUsage(tokens, { inputTokens: 17, outputTokens: 3 }).amount.toString()).toBe("0.000058");
    expect(priceUsage(tokens, { inputTokens: 0, outputTokens: 0 }).amount.toString()).toBe("0");
  });
  it("supports separate cache writes without double charging them, and defaults writes to normal input", () => {
    const usage = { inputTokens: 1_000_000, cachedInputTokens: 200_000, cacheWriteTokens: 100_000, outputTokens: 0 };
    expect(priceUsage(tokens, usage).amount.toString()).toBe("1.64");
    expect(priceUsage([...tokens, { unit: "1m_cache_write_tokens", unitPrice: "3" }], usage).amount.toString()).toBe("1.74");
    expect(() => priceUsage(tokens, { ...usage, cachedInputTokens: 950_000 })).toThrow();
    expect(() => priceUsage(tokens, { inputTokens: 10 })).toThrow();
  });
  it("rounds only the final money sum, not every token component", () => {
    const bill = priceUsage(tokens.map(price => ({ ...price, unitPrice: "0.4" })), { inputTokens: 2, cachedInputTokens: 1, outputTokens: 1 });
    expect(bill.amount.toString()).toBe("0.000001");
    expect(bill.components[0].amount).toBe("0.0000004");
  });
  it("accepts one conventional scheme and rejects additive legacy or incomplete token schemes", () => {
    expect(() => validatePricePlan("text", tokens)).not.toThrow();
    expect(() => validatePricePlan("text", [{ unit: "request", unitPrice: 0 }])).not.toThrow();
    for (const rates of [tokens.slice(0, 2), [...tokens, { unit: "request", unitPrice: 1 }], [{ unit: "1k_character", unitPrice: 1 }]]) expect(() => validatePricePlan("text", rates)).toThrow();
    expect(() => validatePricePlan("video", [{ unit: "second", unitPrice: 1 }, { unit: "request", unitPrice: 1 }])).toThrow();
  });
  it("normalizes Chat Completions, Responses, DeepSeek and SDK cache usage without adding reasoning twice", () => {
    expect(openAiTokenUsage({ prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200 }, completion_tokens_details: { reasoning_tokens: 50 } })).toEqual({ inputTokens: 1000, outputTokens: 100, cachedInputTokens: 200, totalTokens: 1100 });
    expect(openAiTokenUsage({ input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 500 } })?.cachedInputTokens).toBe(500);
    expect(openAiTokenUsage({ prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 600 })?.cachedInputTokens).toBe(600);
    expect(sdkTokenUsage({ inputTokens: { total: 1000, cacheRead: 200, cacheWrite: 100 }, outputTokens: { total: 100, text: 50, reasoning: 50 } })).toEqual({ inputTokens: 1000, outputTokens: 100, cachedInputTokens: 200, cacheWriteTokens: 100, totalTokens: 1100 });
    expect(openAiTokenUsage({ total_tokens: 100 })).toBeNull();
    expect(openAiTokenUsage({ prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 1001 })).toBeNull();
    for (const invalid of [-1, 0.5, "200"]) {
      expect(openAiTokenUsage({ prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: invalid })).toBeNull();
      expect(sdkTokenUsage({ inputTokens: { total: 1000, cacheWrite: invalid }, outputTokens: { total: 100 } })).toBeNull();
      expect(() => priceUsage(tokens, { inputTokens: 1000, outputTokens: 100, cacheWriteTokens: invalid as number })).toThrow();
    }
  });
  it("supports every configured billing unit, including fractional minutes", () => {
    const usage = { requests: 2, images: 3, seconds: 15, inputCharacters: 1001 };
    expect(["request", "image", "second", "minute", "character", "1k_character"].map(unit => billingQuantity(unit, usage)))
      .toEqual([2, 3, 15, 0.25, 1001, 2]);
    expect(priceUsage([{ unit: "minute", unitPrice: "0.6" }], usage).amount.toString()).toBe("0.15");
  });
  it("preserves all price components and free prices", () => {
    const result = priceUsage([{ unit: "request", unitPrice: "0.1" }, { unit: "character", unitPrice: "0.01" }], { inputCharacters: 20 });
    expect(result.amount.toString()).toBe("0.3");
    expect(result.components).toHaveLength(2);
    expect(priceUsage([{ unit: "request", unitPrice: 0 }], {}).amount.toString()).toBe("0");
  });
  it("rejects unknown units, invalid prices and missing usage instead of inventing defaults", () => {
    expect(() => billingQuantity("unknown", {})).toThrow();
    expect(() => billingQuantity("second", {})).toThrow();
    expect(() => billingQuantity("character", { inputCharacters: 0 })).toThrow();
    expect(() => priceUsage([{ unit: "request", unitPrice: -1 }], {})).toThrow();
    expect(() => priceUsage([{ unit: "request", unitPrice: "NaN" }], {})).toThrow();
    expect(mediaBillingUsage({ previewText: "声音预览", duration: "15s" })).toMatchObject({ seconds: 15, inputCharacters: 4 });
  });
});
