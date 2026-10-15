import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { modelPricePlans, draftForPlan, draftRates, pricePlanSummary } from "./model-price-plan";
import { PriceRateFields } from "./model-price-panel";
import { billingBreakdownLines } from "@/lib/billing/display";

const base = { id: "price-1", provider: "custom", model: "test-model", capability: "text", unit: "request", unitPrice: "0.02", active: true };
describe("conventional model pricing editor", () => {
  it("groups additive legacy rows into one model and requires an explicit new price", () => {
    const plans = modelPricePlans([], [base, { ...base, id: "price-2", unit: "1k_character", unitPrice: "0.003" }]);
    expect(plans).toHaveLength(1);
    expect(plans[0].legacy).toBe(true);
    expect(draftForPlan(plans[0])).toEqual({ mode: "tokens", values: {} });
    expect(pricePlanSummary(plans[0])).toContain("0.003");
  });
  it("lists unpriced channel models and ignores deactivated historical prices", () => {
    const plans = modelPricePlans([{ id: "c", providerKey: "custom", name: "Plus", models: [{ id: "test-model", type: "llm", name: "Test · Plus" }] }], [{ ...base, active: false }]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ label: "Test", channel: "Plus", prices: [], legacy: false });
    expect(draftForPlan(plans[0]).mode).toBe("tokens");
  });
  it("submits an exclusive complete plan, preserving explicit zero rates", () => {
    const values = { "1m_input_tokens": "2", "1m_output_tokens": "8", "1m_cached_input_tokens": "0", request: "0.02" };
    expect(draftRates({ mode: "tokens", values })).toEqual([{ unit: "1m_input_tokens", unitPrice: "2" }, { unit: "1m_output_tokens", unitPrice: "8" }, { unit: "1m_cached_input_tokens", unitPrice: "0" }]);
    expect(draftRates({ mode: "request", values })).toEqual([{ unit: "request", unitPrice: "0.02" }]);
  });
  it("renders labeled million-token prices, supports free prices and a responsive field grid", () => {
    const html = renderToStaticMarkup(createElement(PriceRateFields, { disabled: false, draft: { mode: "tokens", values: {} }, onChange: vi.fn() }));
    expect(html).toContain('for="rate-1m_input_tokens"');
    expect(html).toContain('min="0"');
    expect(html).toContain("sm:grid-cols-3");
    expect(html).toContain("百万 Token");
    expect(html).toContain("缓存读取");
    expect(html).not.toContain("字符");
  });
  it("shows cache and uncached charges separately in the recorded bill", () => {
    const lines = billingBreakdownLines(JSON.stringify({ tokenMetered: true, components: [{ unit: "1m_input_tokens", quantity: 0.0008, unitPrice: "2", amount: "0.0016" }, { unit: "1m_cached_input_tokens", quantity: 0.0002, unitPrice: "0.2", amount: "0.00004" }] }));
    expect(lines[0]).toContain("800 Token");
    expect(lines[1]).toContain("缓存读取 200 Token");
  });
});
