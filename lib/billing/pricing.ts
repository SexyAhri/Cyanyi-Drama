import { Prisma } from "@prisma/client";

export const BILLING_UNITS = ["request", "image", "second", "minute", "character", "1k_character"] as const;
export type BillingUsage = { requests?: number; images?: number; seconds?: number; inputCharacters?: number };
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
  if (unit === "second") return positive(usage.seconds);
  if (unit === "minute") return positive(usage.seconds) / 60;
  throw new Error("BILLING_UNIT_UNSUPPORTED");
}

export function priceUsage(prices: Array<{ unit: string; unitPrice: Prisma.Decimal | string | number }>, usage: BillingUsage) {
  const components = prices.map(price => {
    const unitPrice = new Prisma.Decimal(price.unitPrice);
    if (!unitPrice.isFinite() || unitPrice.lt(0)) throw new Error("BILLING_UNIT_PRICE_INVALID");
    const quantity = billingQuantity(price.unit, usage);
    return { unit: price.unit, quantity, unitPrice: unitPrice.toString(), amount: unitPrice.mul(quantity).toDecimalPlaces(6).toString() };
  });
  return { components, amount: components.reduce((amount, component) => amount.add(component.amount), new Prisma.Decimal(0)) };
}

function positive(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error("BILLING_USAGE_REQUIRED");
  return value;
}
