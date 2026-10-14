import { describe, expect, it } from "vitest";
import { billingQuantity, priceUsage } from "./pricing";
import { mediaBillingUsage } from "./service";

describe("shared model price calculation", () => {
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
