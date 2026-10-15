import { Prisma } from "@prisma/client";
import { isTokenPriceUnit } from "./pricing-contract";

export const BILLING_UNITS = ["request", "image", "second", "minute", "character", "1k_character", "1m_character", "1m_input_tokens", "1m_output_tokens", "1m_cached_input_tokens", "1m_cache_write_tokens"] as const;
export type BillingUsage = { requests?: number; images?: number; seconds?: number; inputCharacters?: number; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; cacheWriteTokens?: number };
export type PricingComponent = { unit: string; quantity: number; unitPrice: string; amount: string };
export { CAPABILITY_BILLING_UNITS } from "./pricing-contract";

export function billingQuantity(unit: string, usage: BillingUsage) {
  if (unit === "request" || unit === "task") return positive(usage.requests ?? 1);
  if (unit === "image") {
    const count = usage.images ?? 1;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("BILLING_USAGE_REQUIRED");
    return count;
  }
  if (unit === "character") return positive(usage.inputCharacters);
  if (unit === "1k_character") return Math.ceil(positive(usage.inputCharacters) / 1000);
  if (unit === "1m_character") return positive(usage.inputCharacters) / 1_000_000;
  if (isTokenPriceUnit(unit)) {
    const input = tokenCount(usage.inputTokens);
    const output = tokenCount(usage.outputTokens);
    const cached = tokenCount(usage.cachedInputTokens ?? 0);
    const written = tokenCount(usage.cacheWriteTokens ?? 0);
    if (cached + written > input) throw new Error("BILLING_TOKEN_USAGE_INVALID");
    return (unit === "1m_input_tokens" ? input - cached - written : unit === "1m_output_tokens" ? output : unit === "1m_cached_input_tokens" ? cached : written) / 1_000_000;
  }
  if (unit === "second") return positive(usage.seconds);
  if (unit === "minute") return positive(usage.seconds) / 60;
  throw new Error("BILLING_UNIT_UNSUPPORTED");
}

export function priceUsage(prices: Array<{ unit: string; unitPrice: Prisma.Decimal | string | number }>, usage: BillingUsage) {
  // Cache writes without a separate rate are charged at the normal input rate.
  if (prices.some(price => isTokenPriceUnit(price.unit)) && !prices.some(price => price.unit === "1m_cache_write_tokens")) {
    if (tokenCount(usage.cachedInputTokens ?? 0) + tokenCount(usage.cacheWriteTokens ?? 0) > tokenCount(usage.inputTokens)) throw new Error("BILLING_TOKEN_USAGE_INVALID");
    usage = { ...usage, cacheWriteTokens: 0 };
  }
  const components = prices.map(price => {
    const unitPrice = new Prisma.Decimal(price.unitPrice);
    if (!unitPrice.isFinite() || unitPrice.lt(0)) throw new Error("BILLING_UNIT_PRICE_INVALID");
    const quantity = billingQuantity(price.unit, usage);
    return { unit: price.unit, quantity, unitPrice: unitPrice.toString(), amount: unitPrice.mul(quantity).toFixed() };
  });
  return { components, amount: components.reduce((amount, component) => amount.add(component.amount), new Prisma.Decimal(0)).toDecimalPlaces(6) };
}

function tokenCount(value: number | undefined) {
  if (!Number.isSafeInteger(value) || value! < 0) throw new Error("BILLING_TOKEN_USAGE_REQUIRED");
  return value!;
}

function positive(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error("BILLING_USAGE_REQUIRED");
  return value;
}
