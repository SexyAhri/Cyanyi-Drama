import { describe, expect, it } from "vitest";
import { summarizeAgentTestRunCost } from "./agent-test-cost";
describe("Agent actual billing receipts", () => {
  it("does not invent an estimate without a charged receipt", () => {
    expect(summarizeAgentTestRunCost()).toEqual({ charged: false, estimated: false, reason: "usage_unavailable" });
  });
  it("summarizes every retrieval/correction charge once", () => {
    const first = { id: "cost1", requestId: "r1", amount: "0.03", quantity: 1, unit: "1k_character", charged: true as const };
    const second = { ...first, id: "cost2", requestId: "r2", amount: "0.06", quantity: 2 };
    expect(summarizeAgentTestRunCost([first, second, first])).toMatchObject({ charged: true, estimated: false, amount: "0.09", quantity: 3, unit: "1k_character" });
  });
  it("keeps mixed pricing receipts visible", () => {
    expect(summarizeAgentTestRunCost([{ id: "c", requestId: "r", amount: "0", quantity: 1, unit: "request", charged: true }])).toMatchObject({ charged: true, amount: "0" });
  });
});
